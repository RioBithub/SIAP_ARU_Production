import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";

export async function DELETE(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN")return NextResponse.json({ok:false,error:"Hanya Root Admin yang dapat menghapus anggaran."},{status:403});
  const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM siap_budgets WHERE id=? LIMIT 1`,[params.id]);
  if(!rows[0])return NextResponse.json({ok:false,error:"Anggaran tidak ditemukan."},{status:404});
  await auditLog({userId:user.id,action:"BUDGET_DELETE",entityType:"BUDGET",entityId:params.id,metadata:{budget_year:rows[0].budget_year,category:rows[0].category,amount:rows[0].amount},request});
  await db.execute(`DELETE FROM siap_budgets WHERE id=?`,[params.id]);
  return NextResponse.json({ok:true});
}
