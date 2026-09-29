import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { required, str } from "@/lib/http";

const DIRECTIONS=new Set(["INCOMING","OUTGOING","INTERNAL"]);

function normalizeCode(value:string){
  return value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g,"_")
    .replace(/^_+|_+$/g,"")
    .toUpperCase()
    .slice(0,80);
}

export async function GET(request:Request){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const url=new URL(request.url);
  const direction=String(url.searchParams.get("direction")||"").toUpperCase();
  const active=url.searchParams.get("active");

  const where:string[]=["1=1"];
  const params:unknown[]=[];
  if(direction){
    if(!DIRECTIONS.has(direction)) return NextResponse.json({ok:false,error:"Direction tidak valid."},{status:400});
    where.push("direction=?");params.push(direction);
  }
  if(active==="1"){where.push("is_active=1");}
  if(active==="0"){where.push("is_active=0");}

  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT * FROM siap_document_types WHERE ${where.join(" AND ")}
     ORDER BY direction ASC, name ASC`,
    params
  );
  return NextResponse.json({ok:true,data:rows});
}

export async function POST(request:Request){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN") return NextResponse.json({ok:false,error:"Forbidden"},{status:403});

  try{
    const b=await request.json();
    const name=required(b.name,"Nama jenis surat",150);
    const direction=String(b.direction||"OUTGOING").toUpperCase();
    if(!DIRECTIONS.has(direction)) throw new Error("Direction tidak valid.");

    const code=normalizeCode(str(b.code,80)||name);
    if(!code) throw new Error("Kode jenis surat tidak valid.");

    const id=crypto.randomUUID();
    await db.execute(
      `INSERT INTO siap_document_types
       (id,code,name,direction,description,is_system,is_active,created_by)
       VALUES(?,?,?,?,?,0,1,?)`,
      [id,code,name,direction,str(b.description,500)||null,user.id]
    );

    await auditLog({
      userId:user.id,
      action:"DOCUMENT_TYPE_CREATE",
      entityType:"DOCUMENT_TYPE",
      entityId:id,
      metadata:{code,name,direction},
      request
    });

    return NextResponse.json({ok:true,data:{id,code}},{status:201});
  }catch(e:any){
    const msg=e?.code==="ER_DUP_ENTRY"?"Kode jenis surat sudah digunakan.":e instanceof Error?e.message:"Gagal membuat jenis surat.";
    return NextResponse.json({ok:false,error:msg},{status:400});
  }
}
