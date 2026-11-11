import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { letterAccess } from "@/lib/letter-access";
import { dispositionAccess } from "@/lib/disposition-access";

export async function GET(request:Request){
  const user=await getCurrentUser();if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  const q=(new URL(request.url).searchParams.get("q")||"").slice(0,100);
  const like=`%${q}%`;
  const access = letterAccess(user);
  const disposition = dispositionAccess(user);
  const params = [q,like,like,like,...access.params,...disposition.params];
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT a.id,a.attachment_kind,a.original_name,a.mime_type,a.original_size,a.stored_size,a.is_compressed,a.created_at,
      l.id AS letter_id,l.letter_number,l.external_number,l.subject
     FROM siap_attachments a
     JOIN siap_letters l ON l.id=a.letter_id
     LEFT JOIN siap_dispositions d ON d.id=a.disposition_id
     WHERE (?='' OR a.original_name LIKE ? OR l.subject LIKE ? OR COALESCE(l.letter_number,l.external_number,'') LIKE ?)
     AND ((a.disposition_id IS NULL AND ${access.clause})
       OR (d.id IS NOT NULL AND ${disposition.clause}))
     ORDER BY a.created_at DESC LIMIT 500`,params);
  return NextResponse.json({ok:true,data:rows});
}
