import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { getAccessibleLetter } from "@/lib/letter-access";
import { discardUncommittedFiles, insertLetterAttachment, type StoredLetterFile } from "@/lib/letter-uploads";
import { canPrepareOutgoingSignature, uploadedOutgoingSignatureMethod } from "@/lib/outgoing-signature";
import { saveProof, takeFile, v11Letter } from "@/lib/v11-data";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  const stored: StoredLetterFile[] = [];
  try {
    const form = await request.formData();
    const method = uploadedOutgoingSignatureMethod(form.get("signature_method"));
    const file = takeFile(form.get("signed_file"));
    if (!file || !method) throw new Error("Pilih metode dan unggah PDF yang sudah ditandatangani.");

    const result = await withTransaction(async conn => {
      const letter = await getAccessibleLetter(user, params.id, conn, true);
      if (!letter || !canPrepareOutgoingSignature(user, letter)) return null;
      const workflow = await v11Letter(params.id, conn);
      if (!workflow) return null;
      const upload = await saveProof(file, true, "ORIGINAL");
      stored.push(upload);
      const actionId = randomUUID();
      await conn.execute(
        `INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment)
         VALUES (?,?,?,'UPLOAD_OUTGOING_SIGNATURE',?,?,?)`,
        [actionId, params.id, user.id, letter.status, letter.status, upload.originalName],
      );
      const attachmentId = await insertLetterAttachment(conn, params.id, user.id, upload, "PROCESS", actionId);
      await conn.execute(
        "UPDATE siap_v11_letters SET signature_attachment_id=?,signature_provenance=? WHERE letter_id=?",
        [attachmentId, method, params.id],
      );
      await conn.execute("UPDATE siap_letters SET updated_by=? WHERE id=?", [user.id, params.id]);
      await auditLog({ user, action: "LETTER_UPLOAD_OUTGOING_SIGNATURE", entityType: "LETTER", entityId: params.id, request,
        metadata: { attachmentId, method, previousAttachmentId: workflow.signature_attachment_id } }, conn);
      return { attachmentId };
    });

    if (!result) return NextResponse.json({ ok: false, error: "PDF final hanya dapat diunggah oleh pihak yang berwenang setelah surat siap ditandatangani." }, { status: 403 });
    return NextResponse.json({ ok: true, data: result }, { status: 201 });
  } catch (error) {
    await discardUncommittedFiles(stored);
    return NextResponse.json({ ok: false, error: error instanceof Error && !("code" in error)
      ? error.message : "PDF bertanda tangan gagal disimpan." }, { status: 400 });
  }
}
