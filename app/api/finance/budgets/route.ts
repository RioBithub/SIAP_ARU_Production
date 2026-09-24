import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canEditFinance, canSeeFinance } from "@/lib/permissions";
import { amount, required, str } from "@/lib/http";
import { auditLog } from "@/lib/audit";

export async function GET(){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canSeeFinance(user.role)) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM siap_budgets ORDER BY budget_year DESC,category ASC`);
  return NextResponse.json({ok:true,data:rows});
}
export async function POST(request:Request){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  try{
    const b=await request.json(); const year=Number(b.budget_year); if(year<2000||year>2100) throw new Error("Tahun tidak valid.");
    const category=required(b.category,"Kategori",120); const val=amount(b.amount);
    const [existing]=await db.query<RowDataPacket[]>(`SELECT id FROM siap_budgets WHERE budget_year=? AND category=? LIMIT 1`,[year,category]);
    const id=existing[0]?.id?String(existing[0].id):crypto.randomUUID();
    await db.execute(
      `INSERT INTO siap_budgets(id,budget_year,category,amount,notes,created_by,updated_by)
       VALUES(?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE amount=VALUES(amount),notes=VALUES(notes),updated_by=VALUES(updated_by)`,
      [id,year,category,val,str(b.notes,500)||null,user.id,user.id]);
    await auditLog({userId:user.id,action:"BUDGET_UPSERT",entityType:"BUDGET",entityId:id,metadata:{year,category,amount:val},request});
    return NextResponse.json({ok:true,data:{id}});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal menyimpan anggaran."},{status:400});}
}
