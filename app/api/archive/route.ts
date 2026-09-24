import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request:Request){
  const user=await getCurrentUser();if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  const q=(new URL(request.url).searchParams.get("q")||"").slice(0,100);
  const like=`%${q}%`;
  const params:any[]=[q,like,like,like];
  let access="";
  if(user.role!=="ROOT_ADMIN"){
    access=`AND (
      l.is_public=1 OR l.created_by=? OR l.current_owner_user_id=? OR l.current_role=?
      OR EXISTS(SELECT 1 FROM siap_dispositions d WHERE d.letter_id=l.id AND (d.to_user_id=? OR d.from_user_id=?))
    )`;
    params.push(user.id,user.id,user.role,user.id,user.id);
  }
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT a.id,a.attachment_kind,a.original_name,a.mime_type,a.original_size,a.stored_size,a.is_compressed,a.created_at,
      l.id AS letter_id,l.letter_number,l.external_number,l.subject
     FROM siap_attachments a
     JOIN siap_letters l ON l.id=a.letter_id
     WHERE (?='' OR a.original_name LIKE ? OR l.subject LIKE ? OR COALESCE(l.letter_number,l.external_number,'') LIKE ?)
     ${access}
     ORDER BY a.created_at DESC LIMIT 500`,params);
  return NextResponse.json({ok:true,data:rows});
}
