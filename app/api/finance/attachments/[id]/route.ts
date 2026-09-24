import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canEditFinance, canSeeFinance } from "@/lib/permissions";
import { deleteStoredFile, readStoredFile, safeFilename } from "@/lib/upload";
import { auditLog } from "@/lib/audit";

export const runtime="nodejs";

export async function GET(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser(); if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canSeeFinance(user.role))return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM siap_finance_attachments WHERE id=? LIMIT 1`,[params.id]);
  const a=rows[0]; if(!a)return NextResponse.json({ok:false,error:"Lampiran tidak ditemukan."},{status:404});
  try{
    const data=await readStoredFile(String(a.storage_path),Boolean(a.is_compressed));
    await auditLog({userId:user.id,action:"FINANCE_ATTACHMENT_DOWNLOAD",entityType:"FINANCE_ATTACHMENT",entityId:params.id,request});
    return new Response(data,{headers:{
      "Content-Type":String(a.mime_type||"application/octet-stream"),
      "Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(safeFilename(String(a.original_name)))}`,
      "Cache-Control":"private, no-store"
    }});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal membaca file."},{status:500});}
}

export async function DELETE(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser(); if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role))return NextResponse.json({ok:false,error:"Hanya Finance dan Root Admin yang dapat menghapus lampiran."},{status:403});
  try{
    const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM siap_finance_attachments WHERE id=? LIMIT 1`,[params.id]);
    const a=rows[0]; if(!a)return NextResponse.json({ok:false,error:"Lampiran tidak ditemukan."},{status:404});
    await deleteStoredFile(String(a.storage_path));
    await db.execute(`DELETE FROM siap_finance_attachments WHERE id=?`,[params.id]);
    await auditLog({userId:user.id,action:"FINANCE_ATTACHMENT_DELETE",entityType:"FINANCE_ATTACHMENT",entityId:params.id,metadata:{
      original_name:String(a.original_name||""),attachment_kind:String(a.attachment_kind||""),summary_id:a.summary_id||null,receivable_id:a.receivable_id||null,payable_id:a.payable_id||null,ledger_summary_id:a.ledger_summary_id||null,adjustment_id:a.adjustment_id||null,position_adjustment_id:a.position_adjustment_id||null
    },request});
    return NextResponse.json({ok:true});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal menghapus lampiran."},{status:400});}
}
