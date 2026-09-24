import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { cancelLedgerForLetter } from "@/lib/numbering";
import { dateOnly, str } from "@/lib/http";
import { saveUpload } from "@/lib/upload";

export const runtime="nodejs";

type Transition = { next:string; nextRole:string|null };

function approveTransition(status:string,direction:string):Transition|null {
  if(status==="MANAGER_REVIEW") return {next:"DIRECTOR_OPS_REVIEW",nextRole:"DIRECTOR_OPS"};
  if(status==="DIRECTOR_OPS_REVIEW") return {next:"PRESIDENT_DIRECTOR_REVIEW",nextRole:"PRESIDENT_DIRECTOR"};
  if(status==="PRESIDENT_DIRECTOR_REVIEW") {
    if(direction==="OUTGOING") return {next:"READY_TO_ISSUE",nextRole:"STAFF"};
    return {next:"APPROVED",nextRole:null};
  }
  return null;
}

function returnTransition(status:string,direction:string):Transition|null {
  // Surat keluar selalu kembali ke Staff penyusun agar revisi dilakukan oleh
  // satu pihak yang jelas, lalu seluruh approval chain dimulai kembali.
  if(direction==="OUTGOING" && ["MANAGER_REVIEW","DIRECTOR_OPS_REVIEW","PRESIDENT_DIRECTOR_REVIEW"].includes(status)) {
    return {next:"RETURNED_STAFF",nextRole:"STAFF"};
  }
  if(status==="MANAGER_REVIEW") return {next:"RETURNED_STAFF",nextRole:"STAFF"};
  if(status==="DIRECTOR_OPS_REVIEW") return {next:"MANAGER_REVIEW",nextRole:"MANAGER"};
  if(status==="PRESIDENT_DIRECTOR_REVIEW") return {next:"DIRECTOR_OPS_REVIEW",nextRole:"DIRECTOR_OPS"};
  return null;
}

function expectedRole(status:string) {
  if(status==="MANAGER_REVIEW") return "MANAGER";
  if(status==="DIRECTOR_OPS_REVIEW") return "DIRECTOR_OPS";
  if(status==="PRESIDENT_DIRECTOR_REVIEW") return "PRESIDENT_DIRECTOR";
  return null;
}

async function parseRequest(request:Request) {
  const type=request.headers.get("content-type")||"";
  if(type.includes("multipart/form-data")) {
    const form=await request.formData();
    return {
      action:String(form.get("action")||"").toUpperCase(),
      comment:str(form.get("comment"),5000),
      issuedDate:str(form.get("issued_date"),10),
      files:form.getAll("files").filter((x):x is File=>x instanceof File && x.size>0)
    };
  }
  const body=await request.json();
  return {
    action:String(body.action||"").toUpperCase(),
    comment:str(body.comment,5000),
    issuedDate:str(body.issued_date,10),
    files:[] as File[]
  };
}

export async function POST(request:Request,{params}:{params:{id:string}}) {
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  try{
    const parsed=await parseRequest(request);
    const {action,comment,files}=parsed;
    if(files.length>5) throw new Error("Maksimal 5 lampiran proses dalam satu aksi.");

    const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM siap_letters WHERE id=? LIMIT 1`,[params.id]);
    const letter=rows[0];
    if(!letter) return NextResponse.json({ok:false,error:"Dokumen tidak ditemukan."},{status:404});
    const status=String(letter.status);
    const direction=String(letter.direction);

    let next=status;
    let nextRole=letter.current_role ? String(letter.current_role) : null;
    let nextOwner: string|null = letter.current_owner_user_id ? String(letter.current_owner_user_id) : null;
    let issuedDate: string|null = null;

    if(action==="SUBMIT") {
      if(!["DRAFT","RETURNED_STAFF"].includes(status)) throw new Error("Dokumen tidak berada pada tahap yang dapat diajukan.");
      if(user.role!=="ROOT_ADMIN" && letter.created_by!==user.id) throw new Error("Hanya penyusun dokumen yang dapat mengajukan ulang.");
      next="MANAGER_REVIEW"; nextRole="MANAGER"; nextOwner=null;
    } else if(action==="APPROVE") {
      const expected=expectedRole(status);
      if(!expected) throw new Error("Dokumen tidak sedang menunggu approval.");
      if(user.role!=="ROOT_ADMIN" && user.role!==expected) throw new Error("Approval harus dilakukan role pada tahap saat ini.");
      const t=approveTransition(status,direction)!;
      next=t.next; nextRole=t.nextRole;
      nextOwner=next==="READY_TO_ISSUE" ? String(letter.created_by) : null;
    } else if(action==="APPROVE_FINAL") {
      if(direction!=="INTERNAL") throw new Error("Approve selesai pada level ini hanya tersedia untuk Nota Dinas.");
      if(!["MANAGER_REVIEW","DIRECTOR_OPS_REVIEW"].includes(status)) throw new Error("Tahap ini tidak dapat diselesaikan pada level sekarang.");
      const expected=expectedRole(status);
      if(user.role!=="ROOT_ADMIN" && user.role!==expected) throw new Error("Approval harus dilakukan role pada tahap saat ini.");
      next="APPROVED"; nextRole=null; nextOwner=null;
    } else if(action==="RETURN") {
      const expected=expectedRole(status);
      if(!expected) throw new Error("Dokumen tidak sedang dalam review.");
      if(user.role!=="ROOT_ADMIN" && user.role!==expected) throw new Error("Return harus dilakukan role pada tahap saat ini.");
      if(!comment) throw new Error("Catatan pengembalian wajib diisi.");
      const t=returnTransition(status,direction)!;
      next=t.next; nextRole=t.nextRole;
      nextOwner=next==="RETURNED_STAFF" ? String(letter.created_by) : null;
    } else if(action==="ISSUE") {
      if(direction!=="OUTGOING" || status!=="READY_TO_ISSUE") throw new Error("Surat belum siap diterbitkan.");
      if(user.role!=="ROOT_ADMIN" && letter.created_by!==user.id) throw new Error("Hanya Staff penyusun atau Root Admin yang dapat menerbitkan surat.");
      issuedDate=parsed.issuedDate ? dateOnly(parsed.issuedDate,"Tanggal terbit") : new Date().toISOString().slice(0,10);
      next="ISSUED"; nextRole=null; nextOwner=null;
    } else if(action==="COMPLETE") {
      if(!["ROOT_ADMIN","DIRECTOR_OPS","PRESIDENT_DIRECTOR"].includes(user.role)) throw new Error("Tidak berhak menutup dokumen.");
      next="COMPLETED"; nextRole=null; nextOwner=null;
    } else if(action==="CANCEL") {
      if(user.role!=="ROOT_ADMIN" && letter.created_by!==user.id) throw new Error("Tidak berhak membatalkan dokumen.");
      if(!comment) throw new Error("Alasan pembatalan wajib diisi.");
      next="CANCELLED"; nextRole=null; nextOwner=null;
    } else throw new Error("Action tidak dikenal.");

    // Simpan lampiran proses terlebih dahulu. Lampiran proses selalu menggunakan
    // kebijakan ADDITIONAL: maksimal 10 MB/file dan dikompresi bila efektif.
    const savedFiles=[] as Array<Awaited<ReturnType<typeof saveUpload>> & {id:string}>;
    for(const file of files) {
      const saved=await saveUpload(file,"ADDITIONAL");
      savedFiles.push({id:crypto.randomUUID(),...saved});
    }

    const actionId=crypto.randomUUID();
    await withTransaction(async conn=>{
      await conn.execute(
        `UPDATE siap_letters SET status=?,current_role=?,current_owner_user_id=?,
         cancelled_reason=IF(?='CANCELLED',?,cancelled_reason),
         issued_date=CASE WHEN ?='ISSUED' THEN ? ELSE issued_date END,
         updated_by=? WHERE id=?`,
        [next,nextRole,nextOwner,next,comment||null,next,issuedDate,user.id,params.id]
      );
      await conn.execute(
        `INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment)
         VALUES (?,?,?,?,?,?,?)`,
        [actionId,params.id,user.id,action,status,next,comment||null]
      );
      for(const saved of savedFiles) {
        await conn.execute(
          `INSERT INTO siap_attachments
           (id,letter_id,letter_action_id,attachment_kind,original_name,stored_name,storage_path,mime_type,original_size,stored_size,is_compressed,uploaded_by)
           VALUES (?,?,?,'PROCESS',?,?,?,?,?,?,?,?)`,
          [saved.id,params.id,actionId,saved.originalName,saved.storedName,saved.storagePath,saved.mimeType,saved.originalSize,saved.storedSize,saved.isCompressed?1:0,user.id]
        );
      }
      if(next==="ISSUED" && direction==="OUTGOING") {
        await conn.execute(`UPDATE siap_number_ledger SET status='ISSUED' WHERE letter_id=? AND status='RESERVED'`,[params.id]);
      }
    });

    if(next==="CANCELLED") await cancelLedgerForLetter(params.id,comment);
    await auditLog({
      userId:user.id,
      action:`LETTER_${action}`,
      entityType:"LETTER",
      entityId:params.id,
      metadata:{from:status,to:next,comment,direction,processAttachments:savedFiles.map(x=>x.originalName),issuedDate},
      request
    });
    return NextResponse.json({ok:true,data:{status:next,actionId,attachments:savedFiles.length}});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Proses gagal."},{status:400});
  }
}
