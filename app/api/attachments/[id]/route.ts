import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { readStoredFile, safeFilename } from "@/lib/upload";
import { auditLog } from "@/lib/audit";
import { getAccessibleLetter } from "@/lib/letter-access";
import { dispositionAccess } from "@/lib/disposition-access";

export const runtime="nodejs";

function previewType(name: string, data: Buffer) {
  if (/\.pdf$/i.test(name) && data.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (/\.png$/i.test(name) && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (/\.jpe?g$/i.test(name) && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  return null;
}

export async function GET(request:Request,{ params: routeParams }: { params: Promise<{ id: string }> }){
  const params = await routeParams;
  const user=await getCurrentUser();

  if(!user)
    return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT a.* FROM siap_attachments a LEFT JOIN siap_letters l ON l.id=a.letter_id
     WHERE a.id=? AND (a.letter_id IS NULL OR (l.id IS NOT NULL AND l.deleted_at IS NULL)) LIMIT 1`,
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
    const preview = new URL(request.url).searchParams.get("preview") === "1";
    const name = safeFilename(String(a.original_name));
    const mime = preview ? previewType(name, data) : "application/octet-stream";
    if (!mime) return NextResponse.json({ok:false,error:"Pratinjau tersedia untuk PDF, PNG, dan JPG yang valid."},{status:415});

    await auditLog({
      user,
      action:preview ? "ATTACHMENT_PREVIEW" : "ATTACHMENT_DOWNLOAD",
      entityType:"ATTACHMENT",
      entityId:params.id,
      request
    });

    return new Response(data,{
      headers:{
        "Content-Type":mime,
        "Content-Disposition":`${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control":"private, no-store",
        "Content-Security-Policy":"default-src 'none'; frame-ancestors 'self'; sandbox",
        "X-Content-Type-Options":"nosniff",
      }
    });

  }catch(e){
    return NextResponse.json({
      ok:false,
      error:"Gagal membaca file."
    },{status:500});
  }
}
