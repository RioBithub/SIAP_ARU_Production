import { NextResponse } from "next/server";
import type { ResultSetHeader } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { canEditFinance } from "@/lib/permissions";
import { amount, dateOnly, required, str } from "@/lib/http";

export const runtime="nodejs";

export async function PATCH(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance/Root yang dapat mengubah rekening."},{status:403});
  try{
    const b=await request.json();
    const bankName=required(b.bank_name,"Nama bank",150);
    const accountName=required(b.account_name,"Nama rekening",200);
    const accountNumber=required(b.account_number,"Nomor rekening",120);
    const openingBalance=amount(b.opening_balance,"Saldo awal");
    const openingBalanceDate=dateOnly(b.opening_balance_date,"Tanggal saldo awal");
    const [result]=await db.execute<ResultSetHeader>(
      `UPDATE siap_bank_accounts SET bank_name=?,account_name=?,account_number=?,product_name=?,currency=?,branch_name=?,unit_name=?,company_address=?,opening_balance=?,opening_balance_date=?,updated_by=? WHERE id=? AND is_active=1`,
      [bankName,accountName,accountNumber,str(b.product_name,150)||null,(str(b.currency,10)||"IDR").toUpperCase(),str(b.branch_name,180)||null,str(b.unit_name,180)||null,str(b.company_address,500)||null,openingBalance,openingBalanceDate,user.id,params.id]
    );
    if(!result.affectedRows) return NextResponse.json({ok:false,error:"Rekening tidak ditemukan."},{status:404});
    await auditLog({userId:user.id,action:"BANK_ACCOUNT_UPDATE",entityType:"BANK_ACCOUNT",entityId:params.id,metadata:{bankName,accountName,accountNumber,openingBalance,openingBalanceDate},request});
    return NextResponse.json({ok:true});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal mengubah rekening."},{status:400});
  }
}
