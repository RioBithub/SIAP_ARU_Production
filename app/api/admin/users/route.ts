import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { required, str } from "@/lib/http";
import type { Role } from "@/lib/types";

const ROLES:Role[]=["ROOT_ADMIN","STAFF","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR","FINANCE"];
export async function GET(){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN") return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  const [rows]=await db.query<RowDataPacket[]>(`SELECT id,name,email,role,unit_name,is_active,created_at,updated_at FROM siap_users ORDER BY name ASC`);
  return NextResponse.json({ok:true,data:rows});
}
export async function POST(request:Request){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN") return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  try{
    const b=await request.json(); const role=required(b.role,"Role",40) as Role;
    if(!ROLES.includes(role)) throw new Error("Role tidak valid.");
    const id=crypto.randomUUID(); const email=required(b.email,"Email",190).toLowerCase(); const password=required(b.password,"Password",200);
    await db.execute(`INSERT INTO siap_users(id,name,email,password_hash,role,unit_name,is_active) VALUES(?,?,?,?,?,?,1)`,
      [id,required(b.name,"Nama",150),email,await hashPassword(password),role,str(b.unit_name,120)||null]);
    await auditLog({userId:user.id,action:"USER_CREATE",entityType:"USER",entityId:id,metadata:{email,role},request});
    return NextResponse.json({ok:true,data:{id}},{status:201});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal membuat user."},{status:400});}
}
