import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { required, str } from "@/lib/http";
import { getAccessibleLetter } from "@/lib/letter-access";
import { discardUncommittedFiles, insertLetterAttachment, type StoredLetterFile } from "@/lib/letter-uploads";
import { canEditNotaDocument, canUploadNotaSignature, isNotaDraft, notaAuthorId,
  notaDocument, requiresNotaProof, saveNotaSource } from "@/lib/nota-document";
import { uploadedOutgoingSignatureMethod } from "@/lib/outgoing-signature";
import { activeNotaAccount, listNotaRecipients, notaPartyLabel } from "@/lib/nota-routing";
import { checkedCorrespondenceLayout } from "@/lib/correspondence-layout";
import { correspondenceDraft, saveCorrespondencePdf, senderTitle } from "@/lib/correspondence-draft-data";
import { defaultNotaFormatId, reserveLetterNumber } from "@/lib/numbering";
import { readStoredFile } from "@/lib/upload";
import { proofMimeType, saveProof, takeFile, v11Letter } from "@/lib/v11-data";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  const staged: StoredLetterFile[] = [];
  try {
    const form = request.headers.get("content-type")?.includes("multipart/form-data") ? await request.formData() : null;
    const body = form ? Object.fromEntries(form) : await request.json();
    const action = String(body.action || "");
    if (!["GENERATE", "DECLARE", "RESET", "UPLOAD_SIGNATURE", "ASSIGN_ASSISTANT"].includes(action)) {
      throw new Error("Aksi Nota Dinas tidak dikenal.");
    }

    const ok = await withTransaction(async conn => {
      const letter = await getAccessibleLetter(user, params.id, conn, true);
      if (!letter || !isNotaDraft(letter)) return false;
      const workflow = await v11Letter(params.id, conn);
      if (!workflow) return false;
      const authorId = notaAuthorId(letter, workflow);
      if (action === "ASSIGN_ASSISTANT" ? user.id !== authorId
        : action === "UPLOAD_SIGNATURE" ? !canUploadNotaSignature(user, letter, workflow)
        : !canEditNotaDocument(user, letter, workflow)) return false;

      const actionId = randomUUID();
      const current = await notaDocument(conn, params.id);
      let event: string;
      let detail: string;
      let sourceId = current?.source?.id ?? null;
      let signedFile: StoredLetterFile | null = null;
      let assistantId: string | null = null;
      if (action === "ASSIGN_ASSISTANT") {
        const selectedId = str(body.assistant_id, 36);
        const assistant = selectedId ? await activeNotaAccount(conn, selectedId) : null;
        if (selectedId && assistant?.role !== "SECRETARIAT") throw new Error("Pilih akun Sekretariat yang aktif.");
        assistantId = assistant?.id ?? null;
        if (assistantId === workflow.nota_signature_assistant_user_id) return true;
        await conn.execute("UPDATE siap_v11_letters SET nota_signature_assistant_user_id=? WHERE letter_id=?",
          [assistantId, params.id]);
        event = "ASSIGN_NOTA_SIGNATURE";
        detail = assistant ? "Bantuan tanda tangan ditugaskan ke " + assistant.name : "Bantuan Sekretariat dicabut.";
      } else if (action === "GENERATE") {
        const author = await activeNotaAccount(conn, authorId);
        if (!author) throw new Error("Akun pengirim Nota Dinas tidak aktif.");
        const [[dates]] = await conn.query<RowDataPacket[]>("SELECT DATE_FORMAT(letter_date,'%Y-%m-%d') date FROM siap_letters WHERE id=?", [params.id]);
        const origin = workflow.kind === "NOTA_REPLY" && letter.source_letter_id
          ? await getAccessibleLetter(user, letter.source_letter_id, conn) : null;
        let number = letter.letter_number;
        if (!number) {
          const formatId = await defaultNotaFormatId(conn);
          const reserved = await reserveLetterNumber({
            conn, formatId, letterId: params.id, letterDate: dates.date, userId: user.id, documentType: "NOTA_DINAS",
          });
          number = reserved.rendered;
          await conn.execute("UPDATE siap_letters SET number_format_id=?,letter_number=? WHERE id=?", [formatId, number, params.id]);
        }
        const layout = body.document_layout === undefined
          ? (await correspondenceDraft(conn, params.id))?.layout ?? checkedCorrespondenceLayout(undefined)
          : checkedCorrespondenceLayout(body.document_layout);
        const file = await saveCorrespondencePdf(conn, {
          id: params.id, userId: user.id, direction: "INTERNAL", number, date: dates.date,
          author: author.name, authorTitle: senderTitle(author),
          recipient: [letter.recipient, ...(await listNotaRecipients(conn, params.id)).map(notaPartyLabel)].filter(Boolean).join("\n"),
          subject: letter.subject, body: letter.summary ?? "", layout,
          confidentiality: letter.confidentiality, reference: origin?.subject,
        }, staged);
        sourceId = file.id;
        await saveNotaSource(conn, params.id, sourceId, "GENERATED");
        event = "GENERATE_NOTA_PDF";
        detail = file.name;
      } else {
        if (!current?.source || body.source_id !== current.source.id) {
          throw new Error("Buka PDF utama terbaru sebelum mencatat tanda tangan.");
        }
        if (action === "UPLOAD_SIGNATURE") {
          const file = takeFile(form?.get("signed_file"));
          const method = String(body.signature_method || "");
          if (!file) throw new Error("Pilih PDF yang sudah bertanda tangan.");
          if (!uploadedOutgoingSignatureMethod(method)) throw new Error("Pilih metode tanda tangan.");
          signedFile = await saveProof(file, true, "ORIGINAL");
          staged.push(signedFile);
          // The action row must exist before inserting its attachment.
          event = "UPLOAD_NOTA_SIGNATURE";
          detail = (method === "BASAH" ? "Hasil pindai tanda tangan basah" : "PDF bertanda tangan digital") + " · " + signedFile.originalName;
        } else {
          if (current.signed) throw new Error("PDF utama sudah memiliki berkas bertanda tangan.");
          if (action === "DECLARE" && requiresNotaProof(workflow)) throw new Error("Nota ini memerlukan PDF bertanda tangan.");
          const reason = action === "DECLARE" ? required(body.reason, "Alasan atau keterangan tanda tangan", 1000) : null;
          if (action === "RESET" && !current.manualReason) return true;
          if (reason) {
            const [[source]] = await conn.query<RowDataPacket[]>("SELECT storage_path,is_compressed FROM siap_attachments WHERE id=?", [sourceId]);
            const bytes = await readStoredFile(source.storage_path, Boolean(source.is_compressed));
            await proofMimeType(new File([new Uint8Array(bytes)], current.source.original_name), true);
          }
          await conn.execute(
            `INSERT INTO siap_v11_nota_documents (letter_id,source_attachment_id,source_kind,manual_reason)
             VALUES (?,?,'UPLOAD',?) ON DUPLICATE KEY UPDATE manual_reason=VALUES(manual_reason)`,
            [params.id, sourceId, reason],
          );
          event = reason ? "DECLARE_NOTA_SIGNED" : "RESET_NOTA_SIGNATURE";
          detail = reason || "Pengirim menandai PDF sebagai belum ditandatangani.";
        }
      }
      await conn.execute("UPDATE siap_letters SET updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [user.id, params.id]);
      await conn.execute(
        `INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment)
         VALUES (?,?,?,?,?,?,?)`,
        [actionId, params.id, user.id, event, letter.status, letter.status, detail],
      );
      let signatureId: string | null = null;
      if (signedFile) {
        signatureId = await insertLetterAttachment(conn, params.id, user.id, signedFile, "PROCESS", actionId);
        await conn.execute(
          "UPDATE siap_v11_letters SET signature_attachment_id=?,signature_provenance=? WHERE letter_id=?",
          [signatureId, body.signature_method, params.id],
        );
        await conn.execute("UPDATE siap_v11_nota_documents SET manual_reason=NULL WHERE letter_id=?", [params.id]);
      }
      await auditLog({ user, action: "LETTER_" + event, entityType: "LETTER", entityId: params.id,
        metadata: { sourceId, signatureId, assistantId, comment: detail }, request }, conn);
      return true;
    });
    staged.length = 0;
    if (!ok) return NextResponse.json({ ok: false, error: "Akun ini tidak dapat melakukan tindakan tersebut pada draf Nota Dinas." }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    await discardUncommittedFiles(staged);
    return NextResponse.json({ ok: false, error: cause instanceof Error && !("code" in cause) ? cause.message : "Dokumen Nota Dinas belum dapat disimpan." }, { status: 400 });
  }
}
