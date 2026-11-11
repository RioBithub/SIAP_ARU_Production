import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { saveUpload } from "@/lib/upload";
import { auditLog } from "@/lib/audit";
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
        "SELECT * FROM siap_letters WHERE id=? LIMIT 1 FOR UPDATE", [params.id],
      );
      const letter = letters[0];
      if (!letter) throw new Error("Surat tidak ditemukan.");
      if (kind === "ORIGINAL") {
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
      const saved = await saveUpload(file, kind);
      staged = saved;
      const id = await insertLetterAttachment(conn, params.id, user.id, saved, kind);
      await auditLog({
        userId: user.id, action: "ATTACHMENT_UPLOAD", entityType: "ATTACHMENT", entityId: id,
        metadata: { letterId: params.id, kind, name: saved.originalName, size: saved.originalSize, compressed: saved.isCompressed },
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
