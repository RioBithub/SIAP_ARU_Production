import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { required, str } from "@/lib/http";

export async function GET(){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  const [rows]=await db.query<RowDataPacket[]>(`SELECT nf.*,
    COALESCE((SELECT MAX(nl.seq_base) FROM siap_number_ledger nl WHERE nl.format_id=nf.id AND nl.number_year=YEAR(CURDATE())),0) AS last_base,
    GREATEST(nf.sequence_start, COALESCE((SELECT MAX(nl2.seq_base) FROM siap_number_ledger nl2 WHERE nl2.format_id=nf.id AND nl2.number_year=YEAR(CURDATE())),0)+1) AS next_auto_base
    FROM siap_number_formats nf ORDER BY nf.name ASC`);
  return NextResponse.json({ok:true,data:rows});
}
export async function POST(request:Request){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN") return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  try{
    const b=await request.json(); const id=crypto.randomUUID();
    const pattern=required(b.pattern,"Pattern",255);
    if(!pattern.includes("{seq}")) throw new Error("Pattern wajib memiliki placeholder {seq}.");
    const sequenceStart=Math.max(1,Number(b.sequence_start||1));
    if(!Number.isInteger(sequenceStart)) throw new Error("Nomor awal harus berupa angka bulat.");
    await db.execute(
      `INSERT INTO siap_number_formats(id,code,name,document_type,pattern,description,sequence_start,is_active,created_by)
       VALUES(?,?,?,?,?,?,?,1,?)`,
      [id,required(b.code,"Kode",40).toUpperCase(),required(b.name,"Nama",150),required(b.document_type,"Jenis dokumen",80),pattern,str(b.description,500)||null,sequenceStart,user.id]);
    await auditLog({userId:user.id,action:"NUMBER_FORMAT_CREATE",entityType:"NUMBER_FORMAT",entityId:id,metadata:{pattern,sequenceStart},request});
    return NextResponse.json({ok:true,data:{id}},{status:201});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal membuat format."},{status:400});}
}
