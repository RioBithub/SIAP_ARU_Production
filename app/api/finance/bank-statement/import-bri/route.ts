import crypto from "crypto";
import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { canEditFinance } from "@/lib/permissions";
import { db, withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { saveUpload, deleteStoredFile } from "@/lib/upload";
import { extractPdfText } from "@/lib/pdf-text";
import { parseBriStatementText } from "@/lib/bri-statement-parser";

export const runtime="nodejs";

function digits(v:unknown){return String(v||"").replace(/\D/g,"");}

export async function POST(request:Request){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance/Root yang dapat import rekening koran."},{status:403});

  let saved:null|Awaited<ReturnType<typeof saveUpload>>=null;
  let committed=false;
  try{
    const fd=await request.formData();
    const file=fd.get("file");
    if(!(file instanceof File)) throw new Error("Pilih PDF rekening koran BRI.");
    if(!/\.pdf$/i.test(file.name)) throw new Error("File harus PDF.");

    const bytes=Buffer.from(await file.arrayBuffer());
    const fileHash=crypto.createHash("sha256").update(bytes).digest("hex");
    const text=await extractPdfText(file);
    const parsed=parseBriStatementText(text);

    const requestedAccountId=String(fd.get("account_id")||"").trim();
    let account:any=null;
    if(requestedAccountId){
      const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM siap_bank_accounts WHERE id=? AND is_active=1 LIMIT 1`,[requestedAccountId]);
      account=rows[0]||null;
    }else{
      const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM siap_bank_accounts WHERE is_active=1 ORDER BY created_at ASC`);
      account=rows.find((r:any)=>digits(r.account_number)===parsed.account_number)||null;
    }
    if(!account) throw new Error(`Rekening ${parsed.account_number} dari PDF belum terdaftar di SIAP.`);
    if(digits(account.account_number)!==parsed.account_number){
      throw new Error(`Nomor rekening PDF (${parsed.account_number}) tidak sama dengan rekening yang dipilih (${account.account_number}).`);
    }

    const [existing]=await db.query<RowDataPacket[]>(
      `SELECT id,DATE_FORMAT(period_from,'%Y-%m-%d') period_from,DATE_FORMAT(period_to,'%Y-%m-%d') period_to
       FROM siap_bank_import_batches
       WHERE bank_account_id=? AND file_hash=? AND status='ACTIVE' LIMIT 1`,
      [account.id,fileHash]
    );
    if(existing[0]){
      return NextResponse.json({ok:false,error:`PDF yang sama sudah pernah diimport untuk periode ${existing[0].period_from} s.d. ${existing[0].period_to}.`},{status:409});
    }

    saved=await saveUpload(file,"ADDITIONAL");
    const batchId=crypto.randomUUID();
    const documentId=crypto.randomUUID();

    const result=await withTransaction(async conn=>{
      await conn.execute(
        `INSERT INTO siap_bank_documents
         (id,bank_account_id,document_date,period_from,period_to,document_kind,description,original_name,stored_name,storage_path,mime_type,original_size,stored_size,is_compressed,uploaded_by)
         VALUES(?,?,?,?,?,'REKENING_KORAN_BRI',?,?,?,?,?,?,?,?,?)`,
        [documentId,account.id,parsed.statement_date,parsed.period_from,parsed.period_to,
         `Import otomatis rekening koran BRI ${parsed.period_from} s.d. ${parsed.period_to}`,
         saved!.originalName,saved!.storedName,saved!.storagePath,saved!.mimeType,saved!.originalSize,saved!.storedSize,saved!.isCompressed?1:0,user.id]
      );

      await conn.execute(
        `INSERT INTO siap_bank_import_batches
         (id,bank_account_id,source_bank,source_format,parser_version,original_name,file_hash,statement_date,period_from,period_to,
          statement_opening_balance,statement_closing_balance,total_debit,total_credit,source_transaction_count,source_document_id,
          parse_warnings_json,parsed_json,status,created_by)
         VALUES(?,?,'BRI','BRI_IBBIZ_PDF','1.0',?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`,
        [batchId,account.id,file.name,fileHash,parsed.statement_date,parsed.period_from,parsed.period_to,
         parsed.opening_balance,parsed.closing_balance,parsed.total_debit,parsed.total_credit,parsed.transactions.length,documentId,
         JSON.stringify(parsed.warnings),JSON.stringify(parsed),user.id]
      );

      let inserted=0,duplicates=0;
      for(const tx of parsed.transactions){
        const id=crypto.randomUUID();
        const [r]=await conn.execute<ResultSetHeader>(
          `INSERT IGNORE INTO siap_bank_transactions
           (id,bank_account_id,import_batch_id,external_fingerprint,transaction_at,description,teller_id,reference_no,
            debit_amount,credit_amount,source_balance_after,notes,status,created_by,updated_by)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`,
          [id,account.id,batchId,tx.fingerprint,tx.transaction_at,tx.description,tx.teller_id,null,
           tx.debit_amount,tx.credit_amount,tx.balance_after,`Import BRI PDF: ${file.name}`,user.id,user.id]
        );
        if(r.affectedRows>0) inserted++; else duplicates++;
      }

      await conn.execute(
        `UPDATE siap_bank_import_batches SET inserted_count=?,duplicate_count=? WHERE id=?`,
        [inserted,duplicates,batchId]
      );
      return {inserted,duplicates};
    });
    committed=true;

    await auditLog({
      userId:user.id,action:"BANK_BRI_PDF_IMPORT",entityType:"BANK_IMPORT",entityId:batchId,request,
      metadata:{accountId:String(account.id),accountNumber:parsed.account_number,statementDate:parsed.statement_date,periodFrom:parsed.period_from,periodTo:parsed.period_to,inserted:result.inserted,duplicates:result.duplicates,openingBalance:parsed.opening_balance,closingBalance:parsed.closing_balance}
    }).catch(error=>console.error("BANK_BRI_PDF_IMPORT audit failed",error));

    return NextResponse.json({ok:true,data:{
      id:batchId,account_id:String(account.id),account_number:parsed.account_number,
      statement_date:parsed.statement_date,period_from:parsed.period_from,period_to:parsed.period_to,
      opening_balance:parsed.opening_balance,closing_balance:parsed.closing_balance,
      total_debit:parsed.total_debit,total_credit:parsed.total_credit,
      source_transaction_count:parsed.transactions.length,inserted_count:result.inserted,duplicate_count:result.duplicates,
      warnings:parsed.warnings
    }},{status:201});
  }catch(e){
    if(saved&&!committed) await deleteStoredFile(saved.storagePath).catch(()=>{});
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Import PDF BRI gagal."},{status:400});
  }
}
