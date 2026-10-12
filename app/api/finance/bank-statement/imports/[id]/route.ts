import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { canEditFinance } from "@/lib/permissions";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { amount } from "@/lib/http";

export const runtime="nodejs";

export async function PATCH(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance/Root yang dapat mengoreksi saldo import."},{status:403});
  try{
    const body=await request.json();
    const opening=amount(body.opening_balance,"Saldo awal");
    const closing=amount(body.closing_balance,"Saldo akhir");
    const [rows]=await db.query<RowDataPacket[]>(`SELECT id,bank_account_id,status,statement_opening_balance,statement_closing_balance FROM siap_bank_import_batches WHERE id=? LIMIT 1`,[params.id]);
    const batch=rows[0];
    if(!batch) return NextResponse.json({ok:false,error:"Riwayat import tidak ditemukan."},{status:404});
    if(String(batch.status)!=="ACTIVE") throw new Error("Import yang sudah di-undo tidak dapat dikoreksi.");
    await db.execute(
      `UPDATE siap_bank_import_batches
       SET manual_opening_balance=?,manual_closing_balance=?,corrected_by=?,corrected_at=UTC_TIMESTAMP()
       WHERE id=?`,[opening,closing,user.id,params.id]
    );
    await auditLog({userId:user.id,action:"BANK_IMPORT_BALANCE_CORRECTION",entityType:"BANK_IMPORT",entityId:params.id,request,metadata:{accountId:String(batch.bank_account_id),sourceOpening:Number(batch.statement_opening_balance),sourceClosing:Number(batch.statement_closing_balance),manualOpening:opening,manualClosing:closing}});
    return NextResponse.json({ok:true});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal mengoreksi saldo import."},{status:400});
  }
}
