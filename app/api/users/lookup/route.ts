import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT id,name,email,role,unit_name FROM siap_users WHERE is_active=1 ORDER BY
     FIELD(role,'PRESIDENT_DIRECTOR','DIRECTOR_OPS','MANAGER','FINANCE','STAFF','ROOT_ADMIN'),name ASC`
  );
  return NextResponse.json({ok:true,data:rows});
}
