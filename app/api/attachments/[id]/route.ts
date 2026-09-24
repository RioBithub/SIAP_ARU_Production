import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { readStoredFile, safeFilename } from "@/lib/upload";
import { auditLog } from "@/lib/audit";

export const runtime="nodejs";

export async function GET(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT a.*,l.is_public,l.created_by,l.current_owner_user_id
     FROM siap_attachments a
     LEFT JOIN siap_letters l ON l.id=a.letter_id
     WHERE a.id=? LIMIT 1`,[params.id]);
  const a=rows[0]; if(!a) return NextResponse.json({ok:false,error:"File tidak ditemukan."},{status:404});
  if(user.role!=="ROOT_ADMIN" && !a.is_public && a.created_by!==user.id && a.current_owner_user_id!==user.id){
    const [letterRole]=await db.query<RowDataPacket[]>(`SELECT current_role FROM siap_letters WHERE id=? LIMIT 1`,[a.letter_id]);
    if(letterRole[0]?.current_role===user.role) {
      // current workflow role may access
    } else {
    const [access]=await db.query<RowDataPacket[]>(
      `SELECT 1 FROM siap_dispositions WHERE letter_id=? AND (to_user_id=? OR from_user_id=?) LIMIT 1`,
      [a.letter_id,user.id,user.id]);
    const [acted]=await db.query<RowDataPacket[]>(`SELECT 1 FROM siap_letter_actions WHERE letter_id=? AND actor_user_id=? LIMIT 1`,[a.letter_id,user.id]);
    if(!access[0] && !acted[0]) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
    }
  }
  try{
    const data=await readStoredFile(String(a.storage_path),Boolean(a.is_compressed));
    await auditLog({userId:user.id,action:"ATTACHMENT_DOWNLOAD",entityType:"ATTACHMENT",entityId:params.id,request});
    return new Response(data,{
      headers:{
        "Content-Type":String(a.mime_type||"application/octet-stream"),
        "Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(safeFilename(String(a.original_name)))}`,
        "Cache-Control":"private, no-store"
      }
    });
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal membaca file."},{status:500});}
}
