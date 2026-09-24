import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canEditFinance, canSeeFinance } from "@/lib/permissions";
import { amount, dateOnly, required, str } from "@/lib/http";
import { auditLog } from "@/lib/audit";

export async function GET(request:Request){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canSeeFinance(user.role)) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  const type=new URL(request.url).searchParams.get("type");
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT f.*,u.name creator_name FROM siap_finance_entries f JOIN siap_users u ON u.id=f.created_by
     ${type?"WHERE f.entry_type=?":""} ORDER BY f.entry_date DESC,f.created_at DESC LIMIT 300`,type?[type]:[]);
  return NextResponse.json({ok:true,data:rows});
}
export async function POST(request:Request){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance/Root yang dapat input data."},{status:403});
  try{
    const b=await request.json(); const type=required(b.entry_type,"Jenis",20).toUpperCase();
    if(!["INCOME","EXPENSE"].includes(type)) throw new Error("Jenis transaksi tidak valid.");
    const id=crypto.randomUUID();
    await db.execute(
      `INSERT INTO siap_finance_entries(id,entry_type,entry_date,category,description,amount,status,reference_no,created_by,updated_by)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [id,type,dateOnly(b.entry_date,"Tanggal"),required(b.category,"Kategori",120),required(b.description,"Deskripsi",500),amount(b.amount),str(b.status,30)||"POSTED",str(b.reference_no,120)||null,user.id,user.id]
    );
    await auditLog({userId:user.id,action:"FINANCE_ENTRY_CREATE",entityType:"FINANCE_ENTRY",entityId:id,metadata:{type,amount:Number(b.amount)},request});
    return NextResponse.json({ok:true,data:{id}},{status:201});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Input gagal."},{status:400});}
}
