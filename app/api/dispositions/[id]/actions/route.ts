import { paymentKind, requirePaymentDocuments } from "@/lib/v11-payment-documents";
import crypto from "crypto";
import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getCurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { str } from "@/lib/http";
import { saveUpload } from "@/lib/upload";
import { discardUncommittedFiles, type StoredLetterFile } from "@/lib/letter-uploads";
import { findDispositionResultLetters } from "@/lib/correspondence-data";
import { reviewRole } from "@/lib/correspondence-workflow";
import { assertInvoiceVerificationAssignment, assertPaymentRequestAssignment, dispositionDeadlineInput, dispositionTarget } from "@/lib/disposition-assignment";
import { saveProof, v11Letter } from "@/lib/v11-data";
import { decidePayment, preparePaymentTask, recordPayment } from "@/lib/v11-finance";
import { letterCanBeDisposed } from "@/lib/v11-workflow";
import { missingDiropsReview } from "@/lib/disposition-history";

export const runtime="nodejs";

async function getActiveRoleUser(conn: PoolConnection, role:string){
  const [rows]=await conn.query<RowDataPacket[]>(
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
      resultLetterId:str(form.get("result_letter_id"),36),
      fields: Object.fromEntries(form.entries()) as Record<string, unknown>,
      files:form.getAll("files").filter((x):x is File=>typeof x !== "string" && x.size>0)
    };
  }

  const body=await request.json();
  return {
    action:String(body.action||"").toUpperCase(),
    note:str(body.note,5000),
    resultLetterId:str(body.result_letter_id,36),
    fields: body as Record<string, unknown>,
    files:[] as File[]
  };
}

export async function POST(request:Request,{params}:{params:{id:string}}) {
  const user=await getCurrentUser();

  if(!user)
    return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const stored: StoredLetterFile[] = [];
  try{
    const parsed=await parseRequest(request);
    const {action,note,files,resultLetterId}=parsed;
    if (resultLetterId && action !== "SUBMIT_RESULT") throw new Error("Surat hasil hanya dapat ditautkan ketika mengirim hasil.");

    if(files.length>5)
      throw new Error("Maksimal 5 lampiran proses dalam satu aksi.");

    const [references] = await db.query<RowDataPacket[]>("SELECT letter_id FROM siap_dispositions WHERE id=?", [params.id]);
    if (!references[0]) throw new Error("Disposisi tidak ditemukan.");
    const data = await withTransaction(async conn => {
      // New tasks, results and letter transitions acquire the letter lock first.
      const [letters] = await conn.query<RowDataPacket[]>(
        "SELECT * FROM siap_letters WHERE id=? AND deleted_at IS NULL FOR UPDATE", [references[0].letter_id],
      );
      const letter = letters[0];
      if (!letter) throw new Error("Disposisi tidak ditemukan.");
      const [rows]=await conn.query<RowDataPacket[]>(
        `SELECT d.*,
          fu.role AS originator_role,
          tu.role AS assignee_role,v.purpose,v.invoice_revision AS task_revision,
          ${missingDiropsReview} AS needs_dirops_review
         FROM siap_dispositions d
         JOIN siap_users fu ON fu.id=d.from_user_id
         JOIN siap_users tu ON tu.id=d.to_user_id
         LEFT JOIN siap_v11_dispositions v ON v.disposition_id=d.id
         WHERE d.id=?
         LIMIT 1 FOR UPDATE`,
        [params.id]
      );

      const d=rows[0];
      if(!d) throw new Error("Disposisi tidak ditemukan.");

      const workflow = await v11Letter(d.letter_id, conn);
      const currentOwner=String(d.current_owner_user_id||d.to_user_id);
      const isRoot=user.role==="ROOT_ADMIN";
      const strict = Boolean(d.purpose);
      const verification = d.purpose === "INVOICE_VERIFY";
      const payment = d.purpose === "INVOICE_PAYMENT";
      const requestPayment = d.purpose === "REQUEST_PAYMENT";
      const cancel = action === "CANCEL_TASK";
      const reassign = action === "REASSIGN_TASK";

      if (cancel ? !isRoot && d.from_user_id !== user.id : !isRoot && currentOwner !== user.id) {
        throw new Error("Disposisi ini sedang berada pada pihak lain.");
      }
      if ((verification || payment || requestPayment) && !cancel) {
        const assigneeAction = ["SEEN", "START", "SUBMIT_RESULT", "RETURN_TASK"].includes(action);
        if (assigneeAction ? user.id !== d.to_user_id || user.role !== (verification ? "STAFF" : "FINANCE")
          : user.id !== d.from_user_id || user.role !== "MANAGER") {
          throw new Error("Tugas verifikasi atau pembayaran harus dikerjakan dan diperiksa oleh peserta yang ditetapkan.");
        }
        if (verification && ["SUBMIT_RESULT","APPROVE_RESULT"].includes(action) &&
            (!workflow || workflow.invoice_revision !== d.task_revision || letter.status !== "MANAGER_REVIEW")) {
          throw new Error("Tugas verifikasi berlaku untuk revisi dan tahap review invoice yang aktif.");
        }
        if (payment && action !== "RETURN_TASK" && (!workflow?.payable_id || letter.status !== "APPROVED")) {
          throw new Error("Invoice tidak berada pada tahap pembayaran.");
        }
      }

      if (workflow && d.assignee_role === "FINANCE" && ["START","SUBMIT_RESULT","APPROVE_RESULT"].includes(action)
          && paymentKind(workflow, letter.document_type)) {
        if (letter.status !== "APPROVED") throw new Error("Pengajuan belum berada pada tahap pembayaran.");
        await requirePaymentDocuments(conn, d.letter_id, workflow, letter.document_type);
      }

      const before=String(d.status);
      let after=before;
      let recordedAction=action;
      let nextOwner=currentOwner;
      let resultNote=d.result_note ? String(d.result_note) : null;
      let submittedAt:any=d.submitted_at||null;
      let reviewedAt:any=d.reviewed_at||null;
      let returnNote:any=d.return_note||null;
      if (["SUBMIT_RESULT","RETURN_TASK","APPROVE_RESULT","CANCEL_TASK","REASSIGN_TASK"].includes(action)) {
        const [activeChildren] = await conn.query<RowDataPacket[]>(
          "SELECT id FROM siap_dispositions WHERE parent_id=? AND status NOT IN ('COMPLETED','RETURNED','CANCELLED') LIMIT 1",
          [params.id],
        );
        if (activeChildren.length) throw new Error("Tunggu hasil disposisi turunan sebelum menyelesaikan proses ini.");
      }

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

        if ((verification || payment || requestPayment) && resultLetterId) throw new Error("Tugas ini meminta bukti pemeriksaan atau pembayaran.");
        if (d.result_requirement === "ATTACHMENT" && !files.length) {
          throw new Error("Lampiran hasil wajib diunggah untuk disposisi ini.");
        }
        if (d.result_requirement === "OUTGOING_LETTER" && !resultLetterId) {
          throw new Error("Tautkan Surat Keluar yang sudah terbit.");
        }
        if (resultLetterId) {
          const [resultLetter] = await findDispositionResultLetters(conn, user,
            { id: d.id, letter_id: d.letter_id, to_user_id: d.to_user_id }, { id: resultLetterId });
          if (!resultLetter) throw new Error("Surat hasil harus sudah terbit dan tersedia untuk disposisi ini.");
        }

        resultNote=note;
        submittedAt=new Date();
        returnNote=null;

        const originatorRole=String(d.originator_role);
        const assigneeRole=String(d.assignee_role);

        if(originatorRole==="PRESIDENT_DIRECTOR"){
          if(assigneeRole==="DIRECTOR_OPS"){
            after="REVIEW_DIRUT";
            nextOwner=String(d.from_user_id);
          }else{
            const dirops=await getActiveRoleUser(conn, "DIRECTOR_OPS");
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
          after="REVIEW_ROOT";
          nextOwner=String(d.from_user_id);
        }

      }else if(action==="APPROVE_RESULT"){
        if(!["REVIEW_MANAGER","REVIEW_DIROPS","REVIEW_DIRUT","REVIEW_ROOT"].includes(before))
          throw new Error("Disposisi tidak sedang menunggu review hasil.");

        if(before==="REVIEW_DIRUT" && d.needs_dirops_review){
          const dirops=await getActiveRoleUser(conn, "DIRECTOR_OPS");
          if(!dirops) throw new Error("Akun Direktur Operasional aktif tidak ditemukan.");
          after="REVIEW_DIROPS";
          nextOwner=String(dirops.id);
          recordedAction="ROUTE_REVIEW_DIROPS";
        }else if(before==="REVIEW_DIROPS" && String(d.originator_role)==="PRESIDENT_DIRECTOR"){
          if(user.role!=="DIRECTOR_OPS" || user.id!==currentOwner)
            throw new Error("Direktur Operasional yang menerima hasil wajib memeriksanya sebelum hasil naik ke Dirut.");
          after="REVIEW_DIRUT";
          nextOwner=String(d.from_user_id);
        }else{
          after="COMPLETED";
          nextOwner=String(d.from_user_id);
          reviewedAt=new Date();
        }

      }else if(action==="RETURN_RESULT"){
        if(!["REVIEW_MANAGER","REVIEW_DIROPS","REVIEW_DIRUT","REVIEW_ROOT"].includes(before))
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

      } else if (reassign) {
        if (before !== "RETURNED" || d.from_user_id !== user.id || currentOwner !== user.id) {
          throw new Error("Hanya pemberi tugas yang dapat menugaskan ulang disposisi yang dikembalikan.");
        }
        if (!note) throw new Error("Instruksi tindak lanjut wajib diisi.");
        const review = workflow && letter.direction === "INCOMING" ? reviewRole(letter.status) : null;
        if (review ? !d.parent_id && (review !== user.role || letter.current_owner_user_id !== user.id)
          : !letterCanBeDisposed(letter.direction, letter.status) || (workflow && letter.status === "COMPLETED")) {
          throw new Error("Dokumen asal sudah berpindah tahap. Buka dokumen asal untuk melanjutkan.");
        }
        if (d.parent_id) {
          const [parents] = await conn.query<RowDataPacket[]>(
            "SELECT status,to_user_id FROM siap_dispositions WHERE id=? AND letter_id=? FOR UPDATE",
            [d.parent_id, d.letter_id],
          );
          const parent = parents[0];
          if (!parent || parent.status !== "IN_PROGRESS" ||
              (parent.to_user_id !== user.id && (strict || !isRoot))) {
            throw new Error("Tugas asal harus masih dikerjakan untuk menugaskan ulang delegasi ini.");
          }
        }
        const target = await dispositionTarget(conn, user, d.to_user_id, strict, d.purpose || "GENERAL");
        if (verification) {
          if (!workflow || workflow.invoice_revision !== d.task_revision) {
            throw new Error("Tugas ini berasal dari revisi invoice lama. Tugaskan verifikasi dari revisi yang aktif.");
          }
          await assertInvoiceVerificationAssignment(conn, user, letter, workflow, target);
        } else if (payment) {
          if (!workflow?.payable_id || target.role !== "FINANCE") throw new Error("Instruksi bayar tidak lagi aktif.");
          await preparePaymentTask(conn, letter, workflow, user.id);
        } else if (requestPayment) {
          if (!workflow) throw new Error("Pengajuan pembayaran tidak lagi aktif.");
          await assertPaymentRequestAssignment(conn, user, letter, workflow, target, d.parent_id);
        }
        after = "UNSEEN";
        nextOwner = d.to_user_id;

      } else if (action === "CANCEL_TASK") {
        if (before !== "RETURNED" && (!strict || ["COMPLETED", "CANCELLED"].includes(before))) {
          throw new Error("Tugas tidak dapat dibatalkan.");
        }
        if (!note) throw new Error("Alasan pembatalan wajib diisi.");
        after = "CANCELLED";
        nextOwner = String(d.from_user_id);
        returnNote = note;

      }else{
        throw new Error("Action tidak valid.");
      }

      const actionId=crypto.randomUUID();

      if(reassign){
        const updateDeadline = "due_date" in parsed.fields || "due_time" in parsed.fields;
        const deadline = updateDeadline ? dispositionDeadlineInput(parsed.fields) : null;
        await conn.execute(
          `UPDATE siap_dispositions SET status=?,current_owner_user_id=?,instruction=?,
           due_date=IF(?,?,due_date),due_time=IF(?,?,due_time),
           seen_at=NULL,started_at=NULL,submitted_at=NULL,reviewed_at=NULL,completed_at=NULL,returned_at=NULL,
           result_note=NULL,return_note=NULL WHERE id=?`,
          [after,nextOwner,note,updateDeadline,deadline?.date ?? null,updateDeadline,deadline?.time ?? null,params.id],
        );
      }else if(action==="SEEN"){
        await conn.execute(
          `UPDATE siap_dispositions
           SET status=?,current_owner_user_id=?,
               seen_at=COALESCE(seen_at,CURRENT_TIMESTAMP)
           WHERE id=?`,
          [after,nextOwner,params.id]
        );

      }else if(action==="START"){
        await conn.execute(
          `UPDATE siap_dispositions
           SET status=?,current_owner_user_id=?,
               seen_at=COALESCE(seen_at,CURRENT_TIMESTAMP),
               started_at=COALESCE(started_at,CURRENT_TIMESTAMP)
           WHERE id=?`,
          [after,nextOwner,params.id]
        );

      }else{
        await conn.execute(
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

      await conn.execute(
        `INSERT INTO siap_disposition_actions
         (id,disposition_id,actor_user_id,action,from_status,to_status,note,result_letter_id)
         VALUES (?,?,?,?,?,?,?,?)`,
        [actionId,params.id,user.id,recordedAction,before,after,note||null,resultLetterId||null]
      );

      let attachmentCount=0;
      let evidenceId: string | null = null;

      for(const file of files){
        const isEvidence = action === "SUBMIT_RESULT" && (verification || payment || requestPayment) && !evidenceId;
        const saved = isEvidence ? await saveProof(file) : await saveUpload(file,"ADDITIONAL");
        stored.push(saved);
        const attachmentId=crypto.randomUUID();

        await conn.execute(
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

        if (isEvidence) evidenceId = attachmentId;
        attachmentCount++;
      }

      if (strict && (action === "SUBMIT_RESULT" || action === "RETURN_RESULT" || cancel || reassign)) {
        await conn.execute("UPDATE siap_v11_dispositions SET result_letter_id=? WHERE disposition_id=?",
          [action === "SUBMIT_RESULT" ? resultLetterId || null : null, params.id]);
      }
      if (payment) {
        if (action === "SUBMIT_RESULT") {
          if (!workflow || !evidenceId) throw new Error("Bukti pembayaran wajib dilampirkan.");
          await recordPayment(conn, workflow, d, actionId, evidenceId, parsed.fields);
        } else if (action === "APPROVE_RESULT" || action === "RETURN_RESULT" || cancel) {
          await decidePayment(conn, d, user.id, cancel ? "CANCELLED" : action === "APPROVE_RESULT" ? "APPROVED" : "RETURNED");
        }
      }

      if (!workflow && reassign && letter.direction !== "OUTGOING" && letter.status === "COMPLETED") {
        await conn.execute("UPDATE siap_letters SET status='DISPOSED',updated_by=? WHERE id=?", [user.id,d.letter_id]);
      }
      if(!workflow && action==="START" && String(letter.direction)!=="OUTGOING"){
        if(["APPROVED","DISPOSED","IN_PROGRESS"].includes(String(letter.status))){
          await conn.execute(
            `UPDATE siap_letters
             SET status='IN_PROGRESS',updated_by=?
             WHERE id=?`,
            [user.id,d.letter_id]
          );
        }
      }

      if(!workflow && after==="COMPLETED" && String(letter.direction)!=="OUTGOING" &&
          ["APPROVED","DISPOSED","IN_PROGRESS"].includes(String(letter.status))){
        const [pending]=await conn.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS c
           FROM siap_dispositions
           WHERE letter_id=?
             AND status NOT IN ('COMPLETED','RETURNED','CANCELLED')`,
          [d.letter_id]
        );

        if(Number(pending[0]?.c||0)===0){
          await conn.execute(
            `UPDATE siap_letters
             SET status='COMPLETED',updated_by=?
             WHERE id=?`,
            [user.id,d.letter_id]
          );
        }
      }

      await auditLog({
        user,
        action:`DISPOSITION_${recordedAction}`,
        entityType:"DISPOSITION",
        entityId:params.id,
        metadata:{from:before,to:after,note,nextOwner,attachments:attachmentCount,resultLetterId:resultLetterId||null,purpose:d.purpose,evidenceId},
        request
      }, conn);
      return { status: after, attachments: attachmentCount };
    });
    stored.length = 0;
    return NextResponse.json({ ok: true, data });

  }catch(e){
    await discardUncommittedFiles(stored);
    return NextResponse.json({
      ok:false,
      error:e instanceof Error?e.message:"Proses gagal."
    },{status:400});
  }
}
