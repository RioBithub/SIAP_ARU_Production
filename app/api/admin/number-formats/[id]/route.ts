import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { str } from "@/lib/http";

export async function PATCH(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN") return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  try{
    const b=await request.json(); const pattern=str(b.pattern,255);
    if(pattern && !pattern.includes("{seq}")) throw new Error("Pattern wajib memiliki {seq}.");
    const sequenceStart = b.sequence_start==null || String(b.sequence_start).trim()==="" ? null : Number(b.sequence_start);
    if(sequenceStart!==null && (!Number.isInteger(sequenceStart) || sequenceStart<1)) throw new Error("Nomor awal harus angka bulat minimal 1.");
    await db.execute(
      `UPDATE siap_number_formats SET
       name=COALESCE(NULLIF(?,''),name),
       pattern=COALESCE(NULLIF(?,''),pattern),
       description=?,
       sequence_start=COALESCE(?,sequence_start),
       is_active=COALESCE(?,is_active)
       WHERE id=?`,
      [str(b.name,150),pattern,str(b.description,500)||null,sequenceStart,typeof b.is_active==="boolean"?(b.is_active?1:0):null,params.id]);
    await auditLog({userId:user.id,action:"NUMBER_FORMAT_UPDATE",entityType:"NUMBER_FORMAT",entityId:params.id,metadata:{pattern,sequence_start:sequenceStart,is_active:b.is_active},request});
    return NextResponse.json({ok:true});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal update format."},{status:400});}
}
