import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { mayAccessDisposition } from "@/lib/disposition-access";

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

  if(!(await mayAccessDisposition(user,params.id))) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});

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

  const [reviewers]=await db.query<RowDataPacket[]>(`SELECT r.step_order,r.user_id,r.reviewer_role,u.name FROM siap_disposition_reviewers r JOIN siap_users u ON u.id=r.user_id WHERE r.disposition_id=? ORDER BY r.step_order`,[params.id]);
  d.review_step_total=reviewers.length;
  const [childRows]=await db.query<RowDataPacket[]>(`SELECT c.id,c.instruction,c.status,c.result_note,u.name to_name FROM siap_dispositions c JOIN siap_users u ON u.id=c.to_user_id WHERE c.parent_id=? ORDER BY c.created_at`,[params.id]);
  const children=[];
  for(const child of childRows)if(await mayAccessDisposition(user,String(child.id)))children.push(child);
  let parent=null;
  if(d.parent_id&&await mayAccessDisposition(user,String(d.parent_id))){
    const [parents]=await db.query<RowDataPacket[]>("SELECT id,instruction,status FROM siap_dispositions WHERE id=?",[d.parent_id]);parent=parents[0]||null;
  }
  const canContribute=await mayAccessDisposition(user,params.id,true);
  return NextResponse.json({ok:true,data:{disposition:d,actions,attachments,reviewers,children,parent,can_contribute:canContribute}});
}
