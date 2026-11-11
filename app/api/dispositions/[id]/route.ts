import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dispositionAccess } from "@/lib/disposition-access";
import { findLetterReferences } from "@/lib/business-document-data";

export const runtime="nodejs";

export async function GET(_:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();

  if(!user)
    return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const access = dispositionAccess(user);
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
     WHERE d.id=? AND ${access.clause}
     LIMIT 1`,
    [params.id, ...access.params]
  );

  const d=rows[0];
  if(!d)
    return NextResponse.json({ok:false,error:"Disposisi tidak ditemukan."},{status:404});

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

  const resultIds = [...new Set(actions.flatMap(action => action.result_letter_id ? [String(action.result_letter_id)] : []))];
  const results = resultIds.length ? await findLetterReferences(user, {
    kind: "support", ids: resultIds, includeCancelled: true,
  }) : [];
  const resultById = new Map(results.map(letter => [letter.id, letter]));
  const history = actions.map(({ result_letter_id, ...action }) => ({
    ...action, result_letter: result_letter_id ? resultById.get(result_letter_id) : undefined,
  }));
  return NextResponse.json({
    ok:true,
    data:{disposition:d,actions:history,attachments}
  });
}
