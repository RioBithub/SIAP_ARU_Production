import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveUpload } from "@/lib/upload";
import { auditLog } from "@/lib/audit";

export const runtime="nodejs";

export async function POST(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  try{
    const [letters]=await db.query<RowDataPacket[]>(`SELECT * FROM siap_letters WHERE id=? LIMIT 1`,[params.id]);
    const letter=letters[0];
    if(!letter) throw new Error("Surat tidak ditemukan.");
    const form=await request.formData();
    const file=form.get("file");
    const kind=String(form.get("kind")||"ADDITIONAL").toUpperCase()==="ORIGINAL"?"ORIGINAL":"ADDITIONAL";
    if(!(file instanceof File)) throw new Error("File wajib dipilih.");

    if(kind==="ORIGINAL") {
      if(user.role!=="ROOT_ADMIN" && letter.created_by!==user.id) throw new Error("Surat asli hanya dapat diunggah pembuat surat atau Root Admin.");
    } else if(user.role!=="ROOT_ADMIN") {
      let allowed = Boolean(letter.is_public) || letter.created_by===user.id || letter.current_owner_user_id===user.id || (!letter.current_owner_user_id && letter.current_role===user.role);
      if(!allowed){
        const [access]=await db.query<RowDataPacket[]>(
          `SELECT 1 FROM siap_dispositions WHERE letter_id=? AND (to_user_id=? OR from_user_id=?) LIMIT 1`,
          [params.id,user.id,user.id]
        );
        const [acted]=await db.query<RowDataPacket[]>(
          `SELECT 1 FROM siap_letter_actions WHERE letter_id=? AND actor_user_id=? LIMIT 1`,
          [params.id,user.id]
        );
        allowed=Boolean(access[0]||acted[0]);
      }
      if(!allowed) throw new Error("Anda tidak memiliki akses menambah lampiran pada surat ini.");
    }
    const saved=await saveUpload(file,kind);
    const id=crypto.randomUUID();
    await db.execute(
      `INSERT INTO siap_attachments
       (id,letter_id,attachment_kind,original_name,stored_name,storage_path,mime_type,original_size,stored_size,is_compressed,uploaded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id,params.id,kind,saved.originalName,saved.storedName,saved.storagePath,saved.mimeType,saved.originalSize,saved.storedSize,saved.isCompressed?1:0,user.id]
    );
    await auditLog({userId:user.id,action:"ATTACHMENT_UPLOAD",entityType:"ATTACHMENT",entityId:id,metadata:{letterId:params.id,kind,name:saved.originalName,size:saved.originalSize,compressed:saved.isCompressed},request});
    return NextResponse.json({ok:true,data:{id,...saved,storagePath:undefined}},{status:201});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Upload gagal."},{status:400});}
}
