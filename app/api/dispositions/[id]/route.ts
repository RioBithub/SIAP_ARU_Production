import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime="nodejs";

export async function GET(_:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();

  if(!user)
    return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT d.*,
      l.subject,l.letter_number,l.external_number,l.direction,l.document_type,
      fu.name AS from_name,fu.role AS from_role,
      tu.name AS to_name,tu.role AS to_role,
      cu.name AS current_owner_name,cu.role AS current_owner_role
     FROM siap_dispositions d
     JOIN siap_letters l ON l.id=d.letter_id
     JOIN siap_users fu ON fu.id=d.from_user_id
     JOIN siap_users tu ON tu.id=d.to_user_id
     LEFT JOIN siap_users cu ON cu.id=d.current_owner_user_id
     WHERE d.id=?
     LIMIT 1`,
    [params.id]
  );

  const d=rows[0];
  if(!d)
    return NextResponse.json({ok:false,error:"Disposisi tidak ditemukan."},{status:404});

  if(user.role!=="ROOT_ADMIN"){
    const direct =
      String(d.from_user_id)===String(user.id) ||
      String(d.to_user_id)===String(user.id) ||
      String(d.current_owner_user_id||"")===String(user.id);

    let allowed=direct || String(d.visibility)==="PUBLIC";

    if(!allowed){
      const [acted]=await db.query<RowDataPacket[]>(
        `SELECT 1 FROM siap_disposition_actions
         WHERE disposition_id=? AND actor_user_id=?
         LIMIT 1`,
        [params.id,user.id]
      );
      allowed=Boolean(acted[0]);
    }

    if(!allowed && String(d.visibility)==="ROUTE"){
      const [route]=await db.query<RowDataPacket[]>(
        `SELECT 1
         FROM siap_dispositions
         WHERE letter_id=?
           AND (
             from_user_id=?
             OR to_user_id=?
             OR current_owner_user_id=?
           )
         LIMIT 1`,
        [d.letter_id,user.id,user.id,user.id]
      );
      allowed=Boolean(route[0]);
    }

    if(!allowed)
      return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  }

  const [actions]=await db.query<RowDataPacket[]>(
    `SELECT a.*,u.name AS actor_name,u.role AS actor_role
     FROM siap_disposition_actions a
     JOIN siap_users u ON u.id=a.actor_user_id
     WHERE a.disposition_id=?
     ORDER BY a.created_at ASC`,
    [params.id]
  );

  const [attachments]=await db.query<RowDataPacket[]>(
    `SELECT a.id,a.disposition_id,a.disposition_action_id,a.attachment_kind,
      a.original_name,a.mime_type,a.original_size,a.stored_size,a.is_compressed,
      a.created_at,u.name AS uploaded_by_name
     FROM siap_attachments a
     JOIN siap_users u ON u.id=a.uploaded_by
     WHERE a.disposition_id=?
     ORDER BY a.created_at ASC`,
    [params.id]
  );

  return NextResponse.json({
    ok:true,
    data:{disposition:d,actions,attachments}
  });
}
