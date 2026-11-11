import { NextResponse } from "next/server";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { str } from "@/lib/http";
import { ROLE_LABELS } from "@/lib/types";

export async function PATCH(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN") return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  try{
    const b=await request.json();
    const role = str(b.role, 40);
    if (role && !Object.hasOwn(ROLE_LABELS, role)) throw new Error("Role tidak valid.");
    if(b.password){
      await db.execute(`UPDATE siap_users SET password_hash=? WHERE id=?`,[await hashPassword(String(b.password)),params.id]);
    }
    await db.execute(
      `UPDATE siap_users SET
       name=COALESCE(NULLIF(?,''),name),role=COALESCE(NULLIF(?,''),role),
       unit_name=CASE WHEN ?=1 THEN ? ELSE unit_name END,is_active=COALESCE(?,is_active)
       WHERE id=?`,
      [str(b.name,150),role,Number(b.unit_name!==undefined),str(b.unit_name,120)||null,typeof b.is_active==="boolean"?(b.is_active?1:0):null,params.id]);
    await auditLog({userId:user.id,action:"USER_UPDATE",entityType:"USER",entityId:params.id,metadata:{role:b.role,is_active:b.is_active},request});
    return NextResponse.json({ok:true});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Update user gagal."},{status:400});}
}
export async function DELETE(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN") return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  if(params.id===user.id) return NextResponse.json({ok:false,error:"Root yang sedang login tidak dapat menghapus dirinya sendiri."},{status:400});
  await db.execute(`UPDATE siap_users SET is_active=0 WHERE id=?`,[params.id]);
  await db.execute(`DELETE FROM siap_sessions WHERE user_id=?`,[params.id]);
  await auditLog({userId:user.id,action:"USER_DISABLE",entityType:"USER",entityId:params.id,request});
  return NextResponse.json({ok:true});
}
