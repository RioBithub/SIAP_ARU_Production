import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { str } from "@/lib/http";
import { saveUpload } from "@/lib/upload";

export const runtime="nodejs";

async function getActiveRoleUser(role:string){
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT id,name,role,unit_name
     FROM siap_users
     WHERE role=? AND is_active=1
     ORDER BY name ASC
     LIMIT 1`,
    [role]
  );
  return rows[0]||null;
}

async function parseRequest(request:Request){
  const type=request.headers.get("content-type")||"";

  if(type.includes("multipart/form-data")){
    const form=await request.formData();
    return {
      action:String(form.get("action")||"").toUpperCase(),
      note:str(form.get("note"),5000),
      files:form.getAll("files").filter((x):x is File=>x instanceof File && x.size>0)
    };
  }

  const body=await request.json();
  return {
    action:String(body.action||"").toUpperCase(),
    note:str(body.note,5000),
    files:[] as File[]
  };
}

export async function POST(request:Request,{params}:{params:{id:string}}) {
  const user=await getCurrentUser();

  if(!user)
    return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  try{
    const parsed=await parseRequest(request);
    const {action,note,files}=parsed;

    if(files.length>5)
      throw new Error("Maksimal 5 lampiran proses dalam satu aksi.");

    const [rows]=await db.query<RowDataPacket[]>(
      `SELECT d.*,
        l.direction AS letter_direction,
        l.status AS letter_status,
        fu.role AS originator_role,
        tu.role AS assignee_role
       FROM siap_dispositions d
       JOIN siap_letters l ON l.id=d.letter_id
       JOIN siap_users fu ON fu.id=d.from_user_id
       JOIN siap_users tu ON tu.id=d.to_user_id
       WHERE d.id=?
       LIMIT 1`,
      [params.id]
    );

    const d=rows[0];
    if(!d) throw new Error("Disposisi tidak ditemukan.");

    const currentOwner=String(d.current_owner_user_id||d.to_user_id);
    const isRoot=user.role==="ROOT_ADMIN";

    if(!isRoot && currentOwner!==String(user.id))
      throw new Error("Disposisi ini sedang berada pada pihak lain.");

    const before=String(d.status);
    let after=before;
    let nextOwner=currentOwner;
    let resultNote=d.result_note ? String(d.result_note) : null;
    let submittedAt:any=d.submitted_at||null;
    let reviewedAt:any=d.reviewed_at||null;
    let returnNote:any=d.return_note||null;

    if(action==="SEEN"){
      if(!["UNSEEN","SEEN"].includes(before))
        throw new Error("Status disposisi tidak dapat ditandai Seen.");

      if(!isRoot && String(d.to_user_id)!==String(user.id))
        throw new Error("Hanya penerima tugas yang dapat menandai Seen.");

      after="SEEN";

    }else if(action==="START"){
      if(!["UNSEEN","SEEN"].includes(before))
        throw new Error("Disposisi tidak berada pada tahap mulai.");

      if(!isRoot && String(d.to_user_id)!==String(user.id))
        throw new Error("Hanya penerima tugas yang dapat memulai.");

      after="IN_PROGRESS";

    }else if(action==="SUBMIT_RESULT"){
      if(before!=="IN_PROGRESS")
        throw new Error("Hasil hanya dapat dikirim dari status IN_PROGRESS.");

      if(!note)
        throw new Error("Ringkasan hasil tindak lanjut wajib diisi.");

      if(!isRoot && String(d.to_user_id)!==String(user.id))
        throw new Error("Hanya penerima tugas yang dapat mengirim hasil.");

      resultNote=note;
      submittedAt=new Date();

      const originatorRole=String(d.originator_role);
      const assigneeRole=String(d.assignee_role);

      if(originatorRole==="PRESIDENT_DIRECTOR"){
        if(assigneeRole==="DIRECTOR_OPS"){
          after="REVIEW_DIRUT";
          nextOwner=String(d.from_user_id);
        }else{
          const dirops=await getActiveRoleUser("DIRECTOR_OPS");
          if(!dirops) throw new Error("Akun Direktur Operasional aktif tidak ditemukan.");
          after="REVIEW_DIROPS";
          nextOwner=String(dirops.id);
        }

      }else if(originatorRole==="DIRECTOR_OPS"){
        after="REVIEW_DIROPS";
        nextOwner=String(d.from_user_id);

      }else if(originatorRole==="MANAGER"){
        after="REVIEW_MANAGER";
        nextOwner=String(d.from_user_id);

      }else{
        after="COMPLETED";
        nextOwner=String(d.from_user_id);
        reviewedAt=new Date();
      }

    }else if(action==="APPROVE_RESULT"){
      if(!["REVIEW_MANAGER","REVIEW_DIROPS","REVIEW_DIRUT"].includes(before))
        throw new Error("Disposisi tidak sedang menunggu review hasil.");

      if(before==="REVIEW_DIROPS" && String(d.originator_role)==="PRESIDENT_DIRECTOR"){
        after="REVIEW_DIRUT";
        nextOwner=String(d.from_user_id);
      }else{
        after="COMPLETED";
        nextOwner=String(d.from_user_id);
        reviewedAt=new Date();
      }

    }else if(action==="RETURN_RESULT"){
      if(!["REVIEW_MANAGER","REVIEW_DIROPS","REVIEW_DIRUT"].includes(before))
        throw new Error("Hasil tidak sedang dalam tahap review.");

      if(!note)
        throw new Error("Catatan pengembalian hasil wajib diisi.");

      after="IN_PROGRESS";
      nextOwner=String(d.to_user_id);
      returnNote=note;

    }else if(action==="RETURN_TASK"){
      if(!["UNSEEN","SEEN","IN_PROGRESS"].includes(before))
        throw new Error("Disposisi tidak dapat dikembalikan pada tahap ini.");

      if(!note)
        throw new Error("Alasan pengembalian disposisi wajib diisi.");

      if(!isRoot && String(d.to_user_id)!==String(user.id))
        throw new Error("Hanya penerima tugas yang dapat mengembalikan.");

      after="RETURNED";
      nextOwner=String(d.from_user_id);
      returnNote=note;

    }else{
      throw new Error("Action tidak valid.");
    }

    const actionId=crypto.randomUUID();

    if(action==="SEEN"){
      await db.execute(
        `UPDATE siap_dispositions
         SET status=?,current_owner_user_id=?,
             seen_at=COALESCE(seen_at,CURRENT_TIMESTAMP)
         WHERE id=?`,
        [after,nextOwner,params.id]
      );

    }else if(action==="START"){
      await db.execute(
        `UPDATE siap_dispositions
         SET status=?,current_owner_user_id=?,
             seen_at=COALESCE(seen_at,CURRENT_TIMESTAMP),
             started_at=COALESCE(started_at,CURRENT_TIMESTAMP)
         WHERE id=?`,
        [after,nextOwner,params.id]
      );

    }else{
      await db.execute(
        `UPDATE siap_dispositions
         SET status=?,
             current_owner_user_id=?,
             result_note=?,
             submitted_at=?,
             reviewed_at=?,
             return_note=?,
             completed_at=CASE WHEN ?='COMPLETED' THEN CURRENT_TIMESTAMP ELSE completed_at END,
             returned_at=CASE WHEN ?='RETURNED' THEN CURRENT_TIMESTAMP ELSE returned_at END
         WHERE id=?`,
        [
          after,nextOwner,resultNote,submittedAt,reviewedAt,returnNote,
          after,after,params.id
        ]
      );
    }

    await db.execute(
      `INSERT INTO siap_disposition_actions
       (id,disposition_id,actor_user_id,action,from_status,to_status,note)
       VALUES (?,?,?,?,?,?,?)`,
      [actionId,params.id,user.id,action,before,after,note||null]
    );

    let attachmentCount=0;

    for(const file of files){
      const saved=await saveUpload(file,"ADDITIONAL");
      const attachmentId=crypto.randomUUID();

      await db.execute(
        `INSERT INTO siap_attachments
         (id,letter_id,disposition_id,disposition_action_id,attachment_kind,
          original_name,stored_name,storage_path,mime_type,original_size,stored_size,
          is_compressed,uploaded_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          attachmentId,d.letter_id,params.id,actionId,"PROCESS",
          saved.originalName,saved.storedName,saved.storagePath,saved.mimeType,
          saved.originalSize,saved.storedSize,saved.isCompressed?1:0,user.id
        ]
      );

      attachmentCount++;
    }

    if(action==="START" && String(d.letter_direction)!=="OUTGOING"){
      if(["APPROVED","DISPOSED","IN_PROGRESS"].includes(String(d.letter_status))){
        await db.execute(
          `UPDATE siap_letters
           SET status='IN_PROGRESS',updated_by=?
           WHERE id=?`,
          [user.id,d.letter_id]
        );
      }
    }

    if(after==="COMPLETED" && String(d.letter_direction)!=="OUTGOING"){
      const [pending]=await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c
         FROM siap_dispositions
         WHERE letter_id=?
           AND status NOT IN ('COMPLETED','RETURNED')`,
        [d.letter_id]
      );

      if(Number(pending[0]?.c||0)===0){
        await db.execute(
          `UPDATE siap_letters
           SET status='COMPLETED',updated_by=?
           WHERE id=?`,
          [user.id,d.letter_id]
        );
      }
    }

    await auditLog({
      userId:user.id,
      action:`DISPOSITION_${action}`,
      entityType:"DISPOSITION",
      entityId:params.id,
      metadata:{from:before,to:after,note,nextOwner,attachments:attachmentCount},
      request
    });

    return NextResponse.json({
      ok:true,
      data:{status:after,attachments:attachmentCount}
    });

  }catch(e){
    return NextResponse.json({
      ok:false,
      error:e instanceof Error?e.message:"Proses gagal."
    },{status:400});
  }
}
