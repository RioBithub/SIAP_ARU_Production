import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

import { v11Enabled } from "@/lib/v11-data";

export async function GET(){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT u.id,u.name,u.alias,u.email,u.role,u.unit_name,m.scope AS v11_scope
     FROM siap_users u LEFT JOIN siap_v11_managers m ON m.user_id=u.id AND u.role='MANAGER'
     WHERE u.is_active=1 ORDER BY
     FIELD(u.role,'PRESIDENT_DIRECTOR','DIRECTOR_OPS','MANAGER','SECRETARIAT','FINANCE','STAFF','ROOT_ADMIN'),u.name ASC`
  );
  return NextResponse.json({ok:true,data:rows,v11Enabled:v11Enabled()});
}
