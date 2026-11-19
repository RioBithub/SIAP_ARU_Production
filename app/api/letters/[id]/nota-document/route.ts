import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { required } from "@/lib/http";
import { getAccessibleLetter } from "@/lib/letter-access";
import { discardUncommittedFiles, insertLetterAttachment, type StoredLetterFile } from "@/lib/letter-uploads";
import { canEditNotaDocument, generatedNotaFile, notaDocument, saveNotaSource } from "@/lib/nota-document";
import { readStoredFile } from "@/lib/upload";
import { proofMimeType, v11Letter } from "@/lib/v11-data";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  const staged: StoredLetterFile[] = [];
  try {
    const body = await request.json();
    const action = String(body.action || "");
    if (!["GENERATE", "DECLARE", "RESET"].includes(action)) throw new Error("Aksi Nota Dinas tidak dikenal.");

    const ok = await withTransaction(async conn => {
      const letter = await getAccessibleLetter(user, params.id, conn, true);
      if (!letter || !canEditNotaDocument(user, letter) || !await v11Letter(params.id, conn)) return false;
      const current = await notaDocument(conn, params.id);
      let event: string;
      let detail: string;
      let sourceId: string;
      if (action === "GENERATE") {
        const [[dates]] = await conn.query<RowDataPacket[]>("SELECT DATE_FORMAT(letter_date,'%Y-%m-%d') date FROM siap_letters WHERE id=?", [params.id]);
        const file = await generatedNotaFile({
          id: params.id, date: dates.date, author: user.name, unit: user.unit_name, recipient: letter.recipient,
          subject: letter.subject, summary: required(letter.summary, "Isi Nota Dinas", 5000), confidentiality: letter.confidentiality,
        });
        staged.push(file);
        sourceId = await insertLetterAttachment(conn, params.id, user.id, file, "ORIGINAL");
        await saveNotaSource(conn, params.id, sourceId, "GENERATED");
        await conn.execute("UPDATE siap_letters SET active_original_attachment_id=? WHERE id=?", [sourceId, params.id]);
        event = "GENERATE_NOTA_PDF";
        detail = file.originalName;
      } else {
        if (!current?.source || body.source_id !== current.source.id) throw new Error("Buka PDF utama terbaru sebelum mencatat tanda tangan.");
        if (current.signed) throw new Error("PDF utama sudah memiliki hasil Mekari Sandbox.");
        sourceId = current.source.id;
        const reason = action === "DECLARE" ? required(body.reason, "Alasan atau keterangan tanda tangan", 1000) : null;
        if (action === "RESET" && !current.manualReason) return true;
        if (reason) {
          const [[source]] = await conn.query<RowDataPacket[]>("SELECT storage_path,is_compressed FROM siap_attachments WHERE id=?", [sourceId]);
          const bytes = await readStoredFile(source.storage_path, Boolean(source.is_compressed));
          await proofMimeType(new File([new Uint8Array(bytes)], current.source.original_name), true);
        }
        await conn.execute(
          `INSERT INTO siap_v11_nota_documents (letter_id,source_attachment_id,source_kind,manual_reason)
           VALUES (?,?,'UPLOAD',?) ON DUPLICATE KEY UPDATE manual_reason=VALUES(manual_reason)`,
          [params.id, sourceId, reason],
        );
        event = reason ? "DECLARE_NOTA_SIGNED" : "RESET_NOTA_SIGNATURE";
        detail = reason || "Pengirim menandai PDF sebagai belum ditandatangani.";
      }
      await conn.execute("UPDATE siap_letters SET updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [user.id, params.id]);
      await conn.execute(
        `INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment)
         VALUES (?,?,?,?,?,?,?)`,
        [randomUUID(), params.id, user.id, event, letter.status, letter.status, detail],
      );
      await auditLog({ user, action: "LETTER_" + event, entityType: "LETTER", entityId: params.id,
        metadata: { sourceId, comment: detail }, request }, conn);
      return true;
    });
    staged.length = 0;
    if (!ok) return NextResponse.json({ ok: false, error: "Dokumen hanya dapat diubah oleh pengirim pada tahap draf atau revisi." }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    await discardUncommittedFiles(staged);
    return NextResponse.json({ ok: false, error: cause instanceof Error && !("code" in cause) ? cause.message : "Dokumen Nota Dinas belum dapat disimpan." }, { status: 400 });
  }
}
