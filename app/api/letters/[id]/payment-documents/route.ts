import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { getAccessibleLetter } from "@/lib/letter-access";
import { discardUncommittedFiles, insertLetterAttachment, type StoredLetterFile } from "@/lib/letter-uploads";
import { saveProof, takeFile, v11Letter } from "@/lib/v11-data";
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
    const recipient = String(form.get("recipient_type") || "");
    const changingRecipient = ["VENDOR", "NON_VENDOR"].includes(recipient) && !code && !file;
    const uploadingDocument = !recipient && Object.hasOwn(PERSEKOT_DOCUMENTS, code) && file;
    if (!changingRecipient && !uploadingDocument) {
      throw new Error("Pilih jenis tujuan pembayaran atau unggah satu dokumen persyaratan.");
    }

    const result = await withTransaction(async conn => {
      const letter = await getAccessibleLetter(user, params.id, conn, true);
      const workflow = letter ? await v11Letter(params.id, conn) : null;
      const kind = paymentKind(workflow, letter?.document_type);
      if (!letter || !kind || !await canEditPaymentDocuments(conn, letter, user)) return null;
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

      const saved = await saveProof(file!, code === "SPB");
      staged.push(saved);
      const id = await insertLetterAttachment(conn, params.id, user.id, saved, "ADDITIONAL");
      if (code === "SPB") {
        await conn.execute("UPDATE siap_v11_letters SET spb_attachment_id=? WHERE letter_id=?", [id, params.id]);
      } else {
        await conn.execute(
          `INSERT INTO siap_v11_payment_documents (letter_id,document_code,attachment_id) VALUES (?,?,?)
           ON DUPLICATE KEY UPDATE attachment_id=VALUES(attachment_id)`, [params.id, code, id],
        );
      }
      await auditLog({ user, action: "LETTER_PAYMENT_DOCUMENT", entityType: "LETTER",
        entityId: params.id, metadata: { documentCode: code, attachmentId: id }, request }, conn);
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
