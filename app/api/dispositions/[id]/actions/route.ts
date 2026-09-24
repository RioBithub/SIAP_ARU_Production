import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { str } from "@/lib/http";

export const runtime="nodejs";

export async function POST(request:Request,{params}:{params:{id:string}}) {
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  try{
    const b=await request.json();
    const action=String(b.action||"").toUpperCase();
    const note=str(b.note,5000);
    const [rows]=await db.query<RowDataPacket[]>(`SELECT d.*,l.direction letter_direction FROM siap_dispositions d JOIN siap_letters l ON l.id=d.letter_id WHERE d.id=? LIMIT 1`,[params.id]);
    const d=rows[0]; if(!d) throw new Error("Disposisi tidak ditemukan.");
    if(user.role!=="ROOT_ADMIN" && d.to_user_id!==user.id && d.from_user_id!==user.id) throw new Error("Tidak berhak memproses disposisi ini.");
    if(action==="SEEN"){
      if(user.role!=="ROOT_ADMIN" && d.to_user_id!==user.id) throw new Error("Hanya penerima yang dapat menandai dilihat.");
      await db.execute(`UPDATE siap_dispositions SET status=IF(status='UNSEEN','SEEN',status),seen_at=COALESCE(seen_at,UTC_TIMESTAMP()) WHERE id=?`,[params.id]);
    }else if(action==="START"){
      if(user.role!=="ROOT_ADMIN" && d.to_user_id!==user.id) throw new Error("Hanya penerima yang dapat memulai.");
      await db.execute(`UPDATE siap_dispositions SET status='IN_PROGRESS',seen_at=COALESCE(seen_at,UTC_TIMESTAMP()),started_at=COALESCE(started_at,UTC_TIMESTAMP()) WHERE id=?`,[params.id]);
      if(String(d.letter_direction)!=="OUTGOING") await db.execute(`UPDATE siap_letters SET status='IN_PROGRESS',updated_by=? WHERE id=?`,[user.id,d.letter_id]);
    }else if(action==="COMPLETE"){
      if(user.role!=="ROOT_ADMIN" && d.to_user_id!==user.id) throw new Error("Hanya penerima yang dapat menyelesaikan.");
      await db.execute(`UPDATE siap_dispositions SET status='COMPLETED',completed_at=UTC_TIMESTAMP() WHERE id=?`,[params.id]);
      const [pending]=await db.query<RowDataPacket[]>(`SELECT COUNT(*) c FROM siap_dispositions WHERE letter_id=? AND status NOT IN ('COMPLETED','RETURNED')`,[d.letter_id]);
      if(Number(pending[0]?.c||0)===0 && String(d.letter_direction)!=="OUTGOING") await db.execute(`UPDATE siap_letters SET status='COMPLETED',updated_by=? WHERE id=?`,[user.id,d.letter_id]);
    }else if(action==="RETURN"){
      if(!note) throw new Error("Catatan return wajib diisi.");
      if(user.role!=="ROOT_ADMIN" && d.to_user_id!==user.id) throw new Error("Hanya penerima yang dapat mengembalikan.");
      await db.execute(`UPDATE siap_dispositions SET status='RETURNED',returned_at=UTC_TIMESTAMP(),return_note=? WHERE id=?`,[note,params.id]);
    }else throw new Error("Action tidak valid.");
    await auditLog({userId:user.id,action:`DISPOSITION_${action}`,entityType:"DISPOSITION",entityId:params.id,metadata:{note},request});
    return NextResponse.json({ok:true});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Proses gagal."},{status:400});}
}
