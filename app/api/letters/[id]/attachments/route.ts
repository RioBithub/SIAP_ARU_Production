import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { saveUpload } from "@/lib/upload";
import { auditLog } from "@/lib/audit";
import { INVOICE_INCOMING } from "@/lib/business-documents";
import { saveProof, v11Letter } from "@/lib/v11-data";
import { saveNotaSource } from "@/lib/nota-document";
import { canHandleSecretariat } from "@/lib/correspondence-workflow";
import { discardUncommittedFiles, insertLetterAttachment, type StoredLetterFile } from "@/lib/letter-uploads";

export const runtime="nodejs";

export async function POST(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  let staged: StoredLetterFile | null = null;
  try{
    const form=await request.formData();
    const file=form.get("file");
    const kind=String(form.get("kind")||"ADDITIONAL").toUpperCase()==="ORIGINAL"?"ORIGINAL":"ADDITIONAL";
    if(!file || typeof file === "string") throw new Error("File wajib dipilih.");

    const result = await withTransaction(async conn => {
      const [letters] = await conn.query<RowDataPacket[]>(
        "SELECT * FROM siap_letters WHERE id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE", [params.id],
      );
      const letter = letters[0];
      if (!letter) throw new Error("Surat tidak ditemukan.");
      const workflow = await v11Letter(params.id, conn);
      if (workflow && ["COMPLETED","CANCELLED","REJECTED","ISSUED"].includes(letter.status)) {
        throw new Error("Berkas final hanya dapat dibaca.");
      }
      if (kind === "ORIGINAL") {
        if (workflow && !["DRAFT","RETURNED_STAFF","SECRETARIAT_INTAKE"].includes(letter.status)) {
          throw new Error("Berkas asli hanya dapat diperbarui pada draf atau registrasi.");
        }
        if (letter.uses_secretariat && letter.direction === "OUTGOING" &&
            !["DRAFT", "RETURNED_STAFF"].includes(letter.status)) {
          throw new Error("Dokumen utama dapat dilengkapi saat penyusunan draf.");
        }
        const intake = letter.uses_secretariat && letter.status === "SECRETARIAT_INTAKE" && canHandleSecretariat(user.role);
        if (user.role !== "ROOT_ADMIN" && letter.created_by !== user.id && !intake) {
          throw new Error("Akun ini tidak berwenang mengunggah dokumen asli.");
        }
      } else if (user.role !== "ROOT_ADMIN") {
        let allowed = Boolean(letter.is_public) || letter.created_by === user.id ||
          letter.current_owner_user_id === user.id || (!letter.current_owner_user_id && letter.current_role === user.role);
        if (!allowed) {
          const [participants] = await conn.query<RowDataPacket[]>(
            `SELECT 1 FROM siap_dispositions WHERE letter_id=? AND (to_user_id=? OR from_user_id=?)
             UNION ALL SELECT 1 FROM siap_letter_actions WHERE letter_id=? AND actor_user_id=? LIMIT 1`,
            [params.id, user.id, user.id, params.id, user.id],
          );
          allowed = participants.length > 0;
        }
        if (!allowed) throw new Error("Anda tidak memiliki akses menambah lampiran pada surat ini.");
      }
      const nota = Boolean(workflow && kind === "ORIGINAL" && letter.direction === "INTERNAL");
      const saved = nota ? await saveProof(file, true, "ORIGINAL") : await saveUpload(file, kind);
      staged = saved;
      const id = await insertLetterAttachment(conn, params.id, user.id, saved, kind);
      if (nota) await saveNotaSource(conn, params.id, id, "UPLOAD");
      await conn.execute(
        "UPDATE siap_letters SET active_original_attachment_id=IF(?, ?, active_original_attachment_id), updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [Number(kind === "ORIGINAL"), id, user.id, params.id],
      );
      if (workflow && kind === "ORIGINAL" && letter.document_type === INVOICE_INCOMING) {
        await conn.execute("UPDATE siap_v11_letters SET invoice_revision=invoice_revision+1 WHERE letter_id=?", [params.id]);
      }
      await auditLog({
        user, action: "ATTACHMENT_UPLOAD", entityType: "ATTACHMENT", entityId: id,
        metadata: { letterId: params.id, kind, name: saved.originalName, size: saved.originalSize,
          compressed: saved.isCompressed, previousOriginalId: kind === "ORIGINAL" ? letter.active_original_attachment_id : null },
        request,
      }, conn);
      return { id, ...saved, storagePath: undefined };
    });
    staged = null;
    return NextResponse.json({ok:true,data:result},{status:201});
  }catch(e){
    if(staged) await discardUncommittedFiles([staged]);
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Upload gagal."},{status:400});}
}
