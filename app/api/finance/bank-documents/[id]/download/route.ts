import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canSeeBankStatement } from "@/lib/permissions";
import { readStoredFile } from "@/lib/upload";

export const runtime="nodejs";

export async function GET(_request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canSeeBankStatement(user.role)) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT original_name,storage_path,mime_type,is_compressed FROM siap_bank_documents WHERE id=? LIMIT 1`,
    [params.id]
  );
  const row=rows[0];
  if(!row) return NextResponse.json({ok:false,error:"Dokumen tidak ditemukan."},{status:404});
  try{
    const bytes=await readStoredFile(String(row.storage_path),Boolean(row.is_compressed));
    const name=String(row.original_name||"dokumen");
    return new NextResponse(new Uint8Array(bytes),{headers:{
      "Content-Type":String(row.mime_type||"application/octet-stream"),
      "Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control":"private, no-store"
    }});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"File tidak dapat dibaca."},{status:404});
  }
}
