import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { canEditFinance } from "@/lib/permissions";
import { db } from "@/lib/db";
import { BankWriteError, bankWriteStatus, withBankAccountWrite } from "@/lib/bank-write";
import { auditLog } from "@/lib/audit";
import { deleteStoredFile } from "@/lib/upload";

export const runtime="nodejs";

export async function DELETE(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance/Root yang dapat menghapus dokumen bank."},{status:403});

  try{
    const [rows]=await db.query<RowDataPacket[]>(
      `SELECT id,bank_account_id,original_name,storage_path,document_kind,document_date,period_from,period_to
       FROM siap_bank_documents WHERE id=? LIMIT 1`,[params.id]
    );
    const doc=rows[0];
    if(!doc) return NextResponse.json({ok:false,error:"Dokumen bank tidak ditemukan."},{status:404});

    await withBankAccountWrite(user.role,String(doc.bank_account_id),async conn=>{
      const [[current]]=await conn.query<RowDataPacket[]>("SELECT id FROM siap_bank_documents WHERE id=?", [params.id]);
      if(!current) throw new BankWriteError("Dokumen bank tidak ditemukan.",404);
      await conn.execute(`DELETE FROM siap_bank_documents WHERE id=?`,[params.id]);
      await auditLog({
        user,action:"BANK_DOCUMENT_DELETE",entityType:"BANK_DOCUMENT",entityId:params.id,request,
        metadata:{
          accountId:String(doc.bank_account_id),originalName:String(doc.original_name),documentKind:String(doc.document_kind),
          documentDate:String(doc.document_date),periodFrom:doc.period_from?String(doc.period_from):null,
          periodTo:doc.period_to?String(doc.period_to):null,permanent:true,
        },
      },conn);
    });
    let fileWarning:string|null=null;
    try {
      await deleteStoredFile(String(doc.storage_path));
    } catch {
      console.error("BANK_DOCUMENT physical delete failed", params.id);
      fileWarning="Dokumen sudah dihapus dari daftar. File fisik gagal dibersihkan.";
    }
    return NextResponse.json({ok:true,data:{deleted:true,file_warning:fileWarning}});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal menghapus dokumen bank."},{status:bankWriteStatus(e)});
  }
}
