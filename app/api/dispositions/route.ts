import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canCreateDisposition } from "@/lib/permissions";
import { auditLog } from "@/lib/audit";
import { dateOnly, required, str } from "@/lib/http";

export const runtime="nodejs";

export async function GET() {
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  const params:unknown[]=[];
  let visibility="";
  if(user.role!=="ROOT_ADMIN"){
    visibility=`WHERE d.visibility='PUBLIC' OR d.to_user_id=? OR d.from_user_id=? OR
      (d.visibility='ROUTE' AND EXISTS(
        SELECT 1 FROM siap_dispositions x WHERE x.letter_id=d.letter_id AND (x.to_user_id=? OR x.from_user_id=?)
      ))`;
    params.push(user.id,user.id,user.id,user.id);
  }
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT d.*,l.subject,l.letter_number,l.external_number,
      fu.name from_name,tu.name to_name
     FROM siap_dispositions d
     JOIN siap_letters l ON l.id=d.letter_id
     JOIN siap_users fu ON fu.id=d.from_user_id
     JOIN siap_users tu ON tu.id=d.to_user_id
     ${visibility}
     ORDER BY d.created_at DESC LIMIT 200`,params);
  return NextResponse.json({ok:true,data:rows});
}

export async function POST(request:Request) {
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canCreateDisposition(user.role)) return NextResponse.json({ok:false,error:"Role Anda tidak dapat membuat disposisi."},{status:403});
  try{
    const b=await request.json();
    const letterId=required(b.letter_id,"Surat",36);
    const toUser=required(b.to_user_id,"Penerima disposisi",36);
    const instruction=required(b.instruction,"Instruksi",5000);
    const visibility=["PUBLIC","ROUTE","PRIVATE"].includes(String(b.visibility||"").toUpperCase())?String(b.visibility).toUpperCase():"ROUTE";
    const priority=["NORMAL","HIGH","URGENT"].includes(String(b.priority||"").toUpperCase())?String(b.priority).toUpperCase():"NORMAL";
    const due=b.due_date?dateOnly(b.due_date,"Target selesai"):null;
    const [letters]=await db.query<RowDataPacket[]>(`SELECT status,direction FROM siap_letters WHERE id=? LIMIT 1`,[letterId]);
    if(!letters[0]) throw new Error("Surat tidak ditemukan.");
    const letterStatus=String(letters[0].status);
    if(!["APPROVED","ISSUED","DISPOSED","IN_PROGRESS","COMPLETED"].includes(letterStatus)) {
      throw new Error("Disposisi baru dapat dibuat setelah approval surat selesai.");
    }
    const id=crypto.randomUUID();
    await db.execute(
      `INSERT INTO siap_dispositions
       (id,letter_id,parent_id,from_user_id,to_user_id,visibility,instruction,status,priority,due_date)
       VALUES (?,?,?,?,?,?,?,'UNSEEN',?,?)`,
      [id,letterId,b.parent_id||null,user.id,toUser,visibility,instruction,priority,due]
    );
    if(String(letters[0].direction)!=="OUTGOING") {
      await db.execute(`UPDATE siap_letters SET status='DISPOSED',updated_by=? WHERE id=?`,[user.id,letterId]);
    }
    await auditLog({userId:user.id,action:"DISPOSITION_CREATE",entityType:"DISPOSITION",entityId:id,metadata:{letterId,toUser,visibility,priority,due},request});
    return NextResponse.json({ok:true,data:{id}},{status:201});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal membuat disposisi."},{status:400});}
}
