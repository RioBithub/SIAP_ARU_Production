import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { canEditFinance } from "@/lib/permissions";
import { withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { required } from "@/lib/http";

export const runtime="nodejs";

export async function POST(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance/Root yang dapat undo import."},{status:403});
  try{
    const body=await request.json().catch(()=>({}));
    const reason=required(body.reason,"Alasan undo",1000);
    const result=await withTransaction(async conn=>{
      const [rows]=await conn.query<RowDataPacket[]>(`SELECT id,bank_account_id,status,original_name,inserted_count FROM siap_bank_import_batches WHERE id=? FOR UPDATE`,[params.id]);
      const batch=rows[0];
      if(!batch) throw new Error("Riwayat import tidak ditemukan.");
      if(String(batch.status)!=="ACTIVE") throw new Error("Import ini sudah pernah di-undo.");
      const [countRows]=await conn.query<RowDataPacket[]>(`SELECT COUNT(*) total FROM siap_bank_transactions WHERE import_batch_id=?`,[params.id]);
      const removed=Number(countRows[0]?.total||0);
      await conn.execute(`DELETE FROM siap_bank_transactions WHERE import_batch_id=?`,[params.id]);
      await conn.execute(
        `UPDATE siap_bank_import_batches SET status='UNDONE',undone_by=?,undone_at=UTC_TIMESTAMP(),undo_reason=? WHERE id=?`,
        [user.id,reason,params.id]
      );
      return {accountId:String(batch.bank_account_id),removed,originalName:String(batch.original_name)};
    });
    await auditLog({userId:user.id,action:"BANK_BRI_IMPORT_UNDO",entityType:"BANK_IMPORT",entityId:params.id,request,metadata:{accountId:result.accountId,removedTransactions:result.removed,originalName:result.originalName,reason}});
    return NextResponse.json({ok:true,data:{removed_transactions:result.removed}});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Undo import gagal."},{status:400});
  }
}
