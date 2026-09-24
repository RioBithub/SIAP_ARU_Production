import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request:Request){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN") return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  const url=new URL(request.url); const q=(url.searchParams.get("q")||"").slice(0,100); const like=`%${q}%`;
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT a.*,u.name user_name,u.email user_email
     FROM siap_audit_logs a LEFT JOIN siap_users u ON u.id=a.user_id
     WHERE (?='' OR a.action LIKE ? OR a.entity_type LIKE ? OR u.name LIKE ? OR u.email LIKE ?)
     ORDER BY a.created_at DESC LIMIT 500`,
    [q,like,like,like,like]);
  return NextResponse.json({ok:true,data:rows});
}
