import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canEditFinance } from "@/lib/permissions";
import { amount, dateOnly, required, str } from "@/lib/http";
import { auditLog } from "@/lib/audit";

export async function PATCH(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role))return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  try{
    const b=await request.json();
    const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM siap_receivables WHERE id=? LIMIT 1`,[params.id]);
    const row=rows[0];if(!row)throw new Error("Data tidak ditemukan.");
    const total=b.amount===undefined?Number(row.amount):amount(b.amount,"Total");
    const paid=b.paid_amount===undefined?Number(row.paid_amount):amount(b.paid_amount,"Sudah dibayar");
    if(paid>total)throw new Error("Nilai dibayar tidak boleh melebihi total.");
    const status=paid>=total?"PAID":paid>0?"PARTIAL":"OPEN";
    const counterparty=b.counterparty===undefined?String(row.counterparty):required(b.counterparty,"Pihak",255);
    const invoiceNo=b.invoice_no===undefined?String(row.invoice_no):required(b.invoice_no,"Nomor invoice",120);
    const invoiceDate=b.invoice_date===undefined?String(row.invoice_date).slice(0,10):dateOnly(b.invoice_date,"Tanggal invoice");
    const dueDate=b.due_date===undefined?String(row.due_date).slice(0,10):dateOnly(b.due_date,"Jatuh tempo");
    const notes=b.notes===undefined?String(row.notes||""):str(b.notes,1000);
    await db.execute(
      `UPDATE siap_receivables SET counterparty=?,invoice_no=?,invoice_date=?,due_date=?,amount=?,paid_amount=?,status=?,notes=?,updated_by=? WHERE id=?`,
      [counterparty,invoiceNo,invoiceDate,dueDate,total,paid,status,notes||null,user.id,params.id]
    );
    await auditLog({userId:user.id,action:"RECEIVABLE_UPDATE",entityType:"RECEIVABLE",entityId:params.id,metadata:{invoice_no:invoiceNo,total,paid,status,due_date:dueDate},request});
    return NextResponse.json({ok:true});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Update gagal."},{status:400});}
}

export async function DELETE(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN")return NextResponse.json({ok:false,error:"Hanya Root Admin yang dapat menghapus."},{status:403});
  const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM siap_receivables WHERE id=? LIMIT 1`,[params.id]);
  if(!rows[0])return NextResponse.json({ok:false,error:"Data tidak ditemukan."},{status:404});
  await auditLog({userId:user.id,action:"RECEIVABLE_DELETE",entityType:"RECEIVABLE",entityId:params.id,metadata:{invoice_no:rows[0].invoice_no,amount:rows[0].amount},request});
  await db.execute(`DELETE FROM siap_receivables WHERE id=?`,[params.id]);
  return NextResponse.json({ok:true});
}
