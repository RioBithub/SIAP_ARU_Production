import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { readStoredFile, safeFilename } from "@/lib/upload";
import { auditLog } from "@/lib/audit";
import { getAccessibleLetter } from "@/lib/letter-access";
import { dispositionAccess } from "@/lib/disposition-access";

export const runtime="nodejs";

export async function GET(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();

  if(!user)
    return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const [rows]=await db.query<RowDataPacket[]>(
    "SELECT * FROM siap_attachments WHERE id=? LIMIT 1",
    [params.id]
  );

  const a=rows[0];
  if(!a)
    return NextResponse.json({ok:false,error:"File tidak ditemukan."},{status:404});

  if(user.role!=="ROOT_ADMIN"){
    let allowed = false;
    if (a.disposition_id) {
      const access = dispositionAccess(user);
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT 1 FROM siap_dispositions d WHERE d.id=? AND ${access.clause} LIMIT 1`,
        [a.disposition_id, ...access.params],
      );
      allowed = rows.length > 0;
    } else if (a.letter_id) {
      allowed = Boolean(await getAccessibleLetter(user, a.letter_id));
    }
    if(!allowed) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  }

  try{
    const data=await readStoredFile(String(a.storage_path),Boolean(a.is_compressed));

    await auditLog({
      userId:user.id,
      action:"ATTACHMENT_DOWNLOAD",
      entityType:"ATTACHMENT",
      entityId:params.id,
      request
    });

    return new Response(data,{
      headers:{
        "Content-Type":String(a.mime_type||"application/octet-stream"),
        "Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(safeFilename(String(a.original_name)))}`,
        "Cache-Control":"private, no-store"
      }
    });

  }catch(e){
    return NextResponse.json({
      ok:false,
      error:e instanceof Error?e.message:"Gagal membaca file."
    },{status:500});
  }
}
