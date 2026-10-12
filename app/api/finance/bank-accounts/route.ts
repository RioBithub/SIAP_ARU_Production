import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { canEditFinance, canSeeBankStatement } from "@/lib/permissions";
import { amount, dateOnly, required, str } from "@/lib/http";

export const runtime="nodejs";

export async function GET(){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canSeeBankStatement(user.role)) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT a.*,u.name updated_by_name
     FROM siap_bank_accounts a
     JOIN siap_users u ON u.id=a.updated_by
     WHERE a.is_active=1
     ORDER BY a.bank_name,a.account_name,a.account_number`
  );
  return NextResponse.json({ok:true,data:rows});
}

export async function POST(request:Request){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance/Root yang dapat menambah rekening."},{status:403});
  try{
    const b=await request.json();
    const id=crypto.randomUUID();
    const bankName=required(b.bank_name,"Nama bank",150);
    const accountName=required(b.account_name,"Nama rekening",200);
    const accountNumber=required(b.account_number,"Nomor rekening",120);
    const openingBalance=amount(b.opening_balance,"Saldo awal");
    const openingBalanceDate=dateOnly(b.opening_balance_date,"Tanggal saldo awal");
    await db.execute(
      `INSERT INTO siap_bank_accounts
       (id,bank_name,account_name,account_number,product_name,currency,branch_name,unit_name,company_address,opening_balance,opening_balance_date,is_active,created_by,updated_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      [id,bankName,accountName,accountNumber,str(b.product_name,150)||null,(str(b.currency,10)||"IDR").toUpperCase(),str(b.branch_name,180)||null,str(b.unit_name,180)||null,str(b.company_address,500)||null,openingBalance,openingBalanceDate,user.id,user.id]
    );
    await auditLog({userId:user.id,action:"BANK_ACCOUNT_CREATE",entityType:"BANK_ACCOUNT",entityId:id,metadata:{bankName,accountName,accountNumber,openingBalance,openingBalanceDate},request});
    return NextResponse.json({ok:true,data:{id}},{status:201});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal menambah rekening."},{status:400});
  }
}
