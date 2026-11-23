import crypto from "crypto";
import { NextResponse } from "next/server";
import { isDirectNota, isNotaDraft, notaAuthorId, notaDocument, requireNotaSignature } from "@/lib/nota-document";
import { activeNotaAccount, listNotaRecipients, notaPrimaryTarget, validateNotaRecipients } from "@/lib/nota-routing";
import { canRespondToNota } from "@/lib/nota-responses";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { cancelLedgerForLetter } from "@/lib/numbering";
import { dateOnly, required, str } from "@/lib/http";
import { activeReviewer } from "@/lib/correspondence-data";
import { canHandleSecretariat, canReceiveDirectorNota, canRequestNotaDraft, isNotaDirector, NOTA_DIRECTORS,
  REVIEW_STATUS, reviewRole } from "@/lib/correspondence-workflow";
import { letterAccess } from "@/lib/letter-access";
import { reversibleApproval, type ApprovalSnapshot } from "@/lib/letter-approval";
import { saveUpload } from "@/lib/upload";
import { getBusinessDocumentRow } from "@/lib/business-document-data";
import { INVOICE_INCOMING, isBusinessDocument, isInvoice, SPK_OUTGOING, type SignatureMethod } from "@/lib/business-documents";
import { discardUncommittedFiles, insertLetterAttachment, type StoredLetterFile } from "@/lib/letter-uploads";

import { activeTasks, checkedDate, invoiceVerified, officialManager, receiptFields, saveProof,
  takeFile, v11Letter } from "@/lib/v11-data";
import { DELIVERY_METHODS, jakartaDate } from "@/lib/v11-workflow";
import { requireInvoicePaid } from "@/lib/v11-finance";
import { mekariMode, MEKARI_PILOT_JOB_MODE } from "@/lib/mekari-sign";

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
      fields: Object.fromEntries(form.entries()) as Record<string, unknown>,
      receiptFile: takeFile(form.get("receipt_file")),
      dispatchFile: takeFile(form.get("dispatch_file")),
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
    signatureMethod:String(body.signature_method || ""),
    fields: body as Record<string, unknown>,
    receiptFile: null,
    dispatchFile: null,
  };
}

export async function POST(request:Request,{params}:{params:{id:string}}) {
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const stored: StoredLetterFile[] = [];
  try{
    const parsed=await parseRequest(request);
    const {action,comment,files}=parsed;

    if (parsed.receiptFile && action !== "REGISTER_INCOMING") throw new Error("Bukti terima diunggah pada tahap registrasi.");
    if (parsed.dispatchFile && action !== "MARK_SENT") throw new Error("Bukti kirim diunggah bersama pencatatan pengiriman.");
    if (files.length + [parsed.signedFile, parsed.receiptFile, parsed.dispatchFile].filter(Boolean).length > 5)
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

      const workflow = await v11Letter(params.id, conn);
      const status=String(letter.status);
      const direction=String(letter.direction);
      const notaReply = direction === "INTERNAL" && workflow?.kind === "NOTA_REPLY";
      const directNota = direction === "INTERNAL" && isDirectNota(workflow);
      const authorId = direction === "INTERNAL" ? notaAuthorId(letter, workflow) : String(letter.created_by);
      const documentType=String(letter.document_type);
      const business=isBusinessDocument(documentType);
      const v11Invoice = Boolean(workflow && documentType === INVOICE_INCOMING);
      const verified = async () => !v11Invoice ||
        await invoiceVerified(conn, params.id, workflow!.invoice_revision, letter.routing_target_user_id);
      const assertVerified = async () => {
        if (!await verified()) throw new Error("ACC hasil verifikasi unit untuk revisi invoice ini wajib sebelum persetujuan atau eskalasi.");
      };
      const assertNoActiveTasks = async () => {
        if (workflow && await activeTasks(conn, params.id)) throw new Error("Selesaikan atau batalkan tugas yang masih aktif.");
      };
      const secretariat = Boolean(letter.uses_secretariat);
      const administrativeReview = Boolean(letter.secretariat_review_required);
      const outgoing = direction === "OUTGOING";
      const incomingViaSecretariat = secretariat && direction === "INCOMING";
      const atSecretariat = secretariat && letter.current_role === "SECRETARIAT";
      const handlesSecretariat = atSecretariat && canHandleSecretariat(user.role);
      let signature: SignatureMethod | null = null;
      let signatureProvenance: string | null = null;
      let signatureAttachmentId: string | null = null;
      let receiptDate: string | null = null;
      let receipt: ReturnType<typeof receiptFields> | null = null;
      let dispatchChannel: string | null = null;
      let dispatchRecipient: string | null = null;

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
        const targetId = required(parsed.routingTargetId || letter.routing_target_user_id, "Tujuan review", 36);
        const target = workflow ? await officialManager(conn, targetId, workflow.requesting_unit)
          : await activeReviewer(conn, targetId);
        if (workflow) {
          receipt = receiptFields({ ...workflow, ...parsed.fields }, true);
          const savedDate = letter.received_date instanceof Date ? letter.received_date.toISOString().slice(0, 10) : letter.received_date;
          receiptDate = checkedDate(parsed.fields.received_date ?? savedDate, "Tanggal diterima");
          if (receiptDate > jakartaDate()) throw new Error("Tanggal penerimaan tidak boleh di masa depan.");
          const [original] = await conn.query<RowDataPacket[]>(
            "SELECT 1 FROM siap_attachments WHERE letter_id=? AND disposition_id IS NULL AND attachment_kind='ORIGINAL' LIMIT 1", [params.id],
          );
          if (!original.length) throw new Error("Dokumen asli wajib tersedia.");
          if (!workflow.receipt_attachment_id && !parsed.receiptFile) throw new Error("Unggah bukti serah-terima sebelum registrasi.");
        } else if (parsed.receiptFile) {
          throw new Error("Gunakan lampiran proses untuk surat historis.");
        }
        routingTargetId = target.id;
        routingNote = "Diteruskan kepada " + target.name;
        next = REVIEW_STATUS[target.role];
        nextRole = target.role;
        nextOwner = target.id;

      } else if (action === "HANDOFF_NOTA_DRAFT") {
        if (!isNotaDraft(letter) || user.role !== "STAFF" || workflow?.nota_drafter_user_id !== user.id ||
            letter.current_owner_user_id !== user.id) {
          throw new Error("Draf ini tidak sedang ditugaskan kepada Anda.");
        }
        const author = await activeNotaAccount(conn, authorId);
        if (!author || !canRequestNotaDraft(author.role)) throw new Error("Akun pengirim Nota Dinas tidak aktif.");
        await notaPrimaryTarget(conn, author.role, required(letter.routing_target_user_id, "Tujuan Nota Dinas", 36), directNota);
        if (!String(letter.summary ?? "").trim() && !(await notaDocument(conn, params.id))?.source) {
          throw new Error("Isi naskah pada Isi Draf Nota Dinas atau unggah PDF sebelum menyerahkan draf.");
        }
        nextRole = author.role;
        nextOwner = author.id;
        routingNote = "Draf diserahkan kepada " + author.name;

      } else if(action==="SUBMIT") {
        if(!["DRAFT","RETURNED_STAFF"].includes(status))
          throw new Error("Dokumen tidak berada pada tahap yang dapat diajukan.");

        if (directNota) throw new Error("Gunakan tombol Kirim pada detail Nota Dinas Direksi.");
        if (workflow?.nota_author_user_id && user.id !== authorId)
          throw new Error("Akun yang tercantum sebagai pengirim harus mengajukan Nota Dinas ini.");
        if(user.role!=="ROOT_ADMIN" && authorId!==String(user.id))
          throw new Error("Hanya penyusun dokumen yang dapat mengajukan ulang.");

        let target: { id: string; role: keyof typeof REVIEW_STATUS } | null;
        if (workflow) {
          if (workflow.kind === "PERSEKOT" && !workflow.spb_attachment_id) {
            throw new Error("Unggah SPB PDF pada pengajuan persekot sebelum diajukan.");
          }
          if (direction === "INTERNAL") {
            const author = await activeNotaAccount(conn, authorId);
            if (!author || (workflow.nota_author_user_id && author.role !== "MANAGER"))
              throw new Error("Akun pengirim Nota Dinas tidak aktif atau perannya berubah.");
            await requireNotaSignature(conn, params.id, workflow);
            target = author.role === "MANAGER"
              ? await activeReviewer(conn, letter.routing_target_user_id, [...NOTA_DIRECTORS])
              : await officialManager(conn, letter.routing_target_user_id);
          } else {
            target = await officialManager(conn, letter.routing_target_user_id, workflow.requesting_unit);
          }
        } else {
          const manager = await getRoutingManager(conn, letter.routing_target_user_id);
          target = manager && { id: String(manager.id), role: "MANAGER" };
        }
        if(!target) throw new Error("Tujuan review dokumen tidak ditemukan.");

        if (isInvoice(documentType)) {
          const invoice = await getBusinessDocumentRow(params.id, conn);
          if (!invoice || (invoice.requires_spk && !invoice.invoice_spk_id)) {
            throw new Error("Lengkapi data invoice dan rujukan SPK yang wajib sebelum diajukan.");
          }
        }
        next=REVIEW_STATUS[target.role];
        nextRole=target.role;
        nextOwner=target.id;

      } else if (action === "SEND_NOTA_REPLY" || action === "SEND_NOTA_DIRECT") {
        if (!directNota || (action === "SEND_NOTA_REPLY") !== notaReply ||
            status !== "DRAFT" || user.id !== authorId || !isNotaDirector(user.role)) {
          throw new Error("Draf hanya dapat dikirim oleh Direktur yang tercantum sebagai pengirim.");
        }
        const recipient = await activeNotaAccount(conn, required(letter.routing_target_user_id, "Penerima Nota Dinas", 36));
        if (!recipient || (!notaReply && !canReceiveDirectorNota(user.role, recipient.role))) {
          throw new Error("Akun penerima sudah tidak aktif atau perannya berubah.");
        }
        const additional = await listNotaRecipients(conn, params.id);
        await validateNotaRecipients(conn, additional.map(person => person.id), user, recipient.id, true);
        await requireNotaSignature(conn, params.id, workflow!);
        next = "COMPLETED";
        nextRole = null;
        nextOwner = recipient.id;
        routingNote = "Dikirim ke " + [recipient, ...additional].map(person => person.name).join(", ");

      } else if (action === "UNDO_APPROVAL") {
        if (!comment) throw new Error("Isi alasan pembatalan persetujuan.");
        const approval = await reversibleApproval(conn, user, letter);
        if (!approval || approval.id !== parsed.fields.approval_id) {
          throw new Error("Persetujuan ini sudah ditindaklanjuti, berubah, atau tidak dapat dibatalkan oleh akun ini.");
        }
        next = approval.status;
        nextRole = approval.role;
        nextOwner = approval.ownerId;
        routingNote = "Pembatalan persetujuan #" + approval.id;

      } else if(action==="APPROVE") {
        const expected = status === "SECRETARIAT_REVIEW" && atSecretariat ? "SECRETARIAT" : reviewRole(status);
        if(!expected) throw new Error("Dokumen tidak sedang menunggu approval.");

        assertCurrentReviewer(user,letter,expected);
        await assertVerified();

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
        await assertVerified();
        next="APPROVED";
        nextRole=null;
        nextOwner=null;

      } else if(action==="RETURN" || action==="RETURN_PREVIOUS") {
        const expected = status === "SECRETARIAT_REVIEW" && atSecretariat ? "SECRETARIAT" : reviewRole(status);
        if(!expected) throw new Error("Dokumen tidak sedang dalam review.");
        if(action==="RETURN_PREVIOUS" && (workflow || !outgoing || status==="MANAGER_REVIEW"))
          throw new Error("Tidak ada tahap pemeriksa sebelumnya.");

        assertCurrentReviewer(user,letter,expected);
        if(!comment) throw new Error("Catatan pengembalian wajib diisi.");
        await assertNoActiveTasks();

        if (incomingViaSecretariat && (workflow || letter.current_owner_user_id === letter.routing_target_user_id)) {
          next = "SECRETARIAT_INTAKE";
          nextRole = "SECRETARIAT";
          nextOwner = null;
         } else if ((outgoing && action === "RETURN") || status === "MANAGER_REVIEW" || (workflow && direction === "INTERNAL")) {
          next = "RETURNED_STAFF";
          nextRole = workflow?.nota_author_user_id ? "MANAGER" : "STAFF";
          nextOwner = authorId;
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
        const expected = !outgoing && workflow ? reviewRole(status)
          : outgoing && status === "PRESIDENT_DIRECTOR_REVIEW" ? "PRESIDENT_DIRECTOR" : undefined;
        if (!expected) throw new Error("Penolakan final hanya tersedia pada tahap review yang berwenang.");
        assertCurrentReviewer(user, letter, expected);
        await assertNoActiveTasks();
        if (!comment) throw new Error("Alasan penolakan wajib diisi.");
        next = "REJECTED";
        nextRole = null;
        nextOwner = null;

      } else if(action==="RESPONSE") {
        if(direction!=="INTERNAL")
          throw new Error("Tanggapan khusus tersedia untuk Nota Dinas.");

        if(!comment)
          throw new Error("Isi tanggapan wajib diisi.");

        if(!await canRespondToNota(conn, user, letter))
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

        if (workflow) {
          const [pilotJobs] = await conn.query<RowDataPacket[]>(
            "SELECT 1 FROM siap_v11_signing WHERE letter_id=? AND mode=?", [params.id, MEKARI_PILOT_JOB_MODE],
          );
          if (pilotJobs.length) throw new Error("Surat simulasi dengan konfigurasi pilot lama tidak dapat diterbitkan.");
        }

        if (secretariat || (documentType === SPK_OUTGOING && await getBusinessDocumentRow(params.id, conn))) {
          const method = parsed.signatureMethod;
          if (workflow && method === "MEKARI_API") {
            const [signing] = await conn.query<RowDataPacket[]>(
              "SELECT final_attachment_id,mode FROM siap_v11_signing WHERE letter_id=? AND status='COMPLETED'", [params.id],
            );
            if (!signing[0]?.final_attachment_id || parsed.signedFile) throw new Error("PDF final Mekari belum tersedia atau ada unggahan ganda.");
            if (signing[0].mode !== mekariMode()) throw new Error("PDF sandbox atau simulasi hanya berlaku di staging yang sesuai.");
            signature = "DIGITAL";
            signatureProvenance = signing[0].mode === "mock" ? "MEKARI_MOCK" : "MEKARI_SANDBOX";
            signatureAttachmentId = signing[0].final_attachment_id;
          } else {
            if (method !== "DIGITAL" && method !== "BASAH" && !(workflow && method === "MEKARI_MANUAL")) {
              throw new Error("Pilih metode tanda tangan dokumen.");
            }
            signature = method === "BASAH" ? "BASAH" : "DIGITAL";
            signatureProvenance = workflow ? method : null;
            const extension = signature === "DIGITAL" ? /\.pdf$/i : /\.(pdf|png|jpe?g)$/i;
            if (!parsed.signedFile || !extension.test(parsed.signedFile.name)) {
              throw new Error(signature === "DIGITAL"
                ? "Unggah PDF yang sudah ditandatangani secara digital."
                : "Unggah hasil pindai surat yang ditandatangani (PDF, JPG, atau PNG).");
            }
          }
        }

        issuedDate=parsed.issuedDate
          ? (workflow ? checkedDate : dateOnly)(parsed.issuedDate,"Tanggal terbit")
          : workflow ? jakartaDate() : new Date().toISOString().slice(0,10);

        next="ISSUED";
        nextRole=secretariat ? "SECRETARIAT" : null;
        nextOwner=null;

      } else if (action === "MARK_SENT") {
        if (!outgoing || status !== "ISSUED" || !handlesSecretariat || letter.sent_date) {
          throw new Error("Surat ini tidak sedang menunggu pencatatan pengiriman.");
        }
        sentDate = (workflow ? checkedDate : dateOnly)(parsed.sentDate, "Tanggal kirim");
        if (workflow) {
          dispatchChannel = required(parsed.fields.dispatch_channel, "Kanal pengiriman", 16);
          if (!Object.hasOwn(DELIVERY_METHODS, dispatchChannel)) throw new Error("Kanal pengiriman tidak valid.");
          dispatchRecipient = required(parsed.fields.dispatch_recipient, "Penerima pengiriman", 255);
          if (!parsed.dispatchFile) throw new Error("Unggah bukti pengiriman.");
          if (sentDate > jakartaDate()) throw new Error("Tanggal kirim tidak boleh di masa depan.");
        } else if (parsed.dispatchFile) throw new Error("Gunakan lampiran proses untuk surat historis.");
        const issueDate = letter.issued_date instanceof Date
          ? letter.issued_date.toISOString().slice(0, 10) : String(letter.issued_date || "").slice(0, 10);
        if (!issueDate || sentDate < issueDate) throw new Error("Tanggal kirim harus pada atau setelah tanggal terbit.");
        nextRole = null;
        nextOwner = null;

      } else if(action==="COMPLETE") {
        if (directNota) throw new Error("Nota Dinas Direksi selesai saat dikirim oleh pengirim.");
        if (v11Invoice) {
          const manager = await officialManager(conn, user.id);
          if (manager.scope !== "KSU" || status !== "APPROVED") throw new Error("Invoice diselesaikan oleh Manager Keuangan setelah disetujui.");
          await assertVerified();
          await requireInvoicePaid(conn, params.id, workflow!.payable_id);
        } else if (!["ROOT_ADMIN", "DIRECTOR_OPS", "PRESIDENT_DIRECTOR"].includes(user.role) &&
          !(workflow && user.role === "MANAGER" && user.id === letter.routing_target_user_id)) {
          throw new Error("Tidak berhak menutup dokumen.");
        }
        await assertNoActiveTasks();

        if ((workflow && direction === "INTERNAL" && status !== "APPROVED") || (business || secretariat) && (outgoing
          ? status !== "ISSUED" || (secretariat && !letter.sent_date)
          : !["APPROVED","DISPOSED","IN_PROGRESS"].includes(status))) {
          throw new Error("Dokumen belum dapat diselesaikan pada tahap ini.");
        }
        next="COMPLETED";
        nextRole=null;
        nextOwner=null;

      } else if(action==="CANCEL") {
        if(user.role!=="ROOT_ADMIN" && authorId!==String(user.id) &&
          !(workflow?.nota_author_user_id && user.id===letter.created_by && ["DRAFT","RETURNED_STAFF"].includes(status)))
          throw new Error("Tidak berhak membatalkan dokumen.");

        if (status === "REJECTED" || ((business || secretariat || directNota) && ["ISSUED","COMPLETED","CANCELLED"].includes(status))) {
          throw new Error("Dokumen tidak dapat dibatalkan pada tahap ini.");
        }
        if(!comment)
          throw new Error("Alasan pembatalan wajib diisi.");

        await assertNoActiveTasks();
        if (workflow?.payable_id) throw new Error("Invoice sudah masuk buku utang dan memerlukan rekonsiliasi Finance.");
        next="CANCELLED";
        nextRole=null;
        nextOwner=null;

      } else {
        throw new Error("Action tidak dikenal.");
      }

      if (parsed.signedFile && !signature) throw new Error("File bertanda tangan hanya tersedia saat penerbitan.");
      const actionId = crypto.randomUUID();
      const snapshot: ApprovalSnapshot | null = ["APPROVE", "APPROVE_FINAL"].includes(action)
        ? { id: actionId, status, role: letter.current_role, ownerId: letter.current_owner_user_id }
        : null;

      await conn.execute(
        `UPDATE siap_letters SET status=?,\`current_role\`=?,current_owner_user_id=?,
         cancelled_reason=IF(? IN ('CANCELLED','REJECTED'),?,cancelled_reason),
         issued_date=COALESCE(?,issued_date),sent_date=COALESCE(?,sent_date),received_date=COALESCE(?,received_date),
         routing_target_user_id=COALESCE(?,routing_target_user_id),updated_by=?,approval_snapshot=?
         WHERE id=?`,
        [next, nextRole, nextOwner, next, comment.slice(0, 1000) || null, issuedDate, sentDate, receiptDate, routingTargetId, user.id,
          snapshot ? JSON.stringify(snapshot) : null, params.id],
      );
      const signatureNote = signature === "DIGITAL" ? "Tanda tangan digital" : signature === "BASAH" ? "Tanda tangan basah" : null;
      const actionComment = [comment, routingNote, signatureProvenance || signatureNote].filter(Boolean).join(" • ");
      await conn.execute(
        `INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment)
         VALUES (?,?,?,?,?,?,?)`,
        [actionId, params.id, user.id, action, status, next, actionComment || null],
      );

      if (signature && parsed.signedFile) {
        const signed = workflow ? await saveProof(parsed.signedFile, signature === "DIGITAL", "ORIGINAL")
          : await saveUpload(parsed.signedFile, "ORIGINAL");
        stored.push(signed);
        signatureAttachmentId = await insertLetterAttachment(conn, params.id, user.id, signed, "PROCESS", actionId);
      }

      const storeProof = async (file: File) => {
        const saved = await saveProof(file);
        stored.push(saved);
        return insertLetterAttachment(conn, params.id, user.id, saved, "PROCESS", actionId);
      };
      let receiptId = workflow?.receipt_attachment_id ?? null;
      let dispatchId: string | null = null;
      if (receipt) {
        if (parsed.receiptFile) receiptId = await storeProof(parsed.receiptFile);
        const rerouted = v11Invoice && routingTargetId !== letter.routing_target_user_id;
        await conn.execute(
          `UPDATE siap_v11_letters SET received_time=?,delivery_method=?,delivered_by=?,received_by=?,
             receipt_note=?,receipt_attachment_id=?,invoice_revision=invoice_revision+? WHERE letter_id=?`,
          [receipt.receivedTime, receipt.method, receipt.deliveredBy, receipt.receivedBy, receipt.note, receiptId, Number(rerouted), params.id],
        );
      }
      if (dispatchChannel && parsed.dispatchFile) {
        dispatchId = await storeProof(parsed.dispatchFile);
        await conn.execute("UPDATE siap_v11_letters SET dispatch_channel=?,dispatch_recipient=?,dispatch_attachment_id=? WHERE letter_id=?",
          [dispatchChannel, dispatchRecipient, dispatchId, params.id]);
      }
      if (signatureProvenance) {
        await conn.execute("UPDATE siap_v11_letters SET signature_provenance=?,signature_attachment_id=? WHERE letter_id=?",
          [signatureProvenance, signatureAttachmentId, params.id]);
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
        user, action: "LETTER_" + action, entityType: "LETTER", entityId: params.id,
        metadata: {
          from: status, to: next, comment, direction, issuedDate, sentDate, routingTargetId,
          processAttachments: stored.map(file => file.originalName), signatureMethod: signature, signatureProvenance,
          receiptDate, receiptAttachmentId: receipt ? receiptId : null, dispatchChannel, dispatchAttachmentId: dispatchId,
          reversedApprovalId: action === "UNDO_APPROVAL" ? parsed.fields.approval_id : undefined,
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
