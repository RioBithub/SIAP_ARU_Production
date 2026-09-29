import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { required, str } from "@/lib/http";

export async function GET(request:Request){
  const user=await getCurrentUser();
  if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const url=new URL(request.url);
  const activeOnly=url.searchParams.get("active")==="1" || user.role!=="ROOT_ADMIN";
  const params:unknown[]=[];
  let where="WHERE direction='OUTGOING'";
  if(activeOnly)where+=" AND is_active=1";

  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT id,code,name,direction,description,is_active,created_at,updated_at
     FROM siap_document_types
     ${where}
     ORDER BY name ASC`,
    params
  );
  return NextResponse.json({ok:true,data:rows});
}

export async function POST(request:Request){
  const user=await getCurrentUser();
  if(!user)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN")return NextResponse.json({ok:false,error:"Forbidden"},{status:403});

  try{
    const b=await request.json();
    const code=required(b.code,"Kode jenis",80).toUpperCase().replace(/[^A-Z0-9_]+/g,"_").replace(/^_+|_+$/g,"");
    if(!code)throw new Error("Kode jenis tidak valid.");

    const name=required(b.name,"Nama jenis",150);
    const description=str(b.description,500)||null;
    const id=crypto.randomUUID();

    await db.execute(
      `INSERT INTO siap_document_types
       (id,code,name,direction,description,is_active,created_by)
       VALUES(?,?,?,'OUTGOING',?,1,?)`,
      [id,code,name,description,user.id]
    );

    await auditLog({
      userId:user.id,
      action:"DOCUMENT_TYPE_CREATE",
      entityType:"DOCUMENT_TYPE",
      entityId:id,
      metadata:{code,name,direction:"OUTGOING"},
      request
    });

    return NextResponse.json({ok:true,data:{id,code}},{status:201});
  }catch(e){
    const raw=e instanceof Error?e.message:"Gagal membuat jenis surat.";
    const message=raw.includes("Duplicate entry")?"Kode jenis surat sudah digunakan.":raw;
    return NextResponse.json({ok:false,error:message},{status:400});
  }
}
