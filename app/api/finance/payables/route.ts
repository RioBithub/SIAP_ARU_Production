import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canEditFinance, canSeeFinance } from "@/lib/permissions";
import { amount, dateOnly, required, str } from "@/lib/http";
import { auditLog } from "@/lib/audit";

import { invoiceKey } from "@/lib/v11-data";

export async function GET(){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canSeeFinance(user.role)) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT p.*,v.letter_id AS v11_invoice_id,
      DATEDIFF(CURDATE(),p.due_date) AS overdue_days,
      GREATEST(p.amount-p.paid_amount,0) AS outstanding
     FROM siap_payables p LEFT JOIN siap_v11_letters v ON v.payable_id=p.id
     ORDER BY p.due_date ASC,p.created_at DESC LIMIT 500`);
  return NextResponse.json({ok:true,data:rows});
}
export async function POST(request:Request){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance/Root yang dapat input data."},{status:403});
  try{
    const b=await request.json(); const id=crypto.randomUUID();
    const counterparty=required(b.counterparty,"Pihak",255);
    const invoiceNo=required(b.invoice_no,"Nomor invoice",120);
    const [workflow]=await db.query<RowDataPacket[]>(
      `SELECT 1 FROM siap_v11_letters v JOIN siap_letters l ON l.id=v.letter_id
       WHERE v.invoice_key=? AND l.status NOT IN ('REJECTED','CANCELLED') LIMIT 1`,
      [invoiceKey(counterparty,invoiceNo)],
    );
    if(workflow.length) throw new Error("Gunakan instruksi pembayaran pada Invoice Masuk V11 yang terhubung.");
    const total=amount(b.amount); const paid=amount(b.paid_amount||0,"Sudah dibayar");
    if(paid>total) throw new Error("Nilai dibayar tidak boleh melebihi total.");
    const status=paid>=total?"PAID":(paid>0?"PARTIAL":(str(b.status,30)||"OPEN"));
    await db.execute(
      `INSERT INTO siap_payables
       (id,counterparty,invoice_no,invoice_date,due_date,amount,paid_amount,status,notes,created_by,updated_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [id,counterparty,invoiceNo,dateOnly(b.invoice_date,"Tanggal invoice"),dateOnly(b.due_date,"Jatuh tempo"),total,paid,status,str(b.notes,1000)||null,user.id,user.id]);
    await auditLog({userId:user.id,action:"PAYABLE_CREATE",entityType:"PAYABLE",entityId:id,metadata:{amount:total,paid},request});
    return NextResponse.json({ok:true,data:{id}},{status:201});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Input gagal."},{status:400});}
}
