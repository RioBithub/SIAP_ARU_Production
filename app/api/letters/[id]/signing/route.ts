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
  callbackUrl, configuredSandboxSigning, mekariMode, mekariPilotAttachmentId, MekariError, MEKARI_PILOT_JOB_MODE, mockSignedPdf, predictSandboxAnnotations,
  sandboxCredentials, sandboxPdf, sandboxStatus, sendSandboxSignature,
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
  return {
    id: job.id, status: job.status, mode: job.mode === MEKARI_PILOT_JOB_MODE ? "sandbox" : job.mode,
    final_attachment_id: job.final_attachment_id,
  };
}

async function lockSigningLetter(conn: PoolConnection, id: string, pilotAttachmentId: string | null) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT l.status,l.direction,l.subject,l.` + "`current_role`" + ` AS owner_role
     FROM siap_letters l JOIN siap_v11_letters v ON v.letter_id=l.id WHERE l.id=? FOR UPDATE`, [id],
  );
  if (!rows[0] || rows[0].direction !== "OUTGOING" || rows[0].status !== "WAITING_SIGNATURE" ||
      rows[0].owner_role !== "SECRETARIAT") throw new Error("Surat belum menunggu tanda tangan Sekretariat.");
  if (pilotAttachmentId && !String(rows[0].subject).startsWith("[SIMULASI]")) {
    throw new Error("Subjek surat uji harus diawali [SIMULASI].");
  }
}

async function signingPdf(conn: PoolConnection, letterId: string, value: unknown, pilotAttachmentId: string | null) {
  const id = required(value, "PDF draf yang telah disetujui", 36);
  if (pilotAttachmentId && id.toLowerCase() !== pilotAttachmentId) {
    throw new Error("Pilih PDF simulasi yang sudah ditentukan.");
  }
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT original_name,storage_path,is_compressed FROM siap_attachments
     WHERE id=? AND letter_id=? AND disposition_id IS NULL
       AND attachment_kind='ORIGINAL' AND original_size BETWEEN 8 AND 10485760`,
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

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (!await getAccessibleLetter(user, params.id) || !canHandleSecretariat(user.role)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const mode = mekariMode(params.id);
  return NextResponse.json({
    ok: true, mode, pilot_attachment_id: mode ? mekariPilotAttachmentId(params.id) : null,
    data: mode ? publicJob(await getJob(db, params.id)) : null,
  });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canHandleSecretariat(user.role) || !await getAccessibleLetter(user, params.id)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const mode = mekariMode(params.id);
  if (!mode) return NextResponse.json({ ok: false, error: "Mekari Sandbox belum diaktifkan untuk surat ini." }, { status: 409 });
  const pilotAttachmentId = mekariPilotAttachmentId(params.id);
  const jobMode = pilotAttachmentId ? MEKARI_PILOT_JOB_MODE : mode;
  const files: StoredLetterFile[] = [];
  try {
    const body = await request.json();
    if (body.action === "PREDICT") {
      if (mode !== "sandbox") throw new Error("Prediksi posisi tersedia dalam mode Mekari Sandbox.");
      const source = await withTransaction(async conn => {
        await lockSigningLetter(conn, params.id, pilotAttachmentId);
        if (await getJob(conn, params.id)) throw new Error("Surat ini sudah memiliki permintaan tanda tangan.");
        return signingPdf(conn, params.id, body.attachment_id, pilotAttachmentId);
      });
      const suggestions = await predictSandboxAnnotations(source.name, source.bytes, body, params.id);
      await auditLog({ userId: user.id, action: "LETTER_MEKARI_PREDICT", entityType: "LETTER", entityId: params.id,
        metadata: { sourceAttachmentId: source.id, suggestionCount: suggestions.length }, request });
      return NextResponse.json({ ok: true, data: suggestions });
    }
    if (body.action === "START") {
      const id = randomUUID();
      const signing = mode === "sandbox" ? configuredSandboxSigning(body) : null;
      const callback = mode === "sandbox" && !pilotAttachmentId ? callbackUrl(id) : null;
      const result = await withTransaction(async conn => {
        await lockSigningLetter(conn, params.id, pilotAttachmentId);
        const existing = await getJob(conn, params.id, true);
        if (existing) return { existing, source: null };
        if (mode === "sandbox") sandboxCredentials();
        const source = await signingPdf(conn, params.id, body.attachment_id, pilotAttachmentId);
        const status = mode === "mock" ? "IN_PROGRESS" : "REQUESTING";
        await conn.execute(
          "INSERT INTO siap_v11_signing (id,letter_id,mode,provider_id,status,requested_by,source_attachment_id) VALUES (?,?,?,?,?,?,?)",
          [id, params.id, jobMode, mode === "mock" ? "mock-" + id : null, status, user.id, source.id],
        );
        await auditLog({ userId: user.id, action: "LETTER_MEKARI_REQUEST", entityType: "LETTER", entityId: params.id,
          metadata: { signingId: id, mode: jobMode, status, ...(signing ? {
            signerCount: signing.signers.length, signingOrder: signing.signing_order,
          } : {}) }, request }, conn);
        return { existing: null, source };
      });
      if (result.existing) return NextResponse.json({ ok: true, data: publicJob(result.existing) });
      if (mode === "sandbox" && signing && result.source) {
        try {
          const providerId = await sendSandboxSignature(result.source.name, result.source.bytes, signing, callback, params.id);
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
      await lockSigningLetter(conn, params.id, pilotAttachmentId);
      const current = await getJob(conn, params.id, true);
      if (!current || current.mode !== jobMode || (pilotAttachmentId && current.source_attachment_id !== pilotAttachmentId)) throw new Error("Permintaan Mekari untuk mode ini belum ada.");
      if (current.status !== "IN_PROGRESS" || (current.next_poll_at && new Date(current.next_poll_at).getTime() > Date.now())) {
        return { current, poll: false };
      }
      await conn.execute("UPDATE siap_v11_signing SET next_poll_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 SECOND) WHERE id=?", [current.id]);
      return { current, poll: true };
    });
    if (!job.poll) return NextResponse.json({ ok: true, data: publicJob(job.current) });
    const { current } = job;
    const status = mode === "mock" ? "COMPLETED" : await sandboxStatus(current.provider_id, params.id);
    let pdf: Buffer | null = null;
    if (status === "COMPLETED") {
      try {
        pdf = mode === "mock" ? mockSignedPdf() : await sandboxPdf(current.provider_id, params.id);
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
      await lockSigningLetter(conn, params.id, pilotAttachmentId);
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
        metadata: { signingId: current.id, mode: jobMode, status, finalAttachmentId: attachmentId }, request }, conn);
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
