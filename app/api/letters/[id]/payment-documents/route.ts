import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { getAccessibleLetter } from "@/lib/letter-access";
import { discardUncommittedFiles, insertLetterAttachment, markPaymentAttachment, paymentAttachmentJoins,
  paymentAttachmentKind, type StoredLetterFile } from "@/lib/letter-uploads";
import { readStoredFile } from "@/lib/upload";
import { proofMimeType, saveProof, takeFile, v11Letter } from "@/lib/v11-data";
import { canEditPaymentDocuments, invoicePaymentAccess, invoicePaymentMode, invoicePaymentNeedsReview,
  paymentInstructionExists, paymentKind } from "@/lib/v11-payment-documents";
import { INVOICE_PAYMENT_MODES, PERSEKOT_DOCUMENTS, type InvoicePaymentMode } from "@/lib/v11-workflow";
import type { RowDataPacket } from "mysql2/promise";

export const runtime = "nodejs";

export async function POST(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });

  const staged: StoredLetterFile[] = [];
  try {
    const form = await request.formData();
    const code = String(form.get("document_code") || "");
    const file = takeFile(form.get("file"));
    const attachmentId = String(form.get("attachment_id") || "").trim();
    const recipient = String(form.get("recipient_type") || "");
    const modeAction = String(form.get("invoice_payment_action") || "");
    const changingMode = ["SAVE_MODE", "REVIEW_MODE"].includes(modeAction) && !recipient && !code && !file && !attachmentId;
    const changingRecipient = !modeAction && ["VENDOR", "NON_VENDOR"].includes(recipient) && !code && !file && !attachmentId;
    const changingDocument = !modeAction && !recipient && Object.hasOwn(PERSEKOT_DOCUMENTS, code) && Boolean(file) !== Boolean(attachmentId);
    if (!changingMode && !changingRecipient && !changingDocument) {
      throw new Error("Pilih jenis atau tujuan pembayaran, atau pilih satu berkas persyaratan.");
    }

    const result = await withTransaction(async conn => {
      const letter = await getAccessibleLetter(user, params.id, conn, true);
      const workflow = letter ? await v11Letter(params.id, conn) : null;
      const kind = paymentKind(workflow, letter?.document_type);
      if (!letter || !workflow || !kind) return null;
      const invoiceAccess = await invoicePaymentAccess(conn, letter, workflow, user);
      const invoice = kind === "INVOICE" ? invoicePaymentMode(workflow) : null;

      if (changingMode && invoice && invoiceAccess) {
        if (invoiceAccess.locked) throw new Error("Jenis pembayaran dikunci karena instruksi Finance sudah dibuat.");
        const reviewing = modeAction === "REVIEW_MODE";
        if (reviewing ? !invoiceAccess.canReview : !invoiceAccess.editable) return null;
        if (form.get("invoice_payment_revision") !== String(invoice.revision)) {
          throw new Error("Jenis pembayaran atau SPB sudah berubah. Muat ulang detail sebelum melanjutkan.");
        }
        const requested = reviewing ? invoice.mode : String(form.get("invoice_payment_mode") || "");
        if (!Object.hasOwn(INVOICE_PAYMENT_MODES, requested)) throw new Error("Pilih jenis pembayaran yang tersedia.");
        const mode = requested as InvoicePaymentMode;
        const reason = mode !== "PERSEKOT" ? null : reviewing ? invoice.reason : String(form.get("persekot_reason") || "").trim();
        if (mode === "PERSEKOT" && (!reason || reason.length > 1000)) {
          throw new Error("Isi alasan persekot, maksimal 1000 karakter.");
        }

        if (reviewing) {
          if (!invoice.reviewRequired) return { mode };
          if (mode === "PERSEKOT" && !workflow.spb_attachment_id) throw new Error("Unggah SPB sebelum menyetujui ulang persekot.");
        } else if (invoice.mode === mode && invoice.reason === reason) {
          return { mode };
        }
        const reviewRequired = !reviewing && await invoicePaymentNeedsReview(conn, letter, workflow);
        await conn.execute(
          `UPDATE siap_v11_letters SET invoice_persekot_reason=?,invoice_payment_review_required=?,
             invoice_payment_mode_revision=invoice_payment_mode_revision+1 WHERE letter_id=?`,
          [reason, Number(reviewRequired), params.id],
        );
        await conn.execute("UPDATE siap_letters SET updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [user.id, params.id]);
        const action = reviewing ? "REVIEW_INVOICE_PAYMENT_MODE" : "UPDATE_INVOICE_PAYMENT_MODE";
        const label = INVOICE_PAYMENT_MODES[mode];
        const comment = reviewing ? label : INVOICE_PAYMENT_MODES[invoice.mode] + " → " + label;
        await conn.execute(
          `INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment)
           VALUES (?,?,?,?,?,?,?)`,
          [randomUUID(), params.id, user.id, action, letter.status, letter.status, reason ? comment + " · " + reason : comment],
        );
        await auditLog({ user, action, entityType: "LETTER", entityId: params.id,
          metadata: { previousMode: invoice.mode, mode, reason, reviewRequired }, request }, conn);
        return { mode };
      }
      if (changingMode) return null;
      if (!invoiceAccess?.editable && !await canEditPaymentDocuments(conn, letter, user)) return null;
      if (code === "SPB") {
        if (kind !== "PERSEKOT" && invoice?.mode !== "PERSEKOT") {
          throw new Error("SPB hanya dapat diunggah untuk pengajuan persekot.");
        }
        if (invoice && invoiceAccess?.locked) throw new Error("SPB dikunci karena instruksi Finance sudah dibuat.");
        if (invoice && !invoiceAccess?.editable) return null;
      }

      if (changingRecipient) {
        if (await paymentInstructionExists(conn, params.id)) throw new Error("Tujuan pembayaran sudah ditetapkan pada instruksi Finance.");
        await conn.execute(
          `INSERT INTO siap_v11_payment_recipients (letter_id,recipient_type) VALUES (?,?)
           ON DUPLICATE KEY UPDATE recipient_type=VALUES(recipient_type)`, [params.id, recipient],
        );
        await auditLog({ user, action: "LETTER_PAYMENT_RECIPIENT", entityType: "LETTER",
          entityId: params.id, metadata: { recipient }, request }, conn);
        return { recipient };
      }

      let id: string;
      if (file) {
        const saved = await saveProof(file, code === "SPB");
        staged.push(saved);
        id = await insertLetterAttachment(conn, params.id, user.id, saved, "PAYMENT_DOCUMENT");
      } else {
        const [[existing]] = await conn.query<RowDataPacket[]>(
          `SELECT a.id,a.original_name,a.storage_path,a.is_compressed FROM siap_attachments a
           ${paymentAttachmentJoins}
           WHERE a.id=? AND a.letter_id=? AND a.disposition_id IS NULL AND a.letter_action_id IS NULL
             AND a.attachment_kind='ADDITIONAL' AND ${paymentAttachmentKind}='ADDITIONAL'
             AND NOT (a.id<=>v.receipt_attachment_id OR a.id<=>v.signature_attachment_id OR a.id<=>v.dispatch_attachment_id)`,
          [attachmentId, params.id],
        );
        if (!existing) throw new Error("Pilih lampiran umum yang tersedia pada surat ini.");
        const bytes = await readStoredFile(existing.storage_path, Boolean(existing.is_compressed));
        await proofMimeType(new File([new Uint8Array(bytes)], existing.original_name), code === "SPB");
        id = existing.id;
        await markPaymentAttachment(conn, params.id, id);
      }
      if (code === "SPB") {
        await markPaymentAttachment(conn, params.id, workflow.spb_attachment_id);
        await conn.execute("UPDATE siap_v11_letters SET spb_attachment_id=? WHERE letter_id=?", [id, params.id]);
        if (invoice) {
          const reviewRequired = await invoicePaymentNeedsReview(conn, letter, workflow);
          await conn.execute(
            `UPDATE siap_v11_letters SET invoice_payment_review_required=?,
               invoice_payment_mode_revision=invoice_payment_mode_revision+1 WHERE letter_id=?`,
            [Number(reviewRequired), params.id],
          );
        }
      } else {
        await conn.execute(
          `INSERT INTO siap_v11_payment_documents (letter_id,document_code,attachment_id) VALUES (?,?,?)
           ON DUPLICATE KEY UPDATE attachment_id=VALUES(attachment_id)`, [params.id, code, id],
        );
      }
      await auditLog({ user, action: "LETTER_PAYMENT_DOCUMENT", entityType: "LETTER",
        entityId: params.id, metadata: { documentCode: code, attachmentId: id, reused: Boolean(attachmentId) }, request }, conn);
      return { id };
    });

    staged.length = 0;
    if (!result) return NextResponse.json({ ok: false, error: "Akun tidak berhak mengubah persyaratan pengajuan ini." }, { status: 403 });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    await discardUncommittedFiles(staged);
    return NextResponse.json({ ok: false, error: error instanceof Error && !("code" in error) ? error.message : "Gagal menyimpan persyaratan." }, { status: 400 });
  }
}
