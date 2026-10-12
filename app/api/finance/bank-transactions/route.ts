import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
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

export async function POST(request:Request){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance/Root yang dapat input transaksi rekening."},{status:403});
  try{
    const b=await request.json();
    const id=crypto.randomUUID();
    const accountId=required(b.bank_account_id,"Rekening",36);
    const transactionAt=dateTime(b.transaction_at);
    const [accounts]=await db.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(
         CASE WHEN MIN(i.period_from) IS NOT NULL AND MIN(i.period_from)<a.opening_balance_date THEN MIN(i.period_from) ELSE a.opening_balance_date END,
         '%Y-%m-%d') opening_date
       FROM siap_bank_accounts a
       LEFT JOIN siap_bank_import_batches i ON i.bank_account_id=a.id AND i.status='ACTIVE'
       WHERE a.id=? AND a.is_active=1 GROUP BY a.id,a.opening_balance_date LIMIT 1`,[accountId]
    );
    if(!accounts[0]) throw new Error("Rekening tidak ditemukan atau sudah nonaktif.");
    const openingDate=String(accounts[0].opening_date);
    if(transactionAt.slice(0,10)<openingDate) throw new Error(`Tanggal transaksi tidak boleh sebelum periode data rekening (${openingDate}).`);
    const description=required(b.description,"Uraian transaksi",500);
    const {debit,credit}=txAmounts(b.debit_amount,b.credit_amount);
    await db.execute(
      `INSERT INTO siap_bank_transactions
       (id,bank_account_id,transaction_at,description,teller_id,reference_no,debit_amount,credit_amount,notes,status,created_by,updated_by)
       VALUES(?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`,
      [id,accountId,transactionAt,description,str(b.teller_id,120)||null,str(b.reference_no,120)||null,debit,credit,str(b.notes,1000)||null,user.id,user.id]
    );
    await auditLog({userId:user.id,action:"BANK_TRANSACTION_CREATE",entityType:"BANK_TRANSACTION",entityId:id,metadata:{accountId,transactionAt,debit,credit,description},request});
    return NextResponse.json({ok:true,data:{id}},{status:201});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal menambah transaksi."},{status:400});
  }
}
