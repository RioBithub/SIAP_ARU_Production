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
    const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM siap_dispositions WHERE id=? LIMIT 1`,[params.id]);
    const d=rows[0]; if(!d) throw new Error("Disposisi tidak ditemukan.");
    if(user.role!=="ROOT_ADMIN" && d.to_user_id!==user.id && d.from_user_id!==user.id) throw new Error("Tidak berhak menambah lampiran.");
    const form=await request.formData();
    const file=form.get("file");
    if(!(file instanceof File)) throw new Error("File wajib dipilih.");
    const saved=await saveUpload(file,"ADDITIONAL");
    const id=crypto.randomUUID();
    await db.execute(
      `INSERT INTO siap_attachments
       (id,letter_id,disposition_id,attachment_kind,original_name,stored_name,storage_path,mime_type,original_size,stored_size,is_compressed,uploaded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,d.letter_id,params.id,"ADDITIONAL",saved.originalName,saved.storedName,saved.storagePath,saved.mimeType,saved.originalSize,saved.storedSize,saved.isCompressed?1:0,user.id]
    );
    await auditLog({userId:user.id,action:"DISPOSITION_ATTACHMENT_UPLOAD",entityType:"ATTACHMENT",entityId:id,metadata:{dispositionId:params.id,name:saved.originalName,size:saved.originalSize},request});
    return NextResponse.json({ok:true,data:{id,name:saved.originalName,originalSize:saved.originalSize,storedSize:saved.storedSize}},{status:201});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Upload gagal."},{status:400});}
}
