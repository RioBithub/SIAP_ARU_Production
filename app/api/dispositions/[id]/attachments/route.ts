import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { saveUpload } from "@/lib/upload";
import { auditLog } from "@/lib/audit";
import { discardUncommittedFiles, type StoredLetterFile } from "@/lib/letter-uploads";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const stored: StoredLetterFile[] = [];
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("File wajib dipilih.");

    const [[reference]] = await db.query<RowDataPacket[]>(
      "SELECT letter_id FROM siap_dispositions WHERE id=?", [params.id],
    );
    if (!reference) throw new Error("Disposisi tidak ditemukan.");
    const data = await withTransaction(async conn => {
      const [[letter]] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM siap_letters WHERE id=? AND deleted_at IS NULL FOR UPDATE", [reference.letter_id],
      );
      if (!letter) throw new Error("Disposisi tidak ditemukan.");
      const [[disposition]] = await conn.query<RowDataPacket[]>(
        "SELECT * FROM siap_dispositions WHERE id=? FOR UPDATE", [params.id],
      );
      if (!disposition || (user.role !== "ROOT_ADMIN" &&
          ![disposition.to_user_id, disposition.from_user_id, disposition.current_owner_user_id].includes(user.id))) {
        throw new Error("Tidak berhak menambah lampiran.");
      }

      const saved = await saveUpload(file, "ADDITIONAL");
      stored.push(saved);
      const id = crypto.randomUUID();
      await conn.execute(
        `INSERT INTO siap_attachments
         (id,letter_id,disposition_id,attachment_kind,original_name,stored_name,
          storage_path,mime_type,original_size,stored_size,is_compressed,uploaded_by)
         VALUES (?,?,?,'ADDITIONAL',?,?,?,?,?,?,?,?)`,
        [id, letter.id, params.id, saved.originalName, saved.storedName, saved.storagePath, saved.mimeType,
          saved.originalSize, saved.storedSize, saved.isCompressed ? 1 : 0, user.id],
      );
      await auditLog({
        user, action: "DISPOSITION_ATTACHMENT_UPLOAD", entityType: "ATTACHMENT", entityId: id,
        metadata: { dispositionId: params.id, name: saved.originalName, size: saved.originalSize }, request,
      }, conn);
      return { id, name: saved.originalName, originalSize: saved.originalSize, storedSize: saved.storedSize };
    });
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) {
    await discardUncommittedFiles(stored);
    return NextResponse.json({
      ok: false, error: error instanceof Error && !("code" in error) ? error.message : "Unggah lampiran gagal.",
    }, { status: 400 });
  }
}
