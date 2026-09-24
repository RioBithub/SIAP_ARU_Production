import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { str } from "@/lib/http";

export const runtime = "nodejs";

async function mayAccess(userId:string, role:string, letterId:string) {
  if (role==="ROOT_ADMIN") return true;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM siap_letters l
     WHERE l.id=? AND (
       l.is_public=1 OR l.created_by=? OR l.current_owner_user_id=? OR (l.current_owner_user_id IS NULL AND l.current_role=?)
       OR EXISTS(SELECT 1 FROM siap_dispositions d WHERE d.letter_id=l.id AND (d.to_user_id=? OR d.from_user_id=?))
       OR EXISTS(SELECT 1 FROM siap_letter_actions a WHERE a.letter_id=l.id AND a.actor_user_id=?)
     ) LIMIT 1`,
    [letterId,userId,userId,role,userId,userId,userId]
  );
  return Boolean(rows[0]);
}

export async function GET(_:Request,{params}:{params:{id:string}}) {
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!(await mayAccess(user.id,user.role,params.id))) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  const [letters]=await db.query<RowDataPacket[]>(
    `SELECT l.*,u.name creator_name,uo.name owner_name,nf.name format_name,nf.code format_code,
      nl.seq_base,nl.variant,
      COALESCE(NULLIF(l.legacy_number_text,''), CASE WHEN nl.seq_base IS NULL THEN NULL WHEN nl.variant>0 THEN CONCAT(nl.seq_base,'.',nl.variant) ELSE CAST(nl.seq_base AS CHAR) END) display_number
     FROM siap_letters l
     JOIN siap_users u ON u.id=l.created_by
     LEFT JOIN siap_users uo ON uo.id=l.current_owner_user_id
     LEFT JOIN siap_number_formats nf ON nf.id=l.number_format_id
     LEFT JOIN siap_number_ledger nl ON nl.letter_id=l.id
     WHERE l.id=? LIMIT 1`,[params.id]);
  if(!letters[0]) return NextResponse.json({ok:false,error:"Surat tidak ditemukan."},{status:404});
  const [actions]=await db.query<RowDataPacket[]>(
    `SELECT a.*,u.name actor_name FROM siap_letter_actions a JOIN siap_users u ON u.id=a.actor_user_id
     WHERE a.letter_id=? ORDER BY a.created_at ASC`,[params.id]);
  const [attachments]=await db.query<RowDataPacket[]>(
    `SELECT a.id,a.letter_action_id,a.attachment_kind,a.original_name,a.mime_type,a.original_size,a.stored_size,a.is_compressed,a.created_at,
      ua.name uploaded_by_name,la.action process_action,la.from_status process_from_status,la.to_status process_to_status
     FROM siap_attachments a
     JOIN siap_users ua ON ua.id=a.uploaded_by
     LEFT JOIN siap_letter_actions la ON la.id=a.letter_action_id
     WHERE a.letter_id=? ORDER BY a.created_at ASC`,[params.id]);
  return NextResponse.json({ok:true,data:{letter:letters[0],actions,attachments}});
}

export async function PATCH(request:Request,{params}:{params:{id:string}}) {
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM siap_letters WHERE id=? LIMIT 1`,[params.id]);
  const letter=rows[0];
  if(!letter) return NextResponse.json({ok:false,error:"Surat tidak ditemukan."},{status:404});
  const editable = user.role==="ROOT_ADMIN" || (letter.created_by===user.id && ["DRAFT","RETURNED_STAFF"].includes(String(letter.status))) || (user.role==="STAFF" && String(letter.status)==="RETURNED_STAFF");
  if(!editable) return NextResponse.json({ok:false,error:"Surat tidak dapat diedit pada tahap ini."},{status:403});
  try{
    const b=await request.json();
    const conf=str(b.confidentiality,20).toUpperCase();
    const publicValue=typeof b.is_public==="boolean"?(b.is_public?1:0):null;
    await db.execute(
      `UPDATE siap_letters SET
       subject=COALESCE(NULLIF(?,''),subject),
       sender=COALESCE(NULLIF(?,''),sender),
       recipient=COALESCE(NULLIF(?,''),recipient),
       summary=?,
       notes=?,
       confidentiality=COALESCE(NULLIF(?,''),confidentiality),
       is_public=CASE WHEN COALESCE(NULLIF(?,''),confidentiality)='RAHASIA' THEN 0 ELSE COALESCE(?,is_public) END,
       updated_by=?
       WHERE id=?`,
      [str(b.subject,500),str(b.sender,255),str(b.recipient,255),str(b.summary,5000)||null,str(b.notes,5000)||null,
       conf,conf,publicValue,user.id,params.id]
    );
    await auditLog({userId:user.id,action:"LETTER_UPDATE",entityType:"LETTER",entityId:params.id,request});
    return NextResponse.json({ok:true});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Update gagal."},{status:400});}
}
