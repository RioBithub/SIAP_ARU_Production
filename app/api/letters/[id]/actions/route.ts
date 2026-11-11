import crypto from "crypto";
import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { cancelLedgerForLetter } from "@/lib/numbering";
import { dateOnly, required, str } from "@/lib/http";
import { activeReviewer } from "@/lib/correspondence-data";
import { REVIEW_STATUS, canHandleSecretariat, reviewRole } from "@/lib/correspondence-workflow";
import { letterAccess } from "@/lib/letter-access";
import { saveUpload } from "@/lib/upload";
import { getBusinessDocumentRow } from "@/lib/business-document-data";
import { isBusinessDocument, isInvoice, SPK_OUTGOING, type SignatureMethod } from "@/lib/business-documents";
import { discardUncommittedFiles, insertLetterAttachment, type StoredLetterFile } from "@/lib/letter-uploads";

export const runtime="nodejs";

async function getRoutingManager(conn: PoolConnection, targetId:unknown){
  if(!targetId) return null;
  const [rows]=await conn.query<RowDataPacket[]>(
    `SELECT id,name,role,unit_name
     FROM siap_users
     WHERE id=? AND is_active=1 AND role='MANAGER'
     LIMIT 1`,
    [targetId]
  );
  return rows[0]||null;
}

async function getActiveRoleUser(conn: PoolConnection, role:string){
  const [rows]=await conn.query<RowDataPacket[]>(
    `SELECT id,name,role,unit_name
     FROM siap_users
     WHERE role=? AND is_active=1
     ORDER BY name ASC,id ASC
     LIMIT 1`,
    [role]
  );
  return rows[0]||null;
}

function assertCurrentReviewer(user:any,letter:any,expected:string){
  if(user.role==="ROOT_ADMIN") return;
  if(user.role!==expected)
    throw new Error("Approval harus dilakukan role pada tahap saat ini.");

  if(letter.current_owner_user_id &&
     String(letter.current_owner_user_id)!==String(user.id))
    throw new Error("Dokumen ini ditujukan kepada reviewer lain.");
}

async function parseRequest(request:Request) {
  const type=request.headers.get("content-type")||"";

  if(type.includes("multipart/form-data")) {
    const form=await request.formData();
    const signed = form.get("signed_file");
    return {
      action:String(form.get("action")||"").toUpperCase(),
      comment:str(form.get("comment"),5000),
      issuedDate:str(form.get("issued_date"),10),
      sentDate:str(form.get("sent_date"),10),
      routingTargetId:str(form.get("routing_target_user_id"),36),
      files:form.getAll("files").filter((x):x is File=>typeof x !== "string" && x.size > 0),
      signedFile:signed && typeof signed !== "string" && signed.size > 0 ? signed : null,
      signatureMethod:String(form.get("signature_method") || ""),
    };
  }

  const body=await request.json();
  return {
    action:String(body.action||"").toUpperCase(),
    comment:str(body.comment,5000),
    issuedDate:str(body.issued_date,10),
      sentDate:str(body.sent_date,10),
      routingTargetId:str(body.routing_target_user_id,36),
    files:[] as File[],
    signedFile:null,
    signatureMethod:"",
  };
}

export async function POST(request:Request,{params}:{params:{id:string}}) {
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const stored: StoredLetterFile[] = [];
  try{
    const parsed=await parseRequest(request);
    const {action,comment,files}=parsed;

    if(files.length + Number(Boolean(parsed.signedFile)) > 5)
      throw new Error("Maksimal 5 lampiran proses dalam satu aksi.");

    const result = await withTransaction(async conn => {
      const access = letterAccess(user);
      const [rows]=await conn.query<RowDataPacket[]>(
        `SELECT l.* FROM siap_letters l WHERE l.id=? AND ${access.clause} LIMIT 1 FOR UPDATE`,
        [params.id, ...access.params]
      );

      const letter=rows[0];
      if(!letter)
        return null;

      const status=String(letter.status);
      const direction=String(letter.direction);
      const documentType=String(letter.document_type);
      const business=isBusinessDocument(documentType);
      const secretariat = Boolean(letter.uses_secretariat);
      const administrativeReview = Boolean(letter.secretariat_review_required);
      const outgoing = direction === "OUTGOING";
      const incomingViaSecretariat = secretariat && direction === "INCOMING";
      const atSecretariat = secretariat && letter.current_role === "SECRETARIAT";
      const handlesSecretariat = atSecretariat && canHandleSecretariat(user.role);
      let signature: SignatureMethod | null = null;

      let next=status;
      let nextRole=letter.current_role ? String(letter.current_role) : null;
      let nextOwner:string|null=letter.current_owner_user_id ? String(letter.current_owner_user_id) : null;
      let issuedDate:string|null=null;
      let sentDate:string|null=null;
      let routingTargetId: string | null = null;
      let routingNote: string | null = null;

      if (action === "REGISTER_INCOMING") {
        if (!incomingViaSecretariat || status !== "SECRETARIAT_INTAKE" || !handlesSecretariat) {
          throw new Error("Surat ini tidak sedang menunggu registrasi Sekretariat.");
        }
        const target = await activeReviewer(conn, required(parsed.routingTargetId || letter.routing_target_user_id, "Tujuan review", 36));
        routingTargetId = target.id;
        routingNote = "Diteruskan kepada " + target.name;
        next = REVIEW_STATUS[target.role];
        nextRole = target.role;
        nextOwner = target.id;

      } else if(action==="SUBMIT") {
        if(!["DRAFT","RETURNED_STAFF"].includes(status))
          throw new Error("Dokumen tidak berada pada tahap yang dapat diajukan.");

        if(user.role!=="ROOT_ADMIN" && String(letter.created_by)!==String(user.id))
          throw new Error("Hanya penyusun dokumen yang dapat mengajukan ulang.");

        const manager=await getRoutingManager(conn, letter.routing_target_user_id);
        if(!manager)
          throw new Error("Manager tujuan dokumen tidak ditemukan.");

        if (isInvoice(documentType)) {
          const invoice = await getBusinessDocumentRow(params.id, conn);
          if (!invoice || (invoice.requires_spk && !invoice.invoice_spk_id)) {
            throw new Error("Lengkapi data invoice dan rujukan SPK yang wajib sebelum diajukan.");
          }
        }
        next="MANAGER_REVIEW";
        nextRole="MANAGER";
        nextOwner=String(manager.id);

      } else if(action==="APPROVE") {
        const expected = status === "SECRETARIAT_REVIEW" && atSecretariat ? "SECRETARIAT" : reviewRole(status);
        if(!expected) throw new Error("Dokumen tidak sedang menunggu approval.");

        assertCurrentReviewer(user,letter,expected);

        if(status==="MANAGER_REVIEW"){
          const dirops=await getActiveRoleUser(conn, "DIRECTOR_OPS");
          if(!dirops) throw new Error("Akun Direktur Operasional aktif tidak ditemukan.");
          next="DIRECTOR_OPS_REVIEW";
          nextRole="DIRECTOR_OPS";
          nextOwner=String(dirops.id);

        }else if(status==="DIRECTOR_OPS_REVIEW" && outgoing && secretariat && administrativeReview){
          next="SECRETARIAT_REVIEW";
          nextRole="SECRETARIAT";
          nextOwner=null;

        }else if(status==="DIRECTOR_OPS_REVIEW" || status==="SECRETARIAT_REVIEW"){
          const dirut=await getActiveRoleUser(conn, "PRESIDENT_DIRECTOR");
          if(!dirut) throw new Error("Akun Direktur Utama aktif tidak ditemukan.");
          next="PRESIDENT_DIRECTOR_REVIEW";
          nextRole="PRESIDENT_DIRECTOR";
          nextOwner=String(dirut.id);

        }else if(status==="PRESIDENT_DIRECTOR_REVIEW"){
          if(direction==="OUTGOING"){
            next="READY_TO_ISSUE";
            nextRole=secretariat ? "SECRETARIAT" : "STAFF";
            nextOwner=secretariat ? null : String(letter.created_by);
          }else{
            next="APPROVED";
            nextRole=null;
            nextOwner=null;
          }
        }

      } else if(action==="APPROVE_FINAL") {
        if(direction!=="INTERNAL" && !incomingViaSecretariat)
          throw new Error("Penyelesaian di level ini hanya tersedia untuk Nota Dinas dan Surat Masuk melalui Sekretariat.");

        if(!["MANAGER_REVIEW","DIRECTOR_OPS_REVIEW"].includes(status))
          throw new Error("Tahap ini tidak dapat diselesaikan pada level sekarang.");

        const expected=reviewRole(status);
        if(!expected) throw new Error("Dokumen tidak sedang menunggu approval.");

        assertCurrentReviewer(user,letter,expected);
        next="APPROVED";
        nextRole=null;
        nextOwner=null;

      } else if(action==="RETURN" || action==="RETURN_PREVIOUS") {
        const expected = status === "SECRETARIAT_REVIEW" && atSecretariat ? "SECRETARIAT" : reviewRole(status);
        if(!expected) throw new Error("Dokumen tidak sedang dalam review.");
        if(action==="RETURN_PREVIOUS" && (!outgoing || status==="MANAGER_REVIEW"))
          throw new Error("Tidak ada tahap pemeriksa sebelumnya.");

        assertCurrentReviewer(user,letter,expected);
        if(!comment) throw new Error("Catatan pengembalian wajib diisi.");

        if (incomingViaSecretariat && letter.current_owner_user_id === letter.routing_target_user_id) {
          next = "SECRETARIAT_INTAKE";
          nextRole = "SECRETARIAT";
          nextOwner = null;
        } else if ((outgoing && action === "RETURN") || status === "MANAGER_REVIEW") {
          next = "RETURNED_STAFF";
          nextRole = "STAFF";
          nextOwner = String(letter.created_by);
        } else if (status === "DIRECTOR_OPS_REVIEW") {
          const manager = await activeReviewer(conn, String(letter.routing_target_user_id || ""), ["MANAGER"]);
          next = "MANAGER_REVIEW";
          nextRole = "MANAGER";
          nextOwner = manager.id;
        } else if (status === "PRESIDENT_DIRECTOR_REVIEW" && outgoing && secretariat && administrativeReview) {
          next = "SECRETARIAT_REVIEW";
          nextRole = "SECRETARIAT";
          nextOwner = null;
        } else {
          const [previous] = await conn.query<RowDataPacket[]>(
            `SELECT u.id FROM siap_letter_actions a JOIN siap_users u ON u.id=a.actor_user_id
             WHERE a.letter_id=? AND a.from_status='DIRECTOR_OPS_REVIEW' AND a.action='APPROVE'
               AND u.role='DIRECTOR_OPS' AND u.is_active=1
             ORDER BY a.created_at DESC,a.id DESC LIMIT 1`,
            [params.id],
          );
          const dirops = previous[0] || await getActiveRoleUser(conn, "DIRECTOR_OPS");
          if (!dirops) throw new Error("Akun Direktur Operasional aktif tidak ditemukan.");
          next = "DIRECTOR_OPS_REVIEW";
          nextRole = "DIRECTOR_OPS";
          nextOwner = String(dirops.id);
        }

      } else if (action === "REJECT") {
        if (!outgoing || status !== "PRESIDENT_DIRECTOR_REVIEW") {
          throw new Error("Penolakan Surat Keluar hanya tersedia di tahap keputusan akhir.");
        }
        assertCurrentReviewer(user, letter, "PRESIDENT_DIRECTOR");
        if (!comment) throw new Error("Alasan penolakan wajib diisi.");
        next = "REJECTED";
        nextRole = null;
        nextOwner = null;

      } else if(action==="RESPONSE") {
        if(direction!=="INTERNAL")
          throw new Error("Tanggapan khusus tersedia untuk Nota Dinas.");

        if(!comment)
          throw new Error("Isi tanggapan wajib diisi.");

        const [prior]=await conn.query<RowDataPacket[]>(
          `SELECT 1
           FROM siap_letter_actions
           WHERE letter_id=? AND actor_user_id=?
           LIMIT 1`,
          [params.id,user.id]
        );

        const canRespond =
          user.role==="ROOT_ADMIN" ||
          String(letter.created_by)===String(user.id) ||
          String(letter.current_owner_user_id||"")===String(user.id) ||
          Boolean(prior[0]);

        if(!canRespond)
          throw new Error("Anda bukan pihak dalam Nota Dinas ini.");

        // RESPONSE tidak mengubah status / owner.

      } else if (action === "PREPARE_ISSUE") {
        if (!outgoing || status !== "READY_TO_ISSUE" || !handlesSecretariat) {
          throw new Error("Surat ini tidak sedang menunggu finalisasi nomor oleh Sekretariat.");
        }
        const [ledger] = await conn.query<RowDataPacket[]>(
          "SELECT 1 FROM siap_number_ledger WHERE letter_id=? AND rendered_number=? AND status='RESERVED' LIMIT 1",
          [params.id, letter.letter_number],
        );
        if (!ledger[0]) throw new Error("Nomor reservasi surat tidak ditemukan.");
        next = "WAITING_SIGNATURE";

      } else if(action==="ISSUE") {
        if(!outgoing || status!==(secretariat ? "WAITING_SIGNATURE" : "READY_TO_ISSUE"))
          throw new Error("Surat belum siap diterbitkan.");

        if (secretariat ? !handlesSecretariat
          : user.role !== "ROOT_ADMIN" && String(letter.created_by) !== String(user.id)) {
          throw new Error("Akun ini tidak berwenang menerbitkan surat.");
        }

        if (secretariat || (documentType === SPK_OUTGOING && await getBusinessDocumentRow(params.id, conn))) {
          if (parsed.signatureMethod !== "DIGITAL" && parsed.signatureMethod !== "BASAH") {
            throw new Error("Pilih metode tanda tangan dokumen.");
          }
          signature = parsed.signatureMethod;
          const extension = signature === "DIGITAL" ? /\.pdf$/i : /\.(pdf|png|jpe?g)$/i;
          if (!parsed.signedFile || !extension.test(parsed.signedFile.name)) {
            throw new Error(signature === "DIGITAL"
              ? "Unggah PDF yang sudah ditandatangani secara digital."
              : "Unggah hasil pindai surat yang ditandatangani (PDF, JPG, atau PNG).");
          }
        }

        issuedDate=parsed.issuedDate
          ? dateOnly(parsed.issuedDate,"Tanggal terbit")
          : new Date().toISOString().slice(0,10);

        next="ISSUED";
        nextRole=secretariat ? "SECRETARIAT" : null;
        nextOwner=null;

      } else if (action === "MARK_SENT") {
        if (!outgoing || status !== "ISSUED" || !handlesSecretariat || letter.sent_date) {
          throw new Error("Surat ini tidak sedang menunggu pencatatan pengiriman.");
        }
        sentDate = dateOnly(parsed.sentDate, "Tanggal kirim");
        const issueDate = letter.issued_date instanceof Date
          ? letter.issued_date.toISOString().slice(0, 10) : String(letter.issued_date || "").slice(0, 10);
        if (!issueDate || sentDate < issueDate) throw new Error("Tanggal kirim harus pada atau setelah tanggal terbit.");
        nextRole = null;
        nextOwner = null;

      } else if(action==="COMPLETE") {
        if(!["ROOT_ADMIN","DIRECTOR_OPS","PRESIDENT_DIRECTOR"].includes(user.role))
          throw new Error("Tidak berhak menutup dokumen.");

        if ((business || secretariat) && (outgoing
          ? status !== "ISSUED" || (secretariat && !letter.sent_date)
          : !["APPROVED","DISPOSED","IN_PROGRESS"].includes(status))) {
          throw new Error("Dokumen belum dapat diselesaikan pada tahap ini.");
        }
        next="COMPLETED";
        nextRole=null;
        nextOwner=null;

      } else if(action==="CANCEL") {
        if(user.role!=="ROOT_ADMIN" && String(letter.created_by)!==String(user.id))
          throw new Error("Tidak berhak membatalkan dokumen.");

        if (status === "REJECTED" || ((business || secretariat) && ["ISSUED","COMPLETED","CANCELLED"].includes(status))) {
          throw new Error("Dokumen tidak dapat dibatalkan pada tahap ini.");
        }
        if(!comment)
          throw new Error("Alasan pembatalan wajib diisi.");

        next="CANCELLED";
        nextRole=null;
        nextOwner=null;

      } else {
        throw new Error("Action tidak dikenal.");
      }

      if (parsed.signedFile && !signature) throw new Error("File bertanda tangan hanya tersedia saat penerbitan.");
      const actionId = crypto.randomUUID();

      await conn.execute(
        `UPDATE siap_letters SET status=?,\`current_role\`=?,current_owner_user_id=?,
         cancelled_reason=IF(? IN ('CANCELLED','REJECTED'),?,cancelled_reason),
         issued_date=COALESCE(?,issued_date),sent_date=COALESCE(?,sent_date),
         routing_target_user_id=COALESCE(?,routing_target_user_id),updated_by=?
         WHERE id=?`,
        [next, nextRole, nextOwner, next, comment.slice(0, 1000) || null, issuedDate, sentDate, routingTargetId, user.id, params.id],
      );
      const signatureNote = signature === "DIGITAL" ? "Tanda tangan digital" : signature === "BASAH" ? "Tanda tangan basah" : null;
      const actionComment = [comment, routingNote, signatureNote].filter(Boolean).join(" • ");
      await conn.execute(
        `INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment)
         VALUES (?,?,?,?,?,?,?)`,
        [actionId, params.id, user.id, action, status, next, actionComment || null],
      );

      if (signature && parsed.signedFile) {
        const signed = await saveUpload(parsed.signedFile, "ORIGINAL");
        stored.push(signed);
        await insertLetterAttachment(conn, params.id, user.id, signed, "PROCESS", actionId);
      }

      for (const file of files) {
        const saved = await saveUpload(file, "ADDITIONAL");
        stored.push(saved);
        await insertLetterAttachment(conn, params.id, user.id, saved, "PROCESS", actionId);
      }
      if (signature && business) {
        await conn.execute("UPDATE siap_business_documents SET signature_method=? WHERE letter_id=?", [signature, params.id]);
      }
      if (action === "ISSUE") {
        await conn.execute(
          "UPDATE siap_number_ledger SET status='ISSUED' WHERE letter_id=? AND status='RESERVED'",
          [params.id],
        );
      }
      if (next === "CANCELLED" || next === "REJECTED") await cancelLedgerForLetter(params.id, comment.slice(0, 1000), conn);

      await auditLog({
        userId: user.id, action: "LETTER_" + action, entityType: "LETTER", entityId: params.id,
        metadata: {
          from: status, to: next, comment, direction, issuedDate, sentDate, routingTargetId,
          processAttachments: stored.map(file => file.originalName), signatureMethod: signature,
        },
        request,
      }, conn);
      return { status: next, actionId, attachments: stored.length };
    });
    stored.length = 0;
    if (!result) return NextResponse.json({ ok: false, error: "Dokumen tidak ditemukan." }, { status: 404 });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    await discardUncommittedFiles(stored);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Proses gagal." }, { status: 400 });
  }
}
