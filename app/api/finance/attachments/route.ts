import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canEditFinance, canSeeFinance } from "@/lib/permissions";
import { saveUpload } from "@/lib/upload";
import { auditLog } from "@/lib/audit";
import { ledgerMeta, normalizeKind } from "@/lib/finance-ledger";
import { assertEditableFinanceMonth, parseFinanceMonth } from "@/lib/finance-period";

export const runtime="nodejs";

const mapEntity=(type:string)=>{
  const t=type.toUpperCase();
  if(t==="SUMMARY") return {column:"summary_id",table:"siap_finance_monthly_summaries"};
  if(t==="RECEIVABLE") return {column:"receivable_id",table:"siap_receivables"};
  if(t==="PAYABLE") return {column:"payable_id",table:"siap_payables"};
  if(t==="LEDGER_SUMMARY") return {column:"ledger_summary_id",table:"siap_finance_position_summaries"};
  if(t==="ADJUSTMENT") return {column:"adjustment_id",table:"siap_finance_adjustments"};
  if(t==="POSITION_ADJUSTMENT") return {column:"position_adjustment_id",table:"siap_finance_position_adjustments"};
  throw new Error("Jenis lampiran tidak valid.");
};
async function resolveEntity(type:string,entityId:string,periodMonth:string,ledgerKind:string,userId:string,create=false){
  if(type==="SUMMARY"&&!entityId){
    const period=(create?assertEditableFinanceMonth(periodMonth):parseFinanceMonth(periodMonth)).sqlDate;
    const [rows]=await db.query<RowDataPacket[]>(`SELECT id FROM siap_finance_monthly_summaries WHERE period_month=? LIMIT 1`,[period]);
    entityId=String(rows[0]?.id||"");
    if(!entityId&&create){
      entityId=crypto.randomUUID();
      await db.execute(`INSERT INTO siap_finance_monthly_summaries(id,period_month,created_by,updated_by) VALUES(?,?,?,?)`,[entityId,period,userId,userId]);
    }
  }
  if(type==="LEDGER_SUMMARY"&&!entityId){
    const kind=normalizeKind(ledgerKind);
    const {ledgerType}=ledgerMeta(kind);
    const [rows]=await db.query<RowDataPacket[]>(`SELECT id FROM siap_finance_position_summaries WHERE ledger_type=? LIMIT 1`,[ledgerType]);
    entityId=String(rows[0]?.id||"");
    if(!entityId&&create){
      entityId=crypto.randomUUID();
      await db.execute(
        `INSERT INTO siap_finance_position_summaries(id,ledger_type,as_of_date,created_by,updated_by) VALUES(?,?,CURDATE(),?,?)`,
        [entityId,ledgerType,userId,userId]
      );
    }
  }
  return entityId;
}

export async function GET(request:Request){
  const user=await getCurrentUser(); if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canSeeFinance(user.role))return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  try{
    const url=new URL(request.url); const type=(url.searchParams.get("entity_type")||"").toUpperCase();
    const {column}=mapEntity(type);
    let entityId=url.searchParams.get("entity_id")||"";
    entityId=await resolveEntity(type,entityId,url.searchParams.get("period_month")||"",url.searchParams.get("ledger_kind")||"",user.id,false);
    if(!entityId)return NextResponse.json({ok:true,data:[]});
    const [rows]=await db.query<RowDataPacket[]>(
      `SELECT a.id,a.attachment_kind,a.original_name,a.mime_type,a.original_size,a.stored_size,a.is_compressed,a.created_at,u.name AS uploader_name
       FROM siap_finance_attachments a JOIN siap_users u ON u.id=a.uploaded_by
       WHERE a.${column}=? ORDER BY a.created_at DESC`,[entityId]);
    return NextResponse.json({ok:true,data:rows});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal memuat lampiran."},{status:400});}
}

export async function POST(request:Request){
  const user=await getCurrentUser(); if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role))return NextResponse.json({ok:false,error:"Hanya Finance dan Root Admin yang dapat mengunggah lampiran."},{status:403});
  try{
    const fd=await request.formData();
    const type=String(fd.get("entity_type")||"").toUpperCase();
    const {column,table}=mapEntity(type);
    let entityId=String(fd.get("entity_id")||"").trim();
    entityId=await resolveEntity(type,entityId,String(fd.get("period_month")||""),String(fd.get("ledger_kind")||""),user.id,true);
    if(!entityId)throw new Error("Referensi lampiran tidak ditemukan.");
    if(type==="SUMMARY") {
      const [periodRows]=await db.query<RowDataPacket[]>(`SELECT period_month FROM siap_finance_monthly_summaries WHERE id=? LIMIT 1`,[entityId]);
      if(periodRows[0]?.period_month) assertEditableFinanceMonth(periodRows[0].period_month);
    }
    if(type==="ADJUSTMENT") {
      const [periodRows]=await db.query<RowDataPacket[]>(`SELECT s.period_month FROM siap_finance_adjustments a JOIN siap_finance_monthly_summaries s ON s.id=a.summary_id WHERE a.id=? LIMIT 1`,[entityId]);
      if(periodRows[0]?.period_month) assertEditableFinanceMonth(periodRows[0].period_month);
    }
    const [exists]=await db.query<RowDataPacket[]>(`SELECT id FROM ${table} WHERE id=? LIMIT 1`,[entityId]);
    if(!exists[0])throw new Error("Data tujuan lampiran tidak ditemukan.");
    const file=fd.get("file"); if(!(file instanceof File))throw new Error("Pilih file lampiran.");
    const saved=await saveUpload(file,"ADDITIONAL");
    const id=crypto.randomUUID();
    const kind=String(fd.get("attachment_kind")||"SUPPORTING").slice(0,40);
    const cols={summary_id:null as string|null,receivable_id:null as string|null,payable_id:null as string|null,ledger_summary_id:null as string|null,adjustment_id:null as string|null,position_adjustment_id:null as string|null};
    (cols as any)[column]=entityId;
    await db.execute(
      `INSERT INTO siap_finance_attachments(id,summary_id,receivable_id,payable_id,ledger_summary_id,adjustment_id,position_adjustment_id,attachment_kind,original_name,stored_name,storage_path,mime_type,original_size,stored_size,is_compressed,uploaded_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,cols.summary_id,cols.receivable_id,cols.payable_id,cols.ledger_summary_id,cols.adjustment_id,cols.position_adjustment_id,kind,saved.originalName,saved.storedName,saved.storagePath,saved.mimeType,saved.originalSize,saved.storedSize,saved.isCompressed?1:0,user.id]);
    await auditLog({userId:user.id,action:"FINANCE_ATTACHMENT_UPLOAD",entityType:type,entityId,metadata:{attachment_id:id,name:saved.originalName,compressed:saved.isCompressed,original_size:saved.originalSize,stored_size:saved.storedSize},request});
    return NextResponse.json({ok:true,data:{id,entity_id:entityId}},{status:201});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Upload gagal."},{status:400});}
}
