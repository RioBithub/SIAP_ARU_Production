import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { str } from "@/lib/http";

export async function PATCH(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN") return NextResponse.json({ok:false,error:"Forbidden"},{status:403});

  try{
    const [rows]=await db.query<RowDataPacket[]>(
      "SELECT id,code,name,direction,is_system,is_active FROM siap_document_types WHERE id=? LIMIT 1",
      [params.id]
    );
    const current=rows[0];
    if(!current) return NextResponse.json({ok:false,error:"Jenis surat tidak ditemukan."},{status:404});

    const b=await request.json();
    if(current.is_system && typeof b.is_active==="boolean" && !b.is_active){
      throw new Error("Jenis bawaan sistem tidak dapat dinonaktifkan.");
    }

    const name=str(b.name,150);
    const description=str(b.description,500);
    await db.execute(
      `UPDATE siap_document_types SET
       name=COALESCE(NULLIF(?,''),name),
       description=?,
       is_active=COALESCE(?,is_active)
       WHERE id=?`,
      [
        name,
        b.description===undefined?null:(description||null),
        typeof b.is_active==="boolean"?(b.is_active?1:0):null,
        params.id
      ]
    );

    await auditLog({
      userId:user.id,
      action:"DOCUMENT_TYPE_UPDATE",
      entityType:"DOCUMENT_TYPE",
      entityId:params.id,
      metadata:{name:name||undefined,is_active:b.is_active},
      request
    });
    return NextResponse.json({ok:true});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal update jenis surat."},{status:400});
  }
}
