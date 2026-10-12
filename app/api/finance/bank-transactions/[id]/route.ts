import { NextResponse } from "next/server";
import type { ResultSetHeader,RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { canEditFinance } from "@/lib/permissions";
import { amount, required, str } from "@/lib/http";

export const runtime="nodejs";

function dateTime(value:unknown){
  const raw=required(value,"Tanggal transaksi",19);
  if(!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(raw)) throw new Error("Tanggal transaksi tidak valid.");
  const normalized=raw.replace("T"," ");
  return normalized.length===16?`${normalized}:00`:normalized;
}
function txAmounts(debitRaw:unknown,creditRaw:unknown){
  const debit=amount(debitRaw??0,"Debit");
  const credit=amount(creditRaw??0,"Kredit");
  if((debit>0&&credit>0)||(debit<=0&&credit<=0)) throw new Error("Isi salah satu nominal Debit atau Kredit, tidak boleh keduanya.");
  return {debit,credit};
}

export async function PATCH(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance/Root yang dapat mengubah transaksi."},{status:403});
  try{
    const b=await request.json();
    const transactionAt=dateTime(b.transaction_at);
    const description=required(b.description,"Uraian transaksi",500);
    const {debit,credit}=txAmounts(b.debit_amount,b.credit_amount);
    const [result]=await db.execute<ResultSetHeader>(
      `UPDATE siap_bank_transactions
       SET transaction_at=?,description=?,teller_id=?,reference_no=?,debit_amount=?,credit_amount=?,notes=?,updated_by=?
       WHERE id=? AND status='ACTIVE'`,
      [transactionAt,description,str(b.teller_id,120)||null,str(b.reference_no,120)||null,debit,credit,str(b.notes,1000)||null,user.id,params.id]
    );
    if(!result.affectedRows) return NextResponse.json({ok:false,error:"Transaksi tidak ditemukan atau sudah dibatalkan."},{status:404});
    await auditLog({userId:user.id,action:"BANK_TRANSACTION_UPDATE",entityType:"BANK_TRANSACTION",entityId:params.id,metadata:{transactionAt,debit,credit,description},request});
    return NextResponse.json({ok:true});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal mengubah transaksi."},{status:400});
  }
}

export async function DELETE(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance/Root yang dapat membatalkan transaksi."},{status:403});
  try{
    const body=await request.json().catch(()=>({}));
    const reason=required(body.reason,"Alasan pembatalan",1000);
    const [rows]=await db.query<RowDataPacket[]>(`SELECT bank_account_id,transaction_at,debit_amount,credit_amount,description,status FROM siap_bank_transactions WHERE id=? LIMIT 1`,[params.id]);
    const tx=rows[0];
    if(!tx) return NextResponse.json({ok:false,error:"Transaksi tidak ditemukan."},{status:404});
    if(String(tx.status)!=="ACTIVE") throw new Error("Transaksi sudah dibatalkan.");
    await db.execute(
      `UPDATE siap_bank_transactions SET status='VOIDED',void_reason=?,voided_by=?,voided_at=UTC_TIMESTAMP(),updated_by=? WHERE id=?`,
      [reason,user.id,user.id,params.id]
    );
    await auditLog({userId:user.id,action:"BANK_TRANSACTION_VOID",entityType:"BANK_TRANSACTION",entityId:params.id,metadata:{reason,accountId:String(tx.bank_account_id),transactionAt:String(tx.transaction_at),debit:Number(tx.debit_amount||0),credit:Number(tx.credit_amount||0),description:String(tx.description)},request});
    return NextResponse.json({ok:true});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal membatalkan transaksi."},{status:400});
  }
}
