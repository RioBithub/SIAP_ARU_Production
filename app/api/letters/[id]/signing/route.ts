import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getCurrentUser } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { canHandleSecretariat } from "@/lib/correspondence-workflow";
import { db, withTransaction } from "@/lib/db";
import { required } from "@/lib/http";
import { getAccessibleLetter } from "@/lib/letter-access";
import { discardUncommittedFiles, insertLetterAttachment, type StoredLetterFile } from "@/lib/letter-uploads";
import {
  callbackUrl, canRetrySandboxJob, configuredSandboxSigning, mekariMode, MekariError, mockSignedPdf, predictSandboxAnnotations,
  sandboxCredentials, sandboxErrorStatus, sandboxPdf, sandboxPollDelay, sandboxSendFailure, sandboxStatus, sendSandboxSignature,
} from "@/lib/mekari-sign";
import { latestMekariSendFailure, type MekariSendFailureNotice } from "@/lib/mekari-signing-audit";
import { readStoredFile } from "@/lib/upload";
import { saveProof } from "@/lib/v11-data";

export const runtime = "nodejs";

async function getJob(conn: Pick<PoolConnection, "query">, letterId: string, lock = false) {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT * FROM siap_v11_signing WHERE letter_id=?" + (lock ? " FOR UPDATE" : ""), [letterId],
  );
  return rows[0] ?? null;
}

function publicJob(job: RowDataPacket | null, failure?: MekariSendFailureNotice | null) {
  if (!job) return null;
  return { id: job.id, status: job.status, mode: job.mode, final_attachment_id: job.final_attachment_id,
    can_retry: job.mode === "sandbox" && canRetrySandboxJob(job.status, job.provider_id, job.final_attachment_id),
    send_failure: failure ?? undefined };
}

async function lockSigningLetter(conn: PoolConnection, id: string) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT l.status,l.direction,l.` + "`current_role`" + ` AS owner_role
     FROM siap_letters l JOIN siap_v11_letters v ON v.letter_id=l.id WHERE l.id=? AND l.deleted_at IS NULL FOR UPDATE`, [id],
  );
  if (!rows[0] || rows[0].direction !== "OUTGOING" || rows[0].status !== "WAITING_SIGNATURE" ||
      rows[0].owner_role !== "SECRETARIAT") throw new Error("Surat belum menunggu tanda tangan Sekretariat.");
}

async function signingPdf(conn: PoolConnection, letterId: string, value: unknown) {
  const id = required(value, "PDF draf yang telah disetujui", 36);
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT a.original_name,a.storage_path,a.is_compressed
     FROM siap_attachments a JOIN siap_letters l ON l.id=a.letter_id
     WHERE a.id=? AND l.id=? AND a.disposition_id IS NULL
       AND a.attachment_kind='ORIGINAL' AND a.original_size BETWEEN 8 AND 10485760
       AND a.id=COALESCE(l.active_original_attachment_id,
         (SELECT source.id FROM siap_attachments source WHERE source.letter_id=l.id AND source.disposition_id IS NULL
          AND source.attachment_kind='ORIGINAL' ORDER BY source.created_at DESC,source.id DESC LIMIT 1))`,
    [id, letterId],
  );
  const source = rows[0];
  if (!source || !/\.pdf$/i.test(source.original_name)) throw new Error("Pilih PDF draf dari surat ini.");
  const bytes = await readStoredFile(source.storage_path, Boolean(source.is_compressed));
  if (bytes.length > 10 * 1024 * 1024 || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) ||
      !bytes.subarray(-2048).includes(Buffer.from("%%EOF"))) {
    throw new Error("PDF draf tidak valid atau melebihi 10 MB.");
  }
  return { id, bytes, name: String(source.original_name) };
}

export async function GET(_: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (!await getAccessibleLetter(user, params.id) || !canHandleSecretariat(user.role)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const job = await getJob(db, params.id);
  const failure = job?.mode === "sandbox" ? await latestMekariSendFailure("LETTER", params.id, job.status) : null;
  return NextResponse.json({ ok: true, mode: mekariMode(), data: publicJob(job, failure) });
}

export async function POST(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canHandleSecretariat(user.role) || !await getAccessibleLetter(user, params.id)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const mode = mekariMode();
  if (!mode) return NextResponse.json({ ok: false, error: "Mekari tersedia pada staging yang dikonfigurasi." }, { status: 409 });
  const files: StoredLetterFile[] = [];
  try {
    const body = await request.json();
    if (mode === "sandbox" && ["START", "PREDICT"].includes(body.action) && body.confirm_sandbox !== true) {
      throw new Error("Konfirmasi bahwa PDF boleh dikirim ke Mekari Sandbox.");
    }
    if (body.action === "PREDICT") {
      if (mode !== "sandbox") throw new Error("Prediksi posisi tersedia dalam mode Mekari Sandbox.");
      const source = await withTransaction(async conn => {
        await lockSigningLetter(conn, params.id);
        const job = await getJob(conn, params.id);
        if (job && (job.mode !== mode || !canRetrySandboxJob(job.status, job.provider_id, job.final_attachment_id))) {
          throw new Error("Surat ini sudah memiliki permintaan tanda tangan.");
        }
        return signingPdf(conn, params.id, body.attachment_id);
      });
      const suggestions = await predictSandboxAnnotations(source.name, source.bytes, body);
      await auditLog({ user, action: "LETTER_MEKARI_PREDICT", entityType: "LETTER", entityId: params.id,
        metadata: { sourceAttachmentId: source.id, suggestionCount: suggestions.length }, request });
      return NextResponse.json({ ok: true, data: suggestions });
    }
    if (body.action === "START") {
      const signing = mode === "sandbox" ? configuredSandboxSigning(body) : null;
      const result = await withTransaction(async conn => {
        await lockSigningLetter(conn, params.id);
        const existing = await getJob(conn, params.id, true);
        if (existing && (mode !== "sandbox" || existing.mode !== mode || body.retry_failed !== true ||
            !canRetrySandboxJob(existing.status, existing.provider_id, existing.final_attachment_id))) {
          return { existing };
        }
        const id = existing?.id ?? randomUUID();
        const callback = mode === "sandbox" ? callbackUrl(id) : null;
        if (mode === "sandbox") sandboxCredentials();
        const source = await signingPdf(conn, params.id, body.attachment_id);
        const status = mode === "mock" ? "IN_PROGRESS" : "REQUESTING";
        if (existing) {
          await conn.execute(
            "UPDATE siap_v11_signing SET requested_by=?,source_attachment_id=?,status=?,next_poll_at=NULL WHERE id=?",
            [user.id, source.id, status, id],
          );
        } else {
          await conn.execute(
            "INSERT INTO siap_v11_signing (id,letter_id,mode,provider_id,status,requested_by,source_attachment_id) VALUES (?,?,?,?,?,?,?)",
            [id, params.id, mode, mode === "mock" ? "mock-" + id : null, status, user.id, source.id],
          );
        }
        await auditLog({ user, action: "LETTER_MEKARI_REQUEST", entityType: "LETTER", entityId: params.id,
          metadata: { signingId: id, mode, status, retry: Boolean(existing), ...(signing ? {
            signerCount: signing.signers.length, signingOrder: signing.signing_order,
          } : {}) }, request }, conn);
        return { existing: null, source, id, callback };
      });
      if (result.existing) return NextResponse.json({ ok: true, data: publicJob(result.existing) });
      if (mode === "sandbox" && signing && result.source && result.id) {
        try {
          const providerId = await sendSandboxSignature(result.source.name, result.source.bytes, signing, result.callback ?? null);
          await db.execute("UPDATE siap_v11_signing SET provider_id=?,status='IN_PROGRESS' WHERE id=? AND status='REQUESTING'", [providerId, result.id]);
        } catch (cause) {
          const failure = sandboxSendFailure(cause);
          const auditId = await withTransaction(async conn => {
            await conn.execute("UPDATE siap_v11_signing SET status=? WHERE id=? AND status='REQUESTING'", [failure.status, result.id]);
            return auditLog({ user, action: "LETTER_MEKARI_SEND_FAILED", entityType: "LETTER", entityId: params.id,
              metadata: { signingId: result.id, ...failure }, request }, conn);
          });
          return NextResponse.json({ ok: false, error: failure.message, audit_reference: String(auditId) },
            { status: sandboxErrorStatus(cause) });
        }
      }
      return NextResponse.json({ ok: true, data: publicJob(await getJob(db, params.id)) }, { status: 201 });
    }
    if (body.action !== "REFRESH") throw new Error("Aksi Mekari tidak dikenal.");
    const job = await withTransaction(async conn => {
      await lockSigningLetter(conn, params.id);
      const current = await getJob(conn, params.id, true);
      if (!current || current.mode !== mode) throw new Error("Permintaan Mekari untuk mode ini belum ada.");
      const retryAfter = current.status === "IN_PROGRESS" ? sandboxPollDelay(current.next_poll_at) : 0;
      if (current.status !== "IN_PROGRESS" || retryAfter) {
        return { current, poll: false, retryAfter };
      }
      await conn.execute("UPDATE siap_v11_signing SET next_poll_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 SECOND) WHERE id=?", [current.id]);
      return { current, poll: true, retryAfter: 15 };
    });
    if (!job.poll) return NextResponse.json({ ok: true, data: publicJob(job.current), retry_after: job.retryAfter || undefined });
    const { current } = job;
    const progress = mode === "sandbox" ? await sandboxStatus(current.provider_id) : undefined;
    const status = progress?.status ?? "COMPLETED";
    let pdf: Buffer | null = null;
    if (status === "COMPLETED") {
      try {
        pdf = mode === "mock" ? mockSignedPdf() : await sandboxPdf(current.provider_id);
      } catch (error) {
        if (!(error instanceof MekariError) || error.status !== 424) throw error;
        const seconds = error.retryAfter ?? 15;
        await db.execute("UPDATE siap_v11_signing SET next_poll_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? SECOND) WHERE id=?",
          [seconds, current.id]);
        return NextResponse.json({ ok: true, data: publicJob(current), progress, retry_after: seconds }, { status: 202 });
      }
    }
    if (status === "IN_PROGRESS") return NextResponse.json({ ok: true, data: publicJob(current), progress, retry_after: job.retryAfter });
    const data = await withTransaction(async conn => {
      await lockSigningLetter(conn, params.id);
      const latest = await getJob(conn, params.id, true);
      if (!latest || latest.id !== current.id || latest.status !== "IN_PROGRESS") return publicJob(latest);
      let attachmentId: string | null = null;
      if (pdf) {
        const file = await saveProof(new File([new Uint8Array(pdf)], mode === "mock" ? "SIMULASI-Mekari.pdf" : "Mekari-sandbox-final.pdf"), true, "ORIGINAL");
        files.push(file);
        const actionId = randomUUID();
        await conn.execute(
          `INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment)
           VALUES (?,?,?,'MEKARI_PDF_READY','WAITING_SIGNATURE','WAITING_SIGNATURE',?)`,
          [actionId, params.id, user.id, mode === "mock" ? "PDF simulasi tersedia." : "PDF Mekari sandbox tersedia."],
        );
        attachmentId = await insertLetterAttachment(conn, params.id, user.id, file, "PROCESS", actionId);
      }
      await conn.execute("UPDATE siap_v11_signing SET status=?,final_attachment_id=?,next_poll_at=NULL WHERE id=?", [status, attachmentId, current.id]);
      await auditLog({ user, action: "LETTER_MEKARI_STATUS", entityType: "LETTER", entityId: params.id,
        metadata: { signingId: current.id, mode, status, finalAttachmentId: attachmentId }, request }, conn);
      return publicJob({ ...latest, status, final_attachment_id: attachmentId } as RowDataPacket);
    });
    files.length = 0;
    return NextResponse.json({ ok: true, data, progress });
  } catch (error) {
    await discardUncommittedFiles(files);
    const safe = error instanceof MekariError || (error instanceof Error && !("code" in error));
    return NextResponse.json({ ok: false, error: safe ? error.message : "Integrasi tanda tangan tidak dapat diproses." },
      { status: sandboxErrorStatus(error) });
  }
}
