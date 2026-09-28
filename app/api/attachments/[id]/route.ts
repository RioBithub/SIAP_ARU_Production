import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { readStoredFile, safeFilename } from "@/lib/upload";
import { auditLog } from "@/lib/audit";

export const runtime="nodejs";

export async function GET(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();

  if(!user)
    return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT a.*,
      l.is_public,l.created_by,l.current_owner_user_id,l.\`current_role\`
     FROM siap_attachments a
     LEFT JOIN siap_letters l ON l.id=a.letter_id
     WHERE a.id=?
     LIMIT 1`,
    [params.id]
  );

  const a=rows[0];
  if(!a)
    return NextResponse.json({ok:false,error:"File tidak ditemukan."},{status:404});

  if(user.role!=="ROOT_ADMIN"){
    let allowed =
      Boolean(a.is_public) ||
      String(a.created_by||"")===String(user.id) ||
      String(a.current_owner_user_id||"")===String(user.id) ||
      (!a.current_owner_user_id && String(a.current_role||"")===String(user.role));

    if(!allowed && a.letter_id){
      const [disp]=await db.query<RowDataPacket[]>(
        `SELECT 1
         FROM siap_dispositions d
         WHERE d.letter_id=?
           AND (
             d.to_user_id=?
             OR d.from_user_id=?
             OR d.current_owner_user_id=?
           )
         LIMIT 1`,
        [a.letter_id,user.id,user.id,user.id]
      );

      const [acted]=await db.query<RowDataPacket[]>(
        `SELECT 1
         FROM siap_letter_actions
         WHERE letter_id=? AND actor_user_id=?
         LIMIT 1`,
        [a.letter_id,user.id]
      );

      allowed=Boolean(disp[0]||acted[0]);
    }

    if(!allowed)
      return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  }

  try{
    const data=await readStoredFile(String(a.storage_path),Boolean(a.is_compressed));

    await auditLog({
      userId:user.id,
      action:"ATTACHMENT_DOWNLOAD",
      entityType:"ATTACHMENT",
      entityId:params.id,
      request
    });

    return new Response(data,{
      headers:{
        "Content-Type":String(a.mime_type||"application/octet-stream"),
        "Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(safeFilename(String(a.original_name)))}`,
        "Cache-Control":"private, no-store"
      }
    });

  }catch(e){
    return NextResponse.json({
      ok:false,
      error:e instanceof Error?e.message:"Gagal membaca file."
    },{status:500});
  }
}
