import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { canSeeBankStatement } from "@/lib/permissions";
import { db } from "@/lib/db";

export const runtime="nodejs";

export async function GET(request:Request){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canSeeBankStatement(user.role)) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  try{
    const url=new URL(request.url);
    const accountId=String(url.searchParams.get("account_id")||"").trim();
    const params:any[]=[];
    let where="";
    if(accountId){where="WHERE b.bank_account_id=?";params.push(accountId);}
    const [rows]=await db.query<RowDataPacket[]>(
      `SELECT b.id,b.bank_account_id,a.bank_name,a.account_name,a.account_number,b.original_name,b.source_bank,b.source_format,b.parser_version,
              DATE_FORMAT(b.statement_date,'%Y-%m-%d') statement_date,
              DATE_FORMAT(b.period_from,'%Y-%m-%d') period_from,
              DATE_FORMAT(b.period_to,'%Y-%m-%d') period_to,
              b.statement_opening_balance,b.statement_closing_balance,b.manual_opening_balance,b.manual_closing_balance,
              COALESCE(b.manual_opening_balance,b.statement_opening_balance) effective_opening_balance,
              COALESCE(b.manual_closing_balance,b.statement_closing_balance) effective_closing_balance,
              b.total_debit,b.total_credit,b.source_transaction_count,b.inserted_count,b.duplicate_count,b.source_document_id,
              b.parse_warnings_json,b.status,b.created_at,b.corrected_at,b.undone_at,b.undo_reason,
              creator.name creator_name,corrector.name corrected_by_name,undoer.name undone_by_name
       FROM siap_bank_import_batches b
       JOIN siap_bank_accounts a ON a.id=b.bank_account_id
       JOIN siap_users creator ON creator.id=b.created_by
       LEFT JOIN siap_users corrector ON corrector.id=b.corrected_by
       LEFT JOIN siap_users undoer ON undoer.id=b.undone_by
       ${where}
       ORDER BY b.period_to DESC,b.statement_date DESC,b.created_at DESC
       LIMIT 100`,params
    );
    const data=rows.map((r:any)=>({...r,parse_warnings:(()=>{try{return JSON.parse(String(r.parse_warnings_json||"[]"))}catch{return []}})()}));
    return NextResponse.json({ok:true,data});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal memuat riwayat import."},{status:400});
  }
}
