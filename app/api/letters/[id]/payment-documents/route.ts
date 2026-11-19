import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { getAccessibleLetter } from "@/lib/letter-access";
import { discardUncommittedFiles, insertLetterAttachment, markPaymentAttachment, paymentAttachmentJoins,
  paymentAttachmentKind, type StoredLetterFile } from "@/lib/letter-uploads";
import { readStoredFile } from "@/lib/upload";
import { proofMimeType, saveProof, takeFile, v11Letter } from "@/lib/v11-data";
import { canEditPaymentDocuments, paymentKind } from "@/lib/v11-payment-documents";
import { PERSEKOT_DOCUMENTS } from "@/lib/v11-workflow";
import type { RowDataPacket } from "mysql2/promise";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });

  const staged: StoredLetterFile[] = [];
  try {
    const form = await request.formData();
    const code = String(form.get("document_code") || "");
    const file = takeFile(form.get("file"));
    const attachmentId = String(form.get("attachment_id") || "").trim();
    const recipient = String(form.get("recipient_type") || "");
    const changingRecipient = ["VENDOR", "NON_VENDOR"].includes(recipient) && !code && !file && !attachmentId;
    const changingDocument = !recipient && Object.hasOwn(PERSEKOT_DOCUMENTS, code) && Boolean(file) !== Boolean(attachmentId);
    if (!changingRecipient && !changingDocument) {
      throw new Error("Pilih tujuan pembayaran atau pilih satu berkas untuk jenis dokumen persyaratan.");
    }

    const result = await withTransaction(async conn => {
      const letter = await getAccessibleLetter(user, params.id, conn, true);
      const workflow = letter ? await v11Letter(params.id, conn) : null;
      const kind = paymentKind(workflow, letter?.document_type);
      if (!letter || !workflow || !kind || !await canEditPaymentDocuments(conn, letter, user)) return null;
      if (code === "SPB" && kind !== "PERSEKOT") throw new Error("SPB hanya dapat diunggah untuk pengajuan persekot.");

      if (changingRecipient) {
        const [active] = await conn.query<RowDataPacket[]>(
          `SELECT 1 FROM siap_dispositions d JOIN siap_v11_dispositions v ON v.disposition_id=d.id
           WHERE d.letter_id=? AND v.purpose IN ('REQUEST_PAYMENT','INVOICE_PAYMENT')
             AND d.status NOT IN ('RETURNED','CANCELLED') LIMIT 1`, [params.id],
        );
        if (active.length) throw new Error("Tujuan pembayaran sudah ditetapkan pada instruksi Finance.");
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
