import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request:Request){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN") return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  const url=new URL(request.url); const q=(url.searchParams.get("q")||"").trim().slice(0,100); const like=`%${q}%`;
  const reference = /^#?([1-9]\d{0,14})$/.exec(q)?.[1] ?? null;
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT a.*,u.name user_name,u.email user_email,admin.name impersonator_name
     FROM siap_audit_logs a LEFT JOIN siap_users u ON u.id=a.user_id
     LEFT JOIN siap_users admin ON admin.id=JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json,'$.impersonatedByUserId'))
     WHERE (?='' OR a.action LIKE ? OR a.entity_type LIKE ? OR u.name LIKE ? OR u.email LIKE ?
       OR admin.name LIKE ? OR admin.email LIKE ? OR a.id=?)
     ORDER BY a.created_at DESC,a.id DESC LIMIT 500`,
    [q,like,like,like,like,like,like,reference]);
  return NextResponse.json({ok:true,data:rows});
}
