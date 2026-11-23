import { canEditPaymentDocuments, invoicePaymentAccess, paymentDocuments } from "@/lib/v11-payment-documents";
import { sandboxAttachmentsEnabled } from "@/lib/mekari-sign";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { dateOnly, required, str } from "@/lib/http";
import { findLetterReferences, getBusinessDocumentDetails, getBusinessDocumentRow, saveBusinessDocument } from "@/lib/business-document-data";
import { INVOICE_INCOMING, isBusinessDocument, isInvoice } from "@/lib/business-documents";
import { letterAccess } from "@/lib/letter-access";
import { reversibleApproval } from "@/lib/letter-approval";
import { canHandleSecretariat } from "@/lib/correspondence-workflow";
import { listLetterActions, outgoingSources } from "@/lib/correspondence-data";
import { checkedDate, invoiceKey, invoiceVerified, officialManager, persekotChecklist, receiptFields,
  requestingUnit, saveProof, takeFile, v11Enabled, v11Letter } from "@/lib/v11-data";
import { invoiceVerificationStatus, jakartaDate } from "@/lib/v11-workflow";
import { invoicePaymentSummary } from "@/lib/v11-finance";
import { canEditNotaDocument, canUploadNotaSignature, isDirectNota, isNotaDraft, notaAuthorId, notaDocument, requiresNotaProof,
  saveNotaSource } from "@/lib/nota-document";
import { activeNotaAccount, directorsForNotaReply, listNotaRecipients, notaPartyLabel, notaPrimaryTarget,
  notaReplyRecipient, saveNotaRecipients, validateNotaRecipients } from "@/lib/nota-routing";
import { discardUncommittedFiles, insertLetterAttachment, listLetterAttachments, markPaymentAttachment, type StoredLetterFile } from "@/lib/letter-uploads";

export const runtime = "nodejs";

export async function GET(_:Request,{params}:{params:{id:string}}) {
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  const access = letterAccess(user);
  const [letters]=await db.query<RowDataPacket[]>(
    `SELECT l.*,
      u.name creator_name,
      uo.name owner_name,
      uo.unit_name owner_unit,
      rt.name routing_target_name,
      rt.unit_name routing_target_unit,
      nf.name format_name,nf.code format_code,
      nl.seq_base,nl.variant,
      COALESCE(NULLIF(l.legacy_number_text,''), CASE WHEN nl.seq_base IS NULL THEN NULL WHEN nl.variant>0 THEN CONCAT(nl.seq_base,'.',nl.variant) ELSE CAST(nl.seq_base AS CHAR) END) display_number
     FROM siap_letters l
     JOIN siap_users u ON u.id=l.created_by
     LEFT JOIN siap_users uo ON uo.id=l.current_owner_user_id
     LEFT JOIN siap_users rt ON rt.id=l.routing_target_user_id
     LEFT JOIN siap_number_formats nf ON nf.id=l.number_format_id
     LEFT JOIN siap_number_ledger nl ON nl.letter_id=l.id
     WHERE l.id=? AND ${access.clause} LIMIT 1`,[params.id,...access.params]);
  if (!letters[0]) {
    return user.role === "ROOT_ADMIN"
      ? NextResponse.json({ ok: false, error: "Surat tidak ditemukan." }, { status: 404 })
      : NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const [actions, attachments] = await Promise.all([
    listLetterActions(db, user, params.id),
    listLetterAttachments(db, user, params.id),
  ]);
  const approval = await reversibleApproval(db, user, letters[0]);
  const { source_letter_id: sourceLetterId, source_disposition_id: sourceDispositionId, approval_snapshot, ...letter } = letters[0];
  const originalId = letter.active_original_attachment_id ??
    [...attachments].reverse().find(file => file.attachment_kind === "ORIGINAL")?.id;
  const business = isBusinessDocument(letter.document_type)
    ? await getBusinessDocumentDetails(user, params.id, letter.document_type)
    : undefined;
  const [sourceLetter] = sourceLetterId
    ? await findLetterReferences(user, { kind: "support", ids: [sourceLetterId], includeCancelled: true })
    : [];
  let sourceDisposition: { id: string } | undefined;
  if (sourceDispositionId) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT d.id FROM siap_dispositions d JOIN siap_letters l ON l.id=d.letter_id WHERE d.id=? AND l.deleted_at IS NULL
       AND (?='ROOT_ADMIN' OR ? IN (d.from_user_id,d.to_user_id,d.current_owner_user_id)) LIMIT 1`,
      [sourceDispositionId, user.role, user.id],
    );
    if (rows[0]) sourceDisposition = { id: rows[0].id };
  }
  const workflow = await v11Letter(params.id);
  let v11;
  if (workflow) {
    const { invoice_key: _invoiceKey, nota_draft_instruction: _draftInstruction, ...safe } = workflow;
    const checklist = typeof safe.persekot_checklist === "string" ? JSON.parse(safe.persekot_checklist) : safe.persekot_checklist;
    const verified = letter.document_type === INVOICE_INCOMING
      ? await invoiceVerified(db, params.id, safe.invoice_revision, letter.routing_target_user_id) : null;
    const requirements = await paymentDocuments(db, params.id, workflow, letter.document_type);
    const invoiceAccess = requirements?.invoice ? await invoicePaymentAccess(db, letter, workflow, user) : null;
    v11 = { ...safe,
      payment_documents: requirements && { ...requirements, invoiceAccess,
        editable: invoiceAccess?.editable || await canEditPaymentDocuments(db, letter, user) }, persekot_checklist: checklist ?? [], verified,
      verification_status: verified === null ? null : invoiceVerificationStatus(letter.status, verified),
      payment: business?.invoice && letter.document_type === INVOICE_INCOMING
        ? await invoicePaymentSummary(safe.payable_id, business.invoice.total) : null,
    };
  }
  const nota = workflow && letter.direction === "INTERNAL" ? await notaDocument(db, params.id) : null;
  const hasNotaRouting = letter.direction === "INTERNAL" && (workflow || v11Enabled());
  const [notePeople, replyRecipient, replies, replyAuthors, additionalRecipients] = hasNotaRouting ? await Promise.all([
    db.query<RowDataPacket[]>(
      "SELECT id,name,role FROM siap_users WHERE id IN (?,?,?)",
      [notaAuthorId(letter, workflow), workflow?.nota_signature_assistant_user_id ?? null, workflow?.nota_drafter_user_id ?? null],
    ).then(([rows]) => rows),
    notaReplyRecipient(db, user, letter, workflow),
    db.query<RowDataPacket[]>(
      `SELECT l.id,l.subject,l.status,l.sender FROM siap_letters l JOIN siap_v11_letters v ON v.letter_id=l.id
       WHERE l.source_letter_id=? AND v.kind='NOTA_REPLY' AND l.status<>'CANCELLED' AND ${access.clause}
       ORDER BY l.created_at DESC,l.id DESC`, [params.id, ...access.params],
    ).then(([rows]) => rows),
    directorsForNotaReply(db, user, letter, workflow),
    workflow ? listNotaRecipients(db, params.id) : [],
  ]) : [[], null, [], [], []];
  const authorId = hasNotaRouting ? notaAuthorId(letter, workflow) : null;
  const author = notePeople.find(person => person.id === authorId);
  const assistant = notePeople.find(person => person.id === workflow?.nota_signature_assistant_user_id);
  const drafter = notePeople.find(person => person.id === workflow?.nota_drafter_user_id);
  const canSignNota = nota && canUploadNotaSignature(user, letter, workflow);
  return NextResponse.json({ok:true,data:{letter,actions,attachments,business,v11,
    originalId: nota ? nota.source?.id : originalId, approvalId:approval?.id,
    notaDocument: nota && { ...nota, editable: canEditNotaDocument(user, letter, workflow),
      sandbox: canSignNota && sandboxAttachmentsEnabled(), uploadable: canSignNota, requiresProof: requiresNotaProof(workflow),
      canAssignAssistant: isNotaDraft(letter) && authorId === user.id,
      assistant: assistant ? { id: assistant.id, name: assistant.name } : null },
    notaRouting: hasNotaRouting ? { authorId, authorName: author?.name, authorRole: author?.role, additionalRecipients,
      drafter: drafter ? { id: drafter.id, name: drafter.name } : null,
      draftInstruction: user.role === "ROOT_ADMIN" || user.id === authorId || (user.role === "STAFF" && user.id === drafter?.id)
        ? workflow?.nota_draft_instruction ?? null : null,
      isReply: workflow?.kind === "NOTA_REPLY", direct: isDirectNota(workflow), replies, replyAuthors,
      replyRecipient: replyRecipient ? { id: replyRecipient.id, name: replyRecipient.name, unit: replyRecipient.unit_name } : null } : null,
    sandboxSigning: sandboxAttachmentsEnabled() && canHandleSecretariat(user.role) &&
      !(nota && assistant?.id === user.id),
    sourceLetter, sourceDisposition, hasSourceDisposition: Boolean(sourceDispositionId), hasSourceLetter: Boolean(sourceLetterId)}});
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const stored: StoredLetterFile[] = [];
  try {
    const form = request.headers.get("content-type")?.includes("multipart/form-data") ? await request.formData() : null;
    const body = form ? JSON.parse(String(form.get("metadata") || "{}")) : await request.json();
    const spbFile = takeFile(form?.get("spb_file"));
    const result = await withTransaction(async conn => {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM siap_letters WHERE id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE", [params.id]);
      const letter = rows[0];
      if (!letter) return 404;

      const v11 = await v11Letter(params.id, conn);
      const v11Invoice = Boolean(v11 && letter.document_type === INVOICE_INCOMING);
      const beforeInvoice = v11Invoice ? await getBusinessDocumentRow(params.id, conn) : null;
      const business = isBusinessDocument(letter.document_type);
      const managed = business && (isInvoice(letter.document_type) || Boolean(await getBusinessDocumentRow(params.id, conn)));
      const draft = ["DRAFT", "RETURNED_STAFF"].includes(letter.status);
      const owner = letter.created_by === user.id;
      const root = user.role === "ROOT_ADMIN";
      const nota = Boolean(v11 && letter.direction === "INTERNAL");
      const intake = letter.uses_secretariat && letter.direction === "INCOMING" && letter.status === "SECRETARIAT_INTAKE";
      const editable = intake ? owner || canHandleSecretariat(user.role)
        : managed || letter.uses_secretariat || v11 ? draft && (owner || root)
          || (nota && canEditNotaDocument(user, letter, v11))
        : root || (owner && draft);
      if (!editable) return 403;
      if (nota && v11.nota_drafter_user_id && body.nota_draft_instruction !== undefined) {
        if (!root && user.id !== notaAuthorId(letter, v11)) return 403;
        await conn.execute("UPDATE siap_v11_letters SET nota_draft_instruction=? WHERE letter_id=?",
          [str(body.nota_draft_instruction, 5000) || null, params.id]);
      }
      if (spbFile && v11?.kind !== "PERSEKOT") throw new Error("Berkas SPB hanya untuk pengajuan persekot.");

      const reply = v11?.kind === "NOTA_REPLY";
      const fixedParties = isDirectNota(v11) || Boolean(v11?.nota_author_user_id);
      const conf = reply ? "" : str(body.confidentiality, 20).toUpperCase();
      const publicValue = typeof body.is_public === "boolean" ? Number(body.is_public) : null;
      const incoming = (business || intake) && letter.direction === "INCOMING";
      const updateSource = letter.direction === "OUTGOING" && draft && (owner || root)
        && !letter.source_disposition_id && body.source_letter_id !== undefined;
      const source = updateSource ? await outgoingSources(conn, user, str(body.source_letter_id, 36), "") : null;
      const externalNumber = incoming && body.external_number !== undefined
        ? required(body.external_number, "Nomor dokumen asal", 255) : null;
      const receivedDate = incoming && body.received_date !== undefined
        ? (v11 ? checkedDate : dateOnly)(body.received_date, "Tanggal diterima") : null;
      if (v11 && receivedDate && receivedDate > jakartaDate()) throw new Error("Tanggal penerimaan tidak boleh di masa depan.");
      if (v11Invoice && externalNumber && externalNumber.length > 120) throw new Error("Nomor invoice maksimal 120 karakter.");
      const sender = fixedParties ? letter.sender : str(body.sender, 255) || letter.sender;
      const subject = str(body.subject, 500) || letter.subject;
      const summary = body.summary === undefined ? letter.summary : str(body.summary, 5000) || null;
      let recipient = fixedParties ? letter.recipient : str(body.recipient, 255) || letter.recipient;
      const unit = v11?.requesting_unit && body.requesting_unit !== undefined ? requestingUnit(body.requesting_unit) : v11?.requesting_unit;
      let managerId = letter.routing_target_user_id;
      let recipientIds: string[] | undefined;
      let notaRoutingChanged = false;
      if (nota && (body.nota_recipient_ids !== undefined || (!reply && body.routing_target_user_id !== undefined))) {
        const author = await activeNotaAccount(conn, notaAuthorId(letter, v11));
        if (!author) throw new Error("Akun pengirim Nota Dinas tidak aktif.");
        if (!reply && body.routing_target_user_id !== undefined) {
          const target = await notaPrimaryTarget(conn, author.role,
            required(body.routing_target_user_id, "Tujuan Nota Dinas", 36), isDirectNota(v11));
          managerId = target.id;
          recipient = notaPartyLabel(target);
        }
        const previous = (await listNotaRecipients(conn, params.id)).map(person => person.id);
        const selected = await validateNotaRecipients(conn, body.nota_recipient_ids ?? previous, author, managerId, isDirectNota(v11));
        recipientIds = selected.map(person => person.id);
        if (recipientIds.length !== previous.length || recipientIds.some(id => !previous.includes(id))) {
          await saveNotaRecipients(conn, params.id, selected);
          notaRoutingChanged = true;
        }
        notaRoutingChanged ||= managerId !== letter.routing_target_user_id;
      }
      if (v11?.requesting_unit && body.routing_target_user_id !== undefined) {
        managerId = (await officialManager(conn, required(body.routing_target_user_id, "Manager tujuan", 36), unit)).id;
      } else if (v11?.requesting_unit && unit !== v11.requesting_unit) {
        await officialManager(conn, managerId, unit);
      }

      await conn.execute(
        `UPDATE siap_letters SET
         subject=COALESCE(NULLIF(?,''),subject),
         sender=COALESCE(NULLIF(?,''),sender),
         recipient=COALESCE(NULLIF(?,''),recipient),
         external_number=COALESCE(?,external_number),received_date=COALESCE(?,received_date),
         source_letter_id=CASE WHEN ? THEN ? ELSE source_letter_id END,
         summary=?,notes=?,
         confidentiality=COALESCE(NULLIF(?,''),confidentiality),
         is_public=CASE WHEN COALESCE(NULLIF(?,''),confidentiality)='RAHASIA' THEN 0 ELSE COALESCE(?,is_public) END,
         routing_target_user_id=?,updated_by=? WHERE id=?`,
        [subject, sender, recipient, externalNumber, receivedDate,
          Number(updateSource), source?.sourceLetterId ?? null,
          body.summary === undefined ? letter.summary : str(body.summary, 5000) || null,
          body.notes === undefined ? letter.notes : str(body.notes, 5000) || null,
          conf, conf, v11 ? 0 : publicValue, managerId, user.id, params.id],
      );
      await saveBusinessDocument(conn, user, {
        id: params.id, document_type: letter.document_type, direction: letter.direction,
      }, body.business, false);
      if (v11 && letter.direction === "INTERNAL" && (subject !== letter.subject || summary !== letter.summary ||
          sender !== letter.sender || recipient !== letter.recipient || notaRoutingChanged || (conf && conf !== letter.confidentiality))) {
        await saveNotaSource(conn, params.id, null, "GENERATED");
        await conn.execute("UPDATE siap_letters SET active_original_attachment_id=NULL WHERE id=?", [params.id]);
      }
      let revision = v11?.invoice_revision;
      if (v11?.requesting_unit) {
        const receipt = receiptFields({ ...v11, ...body }, false);
        if (v11Invoice) {
          const updated = await getBusinessDocumentRow(params.id, conn);
          checkedDate(updated?.due_date_text, "Jatuh tempo invoice");
          if (sender !== letter.sender || (externalNumber !== null && externalNumber !== letter.external_number) ||
              unit !== v11.requesting_unit || managerId !== letter.routing_target_user_id ||
              subject !== letter.subject || summary !== letter.summary ||
              ["total", "due_date_text", "items", "requires_spk", "invoice_spk_id"].some(key => JSON.stringify(beforeInvoice?.[key]) !== JSON.stringify(updated?.[key]))) {
            revision++;
          }
        }
        await conn.execute(
          `UPDATE siap_v11_letters SET requesting_unit=?,received_time=?,delivery_method=?,delivered_by=?,received_by=?,
            receipt_note=?,invoice_revision=?,invoice_key=? WHERE letter_id=?`,
          [unit, receipt.receivedTime, receipt.method, receipt.deliveredBy, receipt.receivedBy, receipt.note, revision,
            v11Invoice ? invoiceKey(sender, externalNumber || letter.external_number) : null, params.id],
        );
      }
      if (v11?.kind === "PERSEKOT") {
        let spb = v11.spb_attachment_id;
        if (spbFile) {
          const proof = await saveProof(spbFile, true);
          stored.push(proof);
          await markPaymentAttachment(conn, params.id, spb);
          spb = await insertLetterAttachment(conn, params.id, user.id, proof, "PAYMENT_DOCUMENT");
        }
        await conn.execute(
          "UPDATE siap_v11_letters SET persekot_checklist=?,spb_attachment_id=? WHERE letter_id=?",
          [body.persekot_checklist === undefined
            ? (typeof v11.persekot_checklist === "string" ? v11.persekot_checklist : JSON.stringify(v11.persekot_checklist))
            : JSON.stringify(persekotChecklist(body.persekot_checklist)), spb, params.id],
        );
      }
      await auditLog({
        user, action: "LETTER_UPDATE", entityType: "LETTER", entityId: params.id,
        metadata: v11 ? { documentType: letter.document_type, beforeRevision: v11.invoice_revision, invoiceRevision: revision,
          ...(notaRoutingChanged ? { routingTargetId: managerId, notaRecipientIds: recipientIds } : {}) }
          : business ? { documentType: letter.document_type } : null, request,
      }, conn);
      return 200;
    });
    stored.length = 0;
    if (result === 404) return NextResponse.json({ ok: false, error: "Surat tidak ditemukan." }, { status: 404 });
    if (result === 403) return NextResponse.json({ ok: false, error: "Surat tidak dapat diedit pada tahap ini." }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await discardUncommittedFiles(stored);
    const message = (error as { code?: string })?.code === "ER_DUP_ENTRY" && (error as Error).message.includes("invoice_key")
      ? "Invoice dengan vendor dan nomor tersebut sudah tercatat." : error instanceof Error ? error.message : "Update gagal.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
