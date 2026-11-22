import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { canCreateInternal, canCreateOutgoing, canRegisterIncoming } from "@/lib/permissions";
import { dateOnly, required, str } from "@/lib/http";
import { reserveOutgoingNumber } from "@/lib/numbering";
import { INVOICE_INCOMING, SPK_INCOMING, isBusinessDocument } from "@/lib/business-documents";
import { saveBusinessDocument } from "@/lib/business-document-data";
import { getAccessibleLetter, letterAccess } from "@/lib/letter-access";
import { incomingRecipients } from "@/lib/correspondence-settings";
import { activeReviewer, hasActiveSecretariat, outgoingSources } from "@/lib/correspondence-data";
import { canHandleSecretariat, canReceiveDirectorNota, isNotaDirector, NOTA_DIRECTORS,
  REVIEW_ROLES, REVIEW_STATUS } from "@/lib/correspondence-workflow";
import { discardUncommittedFiles, insertLetterAttachment, type StoredLetterFile } from "@/lib/letter-uploads";
import { saveUpload } from "@/lib/upload";
import { generatedNotaFile, saveNotaSource } from "@/lib/nota-document";
import { activeNotaAccount, notaReplyRecipient } from "@/lib/nota-routing";
import { checkedDate, invoiceKey, officialManager, persekotChecklist, receiptFields,
  requestingUnit, saveProof, takeFile, v11Enabled, v11Letter } from "@/lib/v11-data";
import { jakartaDate, staffUnit } from "@/lib/v11-workflow";
import type { SessionUser } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk kembali." }, { status: 401 });
    return await listLetters(request, user);
  } catch (error) {
    console.error("GET /api/letters", error instanceof Error && "code" in error ? error.code : "LIST_FAILED");
    return NextResponse.json({ ok: false, error: "Daftar dokumen belum dapat dimuat. Coba lagi." }, { status: 503 });
  }
}

async function listLetters(request: Request, user: SessionUser) {
  const url = new URL(request.url);
  const direction = url.searchParams.get("direction");
  const status = url.searchParams.get("status");
  const documentType = url.searchParams.get("document_type");
  const year = url.searchParams.get("year");
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const forDisposition = url.searchParams.get("for_disposition") === "1";
  const requestedLimit = Number(url.searchParams.get("limit") || 100);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 2500) : 100;
  const trash = url.searchParams.get("trash") === "1";
  if (trash && user.role !== "ROOT_ADMIN") return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const where:string[] = ["1=1"];
  const params:unknown[] = [];

  const id = url.searchParams.get("id");
  if (id) { where.push("l.id=?"); params.push(id.slice(0, 36)); }
  if (forDisposition) {
    where.push(`(
      (l.direction='OUTGOING' AND l.status='ISSUED')
      OR (l.direction<>'OUTGOING' AND (
        l.status='APPROVED'
        OR (v.letter_id IS NULL AND l.status IN ('DISPOSED','IN_PROGRESS','COMPLETED'))
        OR (
          v.letter_id IS NOT NULL AND l.direction='INCOMING'
          AND l.status IN ('MANAGER_REVIEW','DIRECTOR_OPS_REVIEW','PRESIDENT_DIRECTOR_REVIEW')
          AND (
            l.current_owner_user_id=? OR (? IN ('MANAGER','DIRECTOR_OPS') AND EXISTS (
              SELECT 1 FROM siap_dispositions d WHERE d.letter_id=l.id AND d.to_user_id=? AND d.status='IN_PROGRESS'
            ))
          )
        )
      ))
    )`);
    params.push(user.id, user.role, user.id);
  }
  if (direction) { where.push("l.direction=?"); params.push(direction); }
  if (status === "SENT") where.push("l.status='ISSUED' AND l.sent_date IS NOT NULL");
  else if (status) { where.push("l.status=?"); params.push(status); }
  if (url.searchParams.get("queue") === "secretariat") {
    if (!canHandleSecretariat(user.role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    where.push("l.uses_secretariat=1 AND l.`current_role`='SECRETARIAT'");
  }
  if (documentType) { where.push("l.document_type=?"); params.push(documentType); }
  if (year && /^\d{4}$/.test(year)) { where.push("YEAR(l.letter_date)=?"); params.push(Number(year)); }

  const ledgerNumber = `CASE WHEN nl.seq_base IS NULL THEN NULL
    WHEN nl.variant>0 THEN CONCAT(nl.seq_base,'.',nl.variant)
    ELSE CAST(nl.seq_base AS CHAR) END`;
  const displayNumber = `COALESCE(NULLIF(l.legacy_number_text,''), ${ledgerNumber})`;
  if (q) {
    const columns = ["l.letter_number", "l.external_number", "l.subject", "l.sender", "l.recipient",
      "l.legacy_number_text", "CAST(nl.seq_base AS CHAR)"];
    if (forDisposition) columns.push(`(${ledgerNumber})`);
    where.push(`(${columns.map(column => `${column} LIKE ?`).join(" OR ")})`);
    params.push(...columns.map(() => `%${q}%`));
  }

  const access = trash ? { clause: "l.deleted_at IS NOT NULL", params: [] } : letterAccess(user);
  where.push(access.clause);
  params.push(...access.params);

  const order = ["l.letter_date DESC", "l.created_at DESC"];
  if (forDisposition && q) {
    // Compare each column independently so older number columns can use different collations.
    order.unshift(`CASE WHEN l.letter_number=? OR l.external_number=? OR l.legacy_number_text=?
      OR (NULLIF(l.legacy_number_text,'') IS NULL AND (${ledgerNumber})=?) THEN 0 ELSE 1 END`);
    params.push(q, q, q, q);
  }
  params.push(limit);
  const [rows] = await db.query<RowDataPacket[]>(
      `SELECT l.*, v.kind AS v11_kind,v.requesting_unit AS v11_unit,
      u.name AS creator_name,
      uo.name AS current_owner_name,
      uo.unit_name AS current_owner_unit,
      rt.name AS routing_target_name,
      rt.unit_name AS routing_target_unit,
      nf.name AS format_name,
      nf.code AS format_code,
      nl.seq_base,
      nl.variant,
      ${displayNumber} AS display_number,
      (SELECT COUNT(*) FROM siap_attachments a WHERE a.letter_id=l.id AND a.disposition_id IS NULL) AS attachment_count
     FROM siap_letters l
     JOIN siap_users u ON u.id=l.created_by
     LEFT JOIN siap_v11_letters v ON v.letter_id=l.id
     LEFT JOIN siap_users uo ON uo.id=l.current_owner_user_id
     LEFT JOIN siap_users rt ON rt.id=l.routing_target_user_id
     LEFT JOIN siap_number_formats nf ON nf.id=l.number_format_id
     LEFT JOIN siap_number_ledger nl ON nl.letter_id=l.id
     WHERE ${where.join(" AND ")}
     ORDER BY ${order.join(", ")}
     LIMIT ?`,
    params
  );

  const data = rows.map(({ source_letter_id, source_disposition_id, approval_snapshot, deleted_by,
    deletion_reason, active_original_attachment_id, ...letter }) =>
    trash ? { ...letter, deletion_reason } : letter);
  return NextResponse.json({ ok:true,data });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const stored: StoredLetterFile[] = [];
  try {
    const multipart = request.headers.get("content-type")?.includes("multipart/form-data");
    const form = multipart ? await request.formData() : null;
    const body = form ? JSON.parse(String(form.get("metadata") || "{}")) : await request.json();
    const file = takeFile(form?.get("original_file"));
    const receiptProof = takeFile(form?.get("receipt_file"));
    const spbFile = takeFile(form?.get("spb_file"));
    const v11 = v11Enabled();
    const direction = required(body.direction, "Arah dokumen", 20).toUpperCase();
    if (!["INCOMING", "OUTGOING", "INTERNAL"].includes(direction)) throw new Error("Arah dokumen tidak valid.");

    const hasSecretariat = direction !== "INTERNAL" && await hasActiveSecretariat();
    if (v11 && direction !== "INTERNAL" && !hasSecretariat) {
      throw new Error("Aktifkan akun Sekretariat sebelum menerima atau membuat surat V11.");
    }
    const usesSecretariat = hasSecretariat;
    if (direction === "INCOMING" && !canRegisterIncoming(user.role) &&
        !(usesSecretariat && REVIEW_ROLES.some(role => role === user.role))) {
      return NextResponse.json({ ok: false, error: "Akun ini tidak dapat menyerahkan Surat Masuk." }, { status: 403 });
    }
    const needsRegistration = direction === "INCOMING" && usesSecretariat && (v11 || !canHandleSecretariat(user.role));
    const assignedFinance = user.role === "FINANCE" && Boolean(str(body.source_disposition_id, 36));
    if (direction === "OUTGOING" && !canCreateOutgoing(user.role) && !assignedFinance) {
      return NextResponse.json({ ok: false, error: "Surat keluar disusun oleh Staff Administrasi atau Root Admin." }, { status: 403 });
    }
    if (direction === "INTERNAL" && !canCreateInternal(user.role)) {
      return NextResponse.json({ ok: false, error: "Role ini tidak diizinkan membuat Nota Dinas." }, { status: 403 });
    }

    const documentType = required(body.document_type, "Jenis dokumen", 80);
    const business = isBusinessDocument(documentType);
    const businessDirection = documentType === SPK_INCOMING || documentType === INVOICE_INCOMING ? "INCOMING" : "OUTGOING";
    if (business && direction !== businessDirection) throw new Error("Jenis dokumen tidak sesuai dengan arahnya.");
    let requiresSecretariatReview = false;
    if (direction === "OUTGOING" || business) {
      const [types] = await db.query<RowDataPacket[]>(
        "SELECT id,secretariat_review_required FROM siap_document_types WHERE code=? AND direction=? AND is_active=1 LIMIT 1",
        [documentType, direction],
      );
      if (!types[0]) throw new Error("Jenis dokumen tidak ditemukan atau tidak aktif.");
      requiresSecretariatReview = direction === "OUTGOING" && usesSecretariat && !v11 && Boolean(types[0].secretariat_review_required);
    }
    if (direction === "INTERNAL" && documentType !== "NOTA_DINAS") {
      throw new Error("Dokumen internal Staff ke atasan harus Nota Dinas.");
    }
    if ((business || v11) && direction === "INCOMING" && !file) {
      throw new Error("Unggah dokumen asli untuk menyerahkan Surat Masuk.");
    }
    const persekot = body.persekot === true;
    const paymentRequest = body.payment_request === true;
    if ((persekot || paymentRequest) && (!v11 || direction !== "INTERNAL" || (persekot && paymentRequest))) {
      throw new Error("Pilih satu jenis pengajuan pembayaran yang sesuai pada Nota Dinas V11.");
    }
    if (spbFile && !persekot) throw new Error("Berkas SPB hanya diperuntukkan bagi pengajuan persekot.");
    if (receiptProof && (!v11 || direction !== "INCOMING")) throw new Error("Bukti penerimaan hanya untuk Surat Masuk V11.");

    const nota = v11 && direction === "INTERNAL";
    const replyId = str(body.nota_reply_to_id, 36);
    const delegatedAuthorId = str(body.nota_author_user_id, 36);
    if (delegatedAuthorId && (!nota || user.role !== "STAFF")) {
      throw new Error("Draf untuk atasan dibuat oleh Staff melalui Nota Dinas.");
    }
    if (replyId && (!nota || persekot || paymentRequest)) {
      throw new Error("Balasan harus berupa Nota Dinas biasa dari Direktur.");
    }
    const id = crypto.randomUUID();
    const subject = required(body.subject, "Perihal", 500);
    const letterDate = dateOnly(body.letter_date, "Tanggal dokumen");
    const targetId = replyId ? "" : required(body.routing_target_user_id, "Tujuan review", 36);
    const unit = v11 && direction === "INCOMING" ? requestingUnit(body.requesting_unit) : null;
    const receipt = unit ? receiptFields(body, false) : null;
    const today = v11 ? jakartaDate() : new Date().toISOString().slice(0, 10);
    const isBackdated = letterDate < today;
    const summary = str(body.summary, 5000) || null;
    const notes = str(body.notes, 5000) || null;
    const conf = String(body.confidentiality || "").toUpperCase();
    const externalNumber = direction === "INCOMING" ? required(body.external_number, "Nomor dokumen asal", 255) : null;
    const addressedTo = direction === "OUTGOING" ? required(body.recipient, "Tujuan dokumen", 255)
      : direction === "INCOMING" ? str(body.recipient, 255) || (await incomingRecipients()).defaultRecipient : null;
    const receivedDate = direction === "INCOMING"
      ? (v11 ? checkedDate : dateOnly)(body.received_date || today, "Tanggal diterima") : null;
    if (v11 && receivedDate && receivedDate > today) throw new Error("Tanggal penerimaan tidak boleh di masa depan.");
    if (v11 && documentType === INVOICE_INCOMING) {
      if (externalNumber!.length > 120) throw new Error("Nomor invoice masuk maksimal 120 karakter.");
      checkedDate(body.business?.due_date, "Jatuh tempo invoice");
    }
    const formatId = direction === "OUTGOING" ? required(body.number_format_id, "Format nomor", 36) : null;
    const issuedDate = direction === "OUTGOING" && body.issued_date ? dateOnly(body.issued_date, "Tanggal terbit") : null;
    const customBase = direction === "OUTGOING" && body.custom_number_base != null && String(body.custom_number_base).trim() !== ""
      ? Number(body.custom_number_base) : null;
    if (customBase !== null && (!Number.isInteger(customBase) || customBase < 1)) {
      throw new Error("Nomor dasar custom harus angka bulat minimal 1.");
    }

    const generateNota = nota && body.nota_document_source === "GENERATED";
    if (generateNota && file) throw new Error("Pilih buat PDF dari SIAP atau unggah satu PDF sendiri.");
    if (nota && body.nota_document_source === "UPLOAD" && !file) throw new Error("Unggah PDF Nota Dinas.");
    const data = await withTransaction(async conn => {
      // Serialize reservations before any consistent reads or FK locks in this transaction.
      if (formatId) await conn.query("SELECT id FROM siap_number_formats WHERE id=? FOR UPDATE", [formatId]);
      const delegate = delegatedAuthorId ? await activeNotaAccount(conn, delegatedAuthorId) : null;
      if (delegatedAuthorId && (!delegate || (!isNotaDirector(delegate.role) && delegate.role !== "MANAGER"))) {
        throw new Error("Pilih akun Manager atau Direktur yang aktif.");
      }
      const author = delegate ?? user;
      const directorNota = nota && isNotaDirector(author.role) && !persekot && !paymentRequest;
      if (delegate && isNotaDirector(author.role) && !directorNota) {
        throw new Error("Draf untuk Direktur tersedia untuk Nota Dinas biasa dan balasan.");
      }
      const managerNota = nota && author.role === "MANAGER";
      if (managerNota) await officialManager(conn, author.id, delegate ? staffUnit(user.unit_name) : null);
      const origin = replyId ? await getAccessibleLetter(user, replyId, conn, true) : null;
      const repliedTo = origin ? await notaReplyRecipient(conn, author, origin, await v11Letter(replyId, conn)) : null;
      if (replyId && !repliedTo) throw new Error("Nota Dinas asal atau pengirimnya tidak dapat menerima balasan dari akun ini.");
      const target = repliedTo ?? (directorNota ? await activeNotaAccount(conn, targetId)
        : v11 && !managerNota ? await officialManager(conn, targetId, unit)
        : await activeReviewer(conn, targetId, managerNota ? [...NOTA_DIRECTORS]
          : direction === "INCOMING" && usesSecretariat ? REVIEW_ROLES : ["MANAGER"]));
      if (!target || (directorNota && !replyId && !canReceiveDirectorNota(author.role, target.role))) {
        throw new Error("Pilih penerima Nota Dinas Direksi yang aktif.");
      }
      const targetLabel = [target.name, target.unit_name].filter(Boolean).join(" — ");
      const recipient = addressedTo ?? targetLabel;
      const sender = direction === "INCOMING" ? required(body.sender, "Asal/pengirim", 255)
        : direction === "INTERNAL" ? delegatedAuthorId || replyId ? author.name : user.unit_name || user.name : null;
      const severity = ["BIASA", "PENTING", "RAHASIA"];
      const confidentiality = severity[Math.max(0, severity.indexOf(conf), severity.indexOf(origin?.confidentiality))];
      const isPublic = v11 || confidentiality === "RAHASIA" ? 0
        : direction === "INTERNAL" || business ? Number(body.is_public === true)
        : Number(body.is_public !== false);
      const status = needsRegistration ? "SECRETARIAT_INTAKE"
        : direction === "INCOMING" ? REVIEW_STATUS[target.role as keyof typeof REVIEW_STATUS] : "DRAFT";
      const role = needsRegistration ? "SECRETARIAT" : direction === "INCOMING" ? target.role : author.role;
      const original = generateNota ? await generatedNotaFile({
        id, date: letterDate, author: author.name, unit: author.unit_name, recipient, subject,
        summary: required(summary, "Isi Nota Dinas", 5000), confidentiality, reference: origin?.subject,
      }) : file ? await (nota ? saveProof(file, true, "ORIGINAL") : saveUpload(file, "ORIGINAL")) : null;
      if (original) stored.push(original);
      const { sourceLetterId, sourceDispositionId } = direction === "OUTGOING"
        ? await outgoingSources(conn, user, str(body.source_letter_id, 36), str(body.source_disposition_id, 36))
        : { sourceLetterId: origin?.id ?? null, sourceDispositionId: null };
      await conn.execute(
        `INSERT INTO siap_letters
         (id,direction,document_type,number_format_id,external_number,subject,sender,recipient,
          letter_date,received_date,issued_date,confidentiality,summary,notes,status,\`current_role\`,
          current_owner_user_id,routing_target_user_id,is_public,is_backdated,created_by,updated_by,
          uses_secretariat,secretariat_review_required,source_letter_id,source_disposition_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, direction, documentType, formatId, externalNumber, subject, sender, recipient, letterDate,
          receivedDate, issuedDate, confidentiality, summary, notes, status, role,
          needsRegistration ? null : direction === "INCOMING" ? target.id : direction === "OUTGOING" || business || v11 ? author.id : null,
          target.id, isPublic, isBackdated, user.id, user.id, Number(usesSecretariat),
          Number(requiresSecretariatReview), sourceLetterId, sourceDispositionId],
      );

      let number: string | null = null;
      if (formatId) {
        const reserved = await reserveOutgoingNumber({
          conn, formatId, letterId: id, letterDate, userId: user.id, documentType, requestedSeqBase: customBase,
        });
        number = reserved.rendered;
        await conn.execute("UPDATE siap_letters SET letter_number=? WHERE id=?", [number, id]);
      }
      await saveBusinessDocument(conn, user, { id, document_type: documentType, direction }, body.business, true);
      if (original) {
        const originalId = await insertLetterAttachment(conn, id, user.id, original, "ORIGINAL");
        await conn.execute("UPDATE siap_letters SET active_original_attachment_id=? WHERE id=?", [originalId, id]);
        if (nota) await saveNotaSource(conn, id, originalId, generateNota ? "GENERATED" : "UPLOAD");
      }

      if (v11) {
        const extra = async (proof: File | null, kind: "ADDITIONAL" | "PAYMENT_DOCUMENT") => {
          if (!proof) return null;
          const saved = await saveProof(proof, kind === "PAYMENT_DOCUMENT");
          stored.push(saved);
          return insertLetterAttachment(conn, id, user.id, saved, kind);
        };
        const receiptId = await extra(receiptProof, "ADDITIONAL");
        const spbId = await extra(spbFile, "PAYMENT_DOCUMENT");
        await conn.execute(
          `INSERT INTO siap_v11_letters
           (letter_id,kind,requesting_unit,received_time,delivery_method,delivered_by,received_by,
            receipt_note,receipt_attachment_id,invoice_key,persekot_checklist,spb_attachment_id,nota_author_user_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, replyId ? "NOTA_REPLY" : directorNota ? "NOTA_DIRECT" : persekot ? "PERSEKOT"
            : paymentRequest ? "PAYMENT_REQUEST" : "CORRESPONDENCE",
            unit, receipt?.receivedTime ?? null,
            receipt?.method ?? null, receipt?.deliveredBy ?? null, receipt?.receivedBy ?? null,
            receipt?.note ?? null, receiptId, documentType === INVOICE_INCOMING ? invoiceKey(sender!, externalNumber!) : null,
            persekot ? JSON.stringify(persekotChecklist(body.persekot_checklist)) : null, spbId, delegatedAuthorId || null],
        );
      }

      const action = needsRegistration ? "RECEIVE_INCOMING"
        : direction === "INCOMING" ? "REGISTER_INCOMING" : direction === "INTERNAL" ? "CREATE_INTERNAL" : "CREATE_OUTGOING";
      const comment = [
        number ? "Nomor direservasi: " + number : null,
        (replyId ? "Penerima balasan: " : directorNota ? "Penerima nota: " : "Tujuan review: ") + targetLabel,
        delegatedAuthorId ? "Disiapkan untuk " + author.name : null,
        direction !== "OUTGOING" ? notes : null,
      ].filter(Boolean).join(" • ");
      await conn.execute(
        `INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment)
         VALUES (?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), id, user.id, action, null, status, comment],
      );
      await auditLog({
        user, action: "LETTER_CREATE", entityType: "LETTER", entityId: id,
        metadata: { direction, documentType, subject, routingTargetId: target.id, isBackdated,
          customNumberBase: customBase, usesSecretariat, sourceLetterId, sourceDispositionId, workflowV11: v11,
          requestingUnit: unit, notaAuthorUserId: delegatedAuthorId || null },
        request,
      }, conn);
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM siap_letters WHERE id=? LIMIT 1", [id]);
      return rows[0];
    });
    stored.length = 0;
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) {
    await discardUncommittedFiles(stored);
    return NextResponse.json({
      ok: false, error: (error as { code?: string })?.code === "ER_DUP_ENTRY" && (error as Error).message.includes("invoice_key")
        ? "Invoice dengan vendor dan nomor tersebut sudah tercatat."
        : error instanceof Error ? error.message : "Gagal membuat dokumen.",
    }, { status: 400 });
  }
}
