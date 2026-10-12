import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canEditFinance, canSeeBankStatement } from "@/lib/permissions";
import { saveUpload, deleteStoredFile } from "@/lib/upload";
import { auditLog } from "@/lib/audit";
import { dateOnly, required, str } from "@/lib/http";

export const runtime="nodejs";

function optionalDate(value:FormDataEntryValue|null,label:string){
  const raw=String(value||"").trim();
  return raw?dateOnly(raw,label):null;
}

export async function GET(request:Request){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canSeeBankStatement(user.role)) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  try{
    const url=new URL(request.url);
    const accountId=String(url.searchParams.get("account_id")||"").trim();
    const params:any[]=[];
    const where=accountId?"WHERE d.bank_account_id=?":"";
    if(accountId) params.push(accountId);
    const [rows]=await db.query<RowDataPacket[]>(
      `SELECT d.id,d.bank_account_id,a.bank_name,a.account_number,a.account_name,
              DATE_FORMAT(d.document_date,'%Y-%m-%d') document_date,
              DATE_FORMAT(d.period_from,'%Y-%m-%d') period_from,
              DATE_FORMAT(d.period_to,'%Y-%m-%d') period_to,
              d.document_kind,d.description,d.original_name,d.mime_type,d.original_size,d.stored_size,d.is_compressed,
              DATE_FORMAT(d.created_at,'%Y-%m-%d %H:%i:%s') created_at,u.name uploader_name
       FROM siap_bank_documents d
       JOIN siap_bank_accounts a ON a.id=d.bank_account_id
       JOIN siap_users u ON u.id=d.uploaded_by
       ${where}
       ORDER BY d.document_date DESC,d.created_at DESC`,params
    );
    return NextResponse.json({ok:true,data:rows});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal memuat dokumen bank."},{status:400});
  }
}

export async function POST(request:Request){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance/Root yang dapat mengunggah dokumen bank."},{status:403});
  let saved:Awaited<ReturnType<typeof saveUpload>>|null=null;
  try{
    const fd=await request.formData();
    const accountId=required(fd.get("bank_account_id"),"Rekening",36);
    const documentDate=dateOnly(fd.get("document_date"),"Tanggal dokumen");
    const periodFrom=optionalDate(fd.get("period_from"),"Periode awal");
    const periodTo=optionalDate(fd.get("period_to"),"Periode akhir");
    if(periodFrom&&periodTo&&periodFrom>periodTo) throw new Error("Periode awal tidak boleh melewati periode akhir.");
    const kind=(str(fd.get("document_kind"),80)||"LAINNYA").toUpperCase();
    const description=str(fd.get("description"),500)||null;
    const [accountRows]=await db.query<RowDataPacket[]>(`SELECT id FROM siap_bank_accounts WHERE id=? AND is_active=1 LIMIT 1`,[accountId]);
    if(!accountRows[0]) throw new Error("Rekening tidak ditemukan.");
    const file=fd.get("file");
    if(!(file instanceof File)) throw new Error("Pilih file dokumen.");
    saved=await saveUpload(file,"ADDITIONAL");
    const id=crypto.randomUUID();
    await db.execute(
      `INSERT INTO siap_bank_documents
       (id,bank_account_id,document_date,period_from,period_to,document_kind,description,original_name,stored_name,storage_path,mime_type,original_size,stored_size,is_compressed,uploaded_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,accountId,documentDate,periodFrom,periodTo,kind,description,saved.originalName,saved.storedName,saved.storagePath,saved.mimeType,saved.originalSize,saved.storedSize,saved.isCompressed?1:0,user.id]
    );
    await auditLog({userId:user.id,action:"BANK_DOCUMENT_UPLOAD",entityType:"BANK_DOCUMENT",entityId:id,metadata:{accountId,documentDate,periodFrom,periodTo,kind,name:saved.originalName},request});
    return NextResponse.json({ok:true,data:{id}},{status:201});
  }catch(e){
    if(saved) await deleteStoredFile(saved.storagePath).catch(()=>{});
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Upload dokumen gagal."},{status:400});
  }
}
