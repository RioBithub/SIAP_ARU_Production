import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { canHandleSecretariat } from "@/lib/correspondence-workflow";
import { db, withTransaction } from "@/lib/db";
import { getAccessibleLetter } from "@/lib/letter-access";
import { discardUncommittedFiles, type StoredLetterFile } from "@/lib/letter-uploads";
import {
  canRetrySandboxJob, configuredSandboxSigning, MekariError, predictSandboxAnnotations, sandboxAttachmentsEnabled,
  sandboxCredentials, sandboxErrorStatus, sandboxPdf, sandboxPollDelay, sandboxSendFailure, sandboxStatus,
  sendSandboxSignature, type SandboxProgress,
} from "@/lib/mekari-sign";
import { latestMekariSendFailure, type MekariSendFailureNotice } from "@/lib/mekari-signing-audit";
import type { SessionUser } from "@/lib/types";
import { readStoredFile } from "@/lib/upload";
import { saveProof } from "@/lib/v11-data";

export const runtime = "nodejs";

const error = (status: number, message: string, reference?: string) =>
  NextResponse.json({ ok: false, error: message, audit_reference: reference }, { status });

async function sourceFor(user: SessionUser, id: string, conn: Pick<PoolConnection, "query"> = db) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT a.id,a.letter_id,a.disposition_id,a.original_name,a.storage_path,a.is_compressed,
            d.from_user_id,d.to_user_id,d.current_owner_user_id
     FROM siap_attachments a
     JOIN siap_letters l ON l.id=a.letter_id AND l.deleted_at IS NULL
     LEFT JOIN siap_dispositions d ON d.id=a.disposition_id
     LEFT JOIN siap_disposition_actions da ON da.id=a.disposition_action_id AND da.disposition_id=d.id
     WHERE a.id=? AND a.letter_id IS NOT NULL AND a.original_size BETWEEN 8 AND 10485760
       AND (a.attachment_kind IN ('ORIGINAL','ADDITIONAL','PAYMENT_DOCUMENT') OR da.action='SUBMIT_RESULT')
       AND (a.attachment_kind<>'ORIGINAL' OR a.disposition_id IS NOT NULL OR l.direction<>'OUTGOING'
            OR a.id=COALESCE(l.active_original_attachment_id,
              (SELECT a2.id FROM siap_attachments a2 WHERE a2.letter_id=l.id AND a2.disposition_id IS NULL
               AND a2.attachment_kind='ORIGINAL' ORDER BY a2.created_at DESC,a2.id DESC LIMIT 1)))`,
    [id],
  );
  const source = rows[0];
  if (!source || !/\.pdf$/i.test(source.original_name)) return null;
  if (source.disposition_id) {
    return user.role === "ROOT_ADMIN" || [source.from_user_id, source.to_user_id, source.current_owner_user_id].includes(user.id)
      ? source : null;
  }
  return canHandleSecretariat(user.role) && await getAccessibleLetter(user, source.letter_id, conn) ? source : null;
}

async function findJob(conn: Pick<PoolConnection, "query">, id: string, lock = false) {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT * FROM siap_v11_attachment_signing WHERE source_attachment_id=?" + (lock ? " FOR UPDATE" : ""), [id],
  );
  return rows[0] ?? null;
}

function response(job: RowDataPacket | null, status = 200, retryAfter?: number, progress?: SandboxProgress, failure?: MekariSendFailureNotice | null) {
  const data = job && { id: job.source_attachment_id, status: job.status, mode: "sandbox", final_attachment_id: job.final_attachment_id,
    can_retry: canRetrySandboxJob(job.status, job.provider_id, job.final_attachment_id), send_failure: failure ?? undefined };
  return NextResponse.json({ ok: true, mode: "sandbox", data, retry_after: retryAfter, progress }, { status });
}

async function readSourcePdf(source: RowDataPacket) {
  const bytes = await readStoredFile(source.storage_path, Boolean(source.is_compressed));
  if (bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== "%PDF-" ||
      !bytes.subarray(-2048).includes(Buffer.from("%%EOF"))) {
    throw new Error("PDF sumber tidak valid atau melebihi 10 MB.");
  }
  return bytes;
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return error(401, "Silakan login.");
  if (!sandboxAttachmentsEnabled()) return error(409, "Sandbox lampiran belum aktif.");
  if (!await sourceFor(user, params.id)) return error(403, "Lampiran PDF tidak tersedia untuk akun ini.");
  const job = await findJob(db, params.id);
  const failure = await latestMekariSendFailure("ATTACHMENT", params.id, job?.status);
  return response(job, 200, undefined, undefined, failure);
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return error(401, "Silakan login.");
  if (!sandboxAttachmentsEnabled()) return error(409, "Sandbox lampiran belum aktif.");
  const source = await sourceFor(user, params.id);
  if (!source) return error(403, "Lampiran PDF tidak tersedia untuk akun ini.");
  const id = String(source.id);
  const audit = (action: string, metadata: Record<string, unknown>, conn?: PoolConnection) =>
    auditLog({ user, action, entityType: "ATTACHMENT", entityId: id,
      metadata: { letterId: source.letter_id, dispositionId: source.disposition_id, ...metadata }, request }, conn);
  const files: StoredLetterFile[] = [];
  try {
    const body = await request.json();
    if ((body.action === "PREDICT" || body.action === "START") && body.confirm_sandbox !== true) {
      return error(400, "Konfirmasi bahwa PDF boleh dikirim ke Mekari Sandbox.");
    }
    if (body.action === "PREDICT") {
      const job = await findJob(db, id);
      if (job && !canRetrySandboxJob(job.status, job.provider_id, job.final_attachment_id)) {
        return error(409, "Permintaan untuk PDF ini sudah tercatat.");
      }
      const suggestions = await predictSandboxAnnotations(source.original_name, await readSourcePdf(source), body, "attachment");
      await audit("ATTACHMENT_MEKARI_PREDICT", { suggestionCount: suggestions.length });
      return NextResponse.json({ ok: true, data: suggestions });
    }
    if (body.action === "START") {
      const signing = configuredSandboxSigning(body);
      sandboxCredentials();
      const pdf = await readSourcePdf(source);
      const existing = await withTransaction(async conn => {
        const [[letter]] = await conn.query<RowDataPacket[]>(
          "SELECT id FROM siap_letters WHERE id=? AND deleted_at IS NULL FOR UPDATE", [source.letter_id],
        );
        if (!letter || !await sourceFor(user, id, conn)) throw new Error("PDF sumber tidak lagi tersedia untuk tanda tangan.");
        const job = await findJob(conn, id, true);
        if (job && (body.retry_failed !== true || !canRetrySandboxJob(job.status, job.provider_id, job.final_attachment_id))) return job;
        if (job) {
          await conn.execute(
            "UPDATE siap_v11_attachment_signing SET requested_by=?,status='REQUESTING',next_poll_at=NULL WHERE source_attachment_id=?",
            [user.id, id],
          );
        } else {
          await conn.execute(
            "INSERT INTO siap_v11_attachment_signing (source_attachment_id,requested_by,status) VALUES (?,?,'REQUESTING')",
            [id, user.id],
          );
        }
        await audit("ATTACHMENT_MEKARI_REQUEST", { signerCount: signing.signers.length, ordered: signing.signing_order, retry: Boolean(job) }, conn);
        return null;
      });
      if (existing) return response(existing);
      try {
        const providerId = await sendSandboxSignature(source.original_name, pdf, signing, null, "attachment");
        await db.execute("UPDATE siap_v11_attachment_signing SET provider_id=?,status='IN_PROGRESS' WHERE source_attachment_id=? AND status='REQUESTING'", [providerId, id]);
      } catch (cause) {
        const failure = sandboxSendFailure(cause);
        const auditId = await withTransaction(async conn => {
          await conn.execute(
            "UPDATE siap_v11_attachment_signing SET status=? WHERE source_attachment_id=? AND status='REQUESTING'", [failure.status, id],
          );
          return audit("ATTACHMENT_MEKARI_SEND_FAILED", failure, conn);
        });
        return error(sandboxErrorStatus(cause), failure.message, String(auditId));
      }
      return response(await findJob(db, id), 201);
    }
    if (body.action !== "REFRESH") return error(400, "Aksi Sandbox tidak dikenal.");
    const [claim] = await db.execute<ResultSetHeader>(
      `UPDATE siap_v11_attachment_signing SET next_poll_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 SECOND)
       WHERE source_attachment_id=? AND status='IN_PROGRESS' AND (next_poll_at IS NULL OR next_poll_at<=UTC_TIMESTAMP())`,
      [id],
    );
    const current = await findJob(db, id);
    if (!current) return error(409, "Permintaan untuk PDF ini belum tercatat.");
    const retryAfter = current.status === "IN_PROGRESS" ? sandboxPollDelay(current.next_poll_at) || undefined : undefined;
    if (!claim.affectedRows) return response(current, 200, retryAfter);
    const progress = await sandboxStatus(current.provider_id, "attachment");
    const { status } = progress;
    if (status === "IN_PROGRESS") return response(current, 200, retryAfter, progress);
    let pdf: Buffer | null = null;
    if (status === "COMPLETED") {
      try {
        pdf = await sandboxPdf(current.provider_id, "attachment");
      } catch (cause) {
        if (!(cause instanceof MekariError) || cause.status !== 424) throw cause;
        const seconds = cause.retryAfter ?? 15;
        await db.execute(
          "UPDATE siap_v11_attachment_signing SET next_poll_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? SECOND) WHERE source_attachment_id=? AND status='IN_PROGRESS'",
          [seconds, id],
        );
        return response(current, 202, seconds, progress);
      }
    }
    await withTransaction(async conn => {
      const job = await findJob(conn, id, true);
      if (job?.status !== "IN_PROGRESS") return;
      let finalId: string | null = null;
      if (pdf) {
        const file = await saveProof(new File([new Uint8Array(pdf)], "Bukti-uji-Mekari-Sandbox.pdf"), true, "ORIGINAL");
        files.push(file);
        finalId = randomUUID();
        await conn.execute(
          `INSERT INTO siap_attachments
           (id,letter_id,disposition_id,attachment_kind,original_name,stored_name,
            storage_path,mime_type,original_size,stored_size,is_compressed,uploaded_by)
           VALUES (?,?,?,'PROCESS',?,?,?,?,?,?,?,?)`,
          [finalId, source.letter_id, source.disposition_id, file.originalName, file.storedName,
            file.storagePath, file.mimeType, file.originalSize, file.storedSize, Number(file.isCompressed), user.id],
        );
      }
      await conn.execute(
        "UPDATE siap_v11_attachment_signing SET status=?,final_attachment_id=?,next_poll_at=NULL WHERE source_attachment_id=?",
        [status, finalId, id],
      );
      await audit("ATTACHMENT_MEKARI_STATUS", { status, finalAttachmentId: finalId }, conn);
    });
    files.length = 0;
    return response(await findJob(db, id), 200, undefined, progress);
  } catch (cause) {
    await discardUncommittedFiles(files);
    const message = cause instanceof Error && !("code" in cause) ? cause.message : "Permintaan Sandbox gagal diproses.";
    return error(sandboxErrorStatus(cause), message);
  }
}
