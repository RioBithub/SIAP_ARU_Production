import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canEditFinance } from "@/lib/permissions";
import { amount, str } from "@/lib/http";
import { auditLog } from "@/lib/audit";

export async function PATCH(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser(); if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role))return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  try{
    const b=await request.json();
    const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM siap_finance_entries WHERE id=? LIMIT 1`,[params.id]);
    if(!rows[0])throw new Error("Data tidak ditemukan.");
    const amountVal=b.amount===undefined?Number(rows[0].amount):amount(b.amount);
    await db.execute(`UPDATE siap_finance_entries SET category=COALESCE(NULLIF(?,''),category),description=COALESCE(NULLIF(?,''),description),amount=?,status=COALESCE(NULLIF(?,''),status),reference_no=?,updated_by=? WHERE id=?`,
      [str(b.category,120),str(b.description,500),amountVal,str(b.status,30),str(b.reference_no,120)||null,user.id,params.id]);
    await auditLog({userId:user.id,action:"FINANCE_ENTRY_UPDATE",entityType:"FINANCE_ENTRY",entityId:params.id,metadata:{amount:amountVal},request});
    return NextResponse.json({ok:true});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Update gagal."},{status:400});}
}
export async function DELETE(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser(); if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN")return NextResponse.json({ok:false,error:"Hanya Root Admin yang dapat menghapus entry."},{status:403});
  const [rows]=await db.query<RowDataPacket[]>(`SELECT entry_type,category,description,amount FROM siap_finance_entries WHERE id=? LIMIT 1`,[params.id]);
  if(!rows[0])return NextResponse.json({ok:false,error:"Data tidak ditemukan."},{status:404});
  await auditLog({userId:user.id,action:"FINANCE_ENTRY_DELETE",entityType:"FINANCE_ENTRY",entityId:params.id,metadata:rows[0] as any,request});
  await db.execute(`DELETE FROM siap_finance_entries WHERE id=?`,[params.id]);
  return NextResponse.json({ok:true});
}
