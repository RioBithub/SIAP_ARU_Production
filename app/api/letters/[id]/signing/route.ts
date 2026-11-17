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
  callbackUrl, configuredSandboxSigner, mekariMode, MekariError, mockSignedPdf,
  sandboxPdf, sandboxStatus, sendSandboxSignature,
} from "@/lib/mekari-sign";
import { readStoredFile } from "@/lib/upload";
import { saveProof } from "@/lib/v11-data";

export const runtime = "nodejs";

async function getJob(conn: Pick<PoolConnection, "query">, letterId: string, lock = false) {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT * FROM siap_v11_signing WHERE letter_id=?" + (lock ? " FOR UPDATE" : ""), [letterId],
  );
  return rows[0] ?? null;
}

function publicJob(job: RowDataPacket | null) {
  if (!job) return null;
  return { id: job.id, status: job.status, mode: job.mode, final_attachment_id: job.final_attachment_id };
}

async function lockSigningLetter(conn: PoolConnection, id: string) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT l.status,l.direction,l.` + "`current_role`" + ` AS owner_role
     FROM siap_letters l JOIN siap_v11_letters v ON v.letter_id=l.id WHERE l.id=? FOR UPDATE`, [id],
  );
  if (!rows[0] || rows[0].direction !== "OUTGOING" || rows[0].status !== "WAITING_SIGNATURE" ||
      rows[0].owner_role !== "SECRETARIAT") throw new Error("Surat belum menunggu tanda tangan Sekretariat.");
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (!await getAccessibleLetter(user, params.id) || !canHandleSecretariat(user.role)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  return NextResponse.json({ ok: true, mode: mekariMode(), data: publicJob(await getJob(db, params.id)) });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canHandleSecretariat(user.role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const mode = mekariMode();
  if (!mode) return NextResponse.json({ ok: false, error: "Mekari tersedia pada staging yang dikonfigurasi." }, { status: 409 });
  const files: StoredLetterFile[] = [];
  try {
    const body = await request.json();
    if (body.action === "START") {
      const id = randomUUID();
      const signer = mode === "sandbox" ? configuredSandboxSigner(body) : null;
      const callback = mode === "sandbox" ? callbackUrl(id) : null;
      const result = await withTransaction(async conn => {
        await lockSigningLetter(conn, params.id);
        const existing = await getJob(conn, params.id, true);
        if (existing) return { existing, source: null };
        const attachmentId = required(body.attachment_id, "PDF draf yang telah disetujui", 36);
        const [source] = await conn.query<RowDataPacket[]>(
          `SELECT * FROM siap_attachments WHERE id=? AND letter_id=? AND disposition_id IS NULL
           AND attachment_kind='ORIGINAL' AND original_size BETWEEN 8 AND 10485760`,
          [attachmentId, params.id],
        );
        if (!source[0] || !/\.pdf$/i.test(source[0].original_name)) throw new Error("Pilih PDF draf dari surat ini.");
        const bytes = await readStoredFile(source[0].storage_path, Boolean(source[0].is_compressed));
        if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || !bytes.subarray(-2048).includes(Buffer.from("%%EOF"))) {
          throw new Error("PDF draf tidak valid.");
        }
        const status = mode === "mock" ? "IN_PROGRESS" : "REQUESTING";
        await conn.execute(
          "INSERT INTO siap_v11_signing (id,letter_id,mode,provider_id,status,requested_by,source_attachment_id) VALUES (?,?,?,?,?,?,?)",
          [id, params.id, mode, mode === "mock" ? "mock-" + id : null, status, user.id, attachmentId],
        );
        await auditLog({ userId: user.id, action: "LETTER_MEKARI_REQUEST", entityType: "LETTER", entityId: params.id,
          metadata: { signingId: id, mode, status }, request }, conn);
        return { existing: null, source: { bytes, name: String(source[0].original_name) } };
      });
      if (result.existing) return NextResponse.json({ ok: true, data: publicJob(result.existing) });
      if (mode === "sandbox" && signer && result.source) {
        try {
          const providerId = await sendSandboxSignature(result.source.name, result.source.bytes, signer, callback);
          await db.execute("UPDATE siap_v11_signing SET provider_id=?,status='IN_PROGRESS' WHERE id=? AND status='REQUESTING'", [providerId, id]);
        } catch (error) {
          const state = error instanceof MekariError && [400,401,403,404,422].includes(error.status)
            ? "FAILED" : "RECONCILE";
          await db.execute("UPDATE siap_v11_signing SET status=? WHERE id=?", [state, id]);
          throw error;
        }
      }
      return NextResponse.json({ ok: true, data: publicJob(await getJob(db, params.id)) }, { status: 201 });
    }
    if (body.action !== "REFRESH") throw new Error("Aksi Mekari tidak dikenal.");
    const job = await withTransaction(async conn => {
      await lockSigningLetter(conn, params.id);
      const current = await getJob(conn, params.id, true);
      if (!current || current.mode !== mode) throw new Error("Permintaan Mekari untuk mode ini belum ada.");
      if (current.status !== "IN_PROGRESS" || (current.next_poll_at && new Date(current.next_poll_at).getTime() > Date.now())) {
        return { current, poll: false };
      }
      await conn.execute("UPDATE siap_v11_signing SET next_poll_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 SECOND) WHERE id=?", [current.id]);
      return { current, poll: true };
    });
    if (!job.poll) return NextResponse.json({ ok: true, data: publicJob(job.current) });
    const { current } = job;
    const status = mode === "mock" ? "COMPLETED" : await sandboxStatus(current.provider_id);
    let pdf: Buffer | null = null;
    if (status === "COMPLETED") {
      try {
        pdf = mode === "mock" ? mockSignedPdf() : await sandboxPdf(current.provider_id);
      } catch (error) {
        if (!(error instanceof MekariError) || error.status !== 424) throw error;
        const seconds = error.retryAfter ?? 15;
        await db.execute("UPDATE siap_v11_signing SET next_poll_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? SECOND) WHERE id=?",
          [seconds, current.id]);
        return NextResponse.json({ ok: true, data: publicJob(current), retry_after: seconds }, { status: 202 });
      }
    }
    if (status === "IN_PROGRESS") return NextResponse.json({ ok: true, data: publicJob(current) });
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
      await auditLog({ userId: user.id, action: "LETTER_MEKARI_STATUS", entityType: "LETTER", entityId: params.id,
        metadata: { signingId: current.id, mode, status, finalAttachmentId: attachmentId }, request }, conn);
      return publicJob({ ...latest, status, final_attachment_id: attachmentId } as RowDataPacket);
    });
    files.length = 0;
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    await discardUncommittedFiles(files);
    const safe = error instanceof MekariError || (error instanceof Error && !("code" in error));
    const status = error instanceof MekariError && [401,403,404].includes(error.status) ? 424 : 400;
    return NextResponse.json({ ok: false, error: safe ? error.message : "Integrasi tanda tangan tidak dapat diproses." }, { status });
  }
}
