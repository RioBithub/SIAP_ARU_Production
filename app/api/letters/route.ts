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
import { letterAccess } from "@/lib/letter-access";
import { discardUncommittedFiles, insertLetterAttachment, type StoredLetterFile } from "@/lib/letter-uploads";
import { saveUpload } from "@/lib/upload";

export const runtime = "nodejs";

async function getManagerTarget(value:unknown){
  const targetId=required(value,"Manager tujuan",36);
  const [rows]=await db.query<RowDataPacket[]>(
    `SELECT id,name,email,role,unit_name
     FROM siap_users
     WHERE id=? AND is_active=1 AND role='MANAGER'
     LIMIT 1`,
    [targetId]
  );
  const target=rows[0];
  if(!target) throw new Error("Manager tujuan tidak ditemukan atau tidak aktif.");
  return target;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok:false,error:"Unauthorized" },{status:401});

  const url = new URL(request.url);
  const direction = url.searchParams.get("direction");
  const status = url.searchParams.get("status");
  const documentType = url.searchParams.get("document_type");
  const year = url.searchParams.get("year");
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100),1),2500);

  const where:string[] = ["1=1"];
  const params:unknown[] = [];

  if (direction) { where.push("l.direction=?"); params.push(direction); }
  if (status) { where.push("l.status=?"); params.push(status); }
  if (documentType) { where.push("l.document_type=?"); params.push(documentType); }
  if (year && /^\d{4}$/.test(year)) { where.push("YEAR(l.letter_date)=?"); params.push(Number(year)); }

  if (q) {
    where.push("(l.letter_number LIKE ? OR l.external_number LIKE ? OR l.subject LIKE ? OR l.sender LIKE ? OR l.recipient LIKE ?)");
    const like = `%${q.slice(0,100)}%`;
    params.push(like,like,like,like,like);
  }

  const access = letterAccess(user);
  where.push(access.clause);
  params.push(...access.params);

  params.push(limit);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT l.*,
      u.name AS creator_name,
      uo.name AS current_owner_name,
      uo.unit_name AS current_owner_unit,
      rt.name AS routing_target_name,
      rt.unit_name AS routing_target_unit,
      nf.name AS format_name,
      nf.code AS format_code,
      nl.seq_base,
      nl.variant,
      COALESCE(NULLIF(l.legacy_number_text,''),
        CASE WHEN nl.seq_base IS NULL THEN NULL
             WHEN nl.variant>0 THEN CONCAT(nl.seq_base,'.',nl.variant)
             ELSE CAST(nl.seq_base AS CHAR) END) AS display_number,
      (SELECT COUNT(*) FROM siap_attachments a WHERE a.letter_id=l.id) AS attachment_count
     FROM siap_letters l
     JOIN siap_users u ON u.id=l.created_by
     LEFT JOIN siap_users uo ON uo.id=l.current_owner_user_id
     LEFT JOIN siap_users rt ON rt.id=l.routing_target_user_id
     LEFT JOIN siap_number_formats nf ON nf.id=l.number_format_id
     LEFT JOIN siap_number_ledger nl ON nl.letter_id=l.id
     WHERE ${where.join(" AND ")}
     ORDER BY l.letter_date DESC, l.created_at DESC
     LIMIT ?`,
    params
  );

  return NextResponse.json({ ok:true,data:rows });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let original: StoredLetterFile | null = null;
  try {
    const multipart = request.headers.get("content-type")?.includes("multipart/form-data");
    const form = multipart ? await request.formData() : null;
    const body = form ? JSON.parse(String(form.get("metadata") || "{}")) : await request.json();
    const file = form?.get("original_file");
    const direction = required(body.direction, "Arah dokumen", 20).toUpperCase();
    if (!["INCOMING", "OUTGOING", "INTERNAL"].includes(direction)) throw new Error("Arah dokumen tidak valid.");

    if (direction === "INCOMING" && !canRegisterIncoming(user.role)) {
      return NextResponse.json({ ok: false, error: "Hanya Staff atau Root Admin yang dapat meregistrasi surat masuk." }, { status: 403 });
    }
    if (direction === "OUTGOING" && !canCreateOutgoing(user.role)) {
      return NextResponse.json({ ok: false, error: "Surat keluar disusun oleh Staff Administrasi atau Root Admin." }, { status: 403 });
    }
    if (direction === "INTERNAL" && !canCreateInternal(user.role)) {
      return NextResponse.json({ ok: false, error: "Role ini tidak diizinkan membuat Nota Dinas." }, { status: 403 });
    }

    const documentType = required(body.document_type, "Jenis dokumen", 80);
    const business = isBusinessDocument(documentType);
    const businessDirection = documentType === SPK_INCOMING || documentType === INVOICE_INCOMING ? "INCOMING" : "OUTGOING";
    if (business && direction !== businessDirection) throw new Error("Jenis dokumen tidak sesuai dengan arahnya.");
    if (direction === "OUTGOING" || business) {
      const [types] = await db.query<RowDataPacket[]>(
        "SELECT id FROM siap_document_types WHERE code=? AND direction=? AND is_active=1 LIMIT 1",
        [documentType, direction],
      );
      if (!types[0]) throw new Error("Jenis dokumen tidak ditemukan atau tidak aktif.");
    }
    if (direction === "INTERNAL" && documentType !== "NOTA_DINAS") {
      throw new Error("Dokumen internal Staff ke atasan harus Nota Dinas.");
    }
    if (business && direction === "INCOMING" && (!file || typeof file === "string" || file.size === 0)) {
      throw new Error("Unggah dokumen asli untuk meregistrasi SPK atau invoice masuk.");
    }

    const id = crypto.randomUUID();
    const subject = required(body.subject, "Perihal", 500);
    const letterDate = dateOnly(body.letter_date, "Tanggal dokumen");
    const manager = await getManagerTarget(body.routing_target_user_id);
    const managerLabel = [manager.name, manager.unit_name].filter(Boolean).join(" — ");
    const today = new Date().toISOString().slice(0, 10);
    const isBackdated = letterDate < today;
    const summary = str(body.summary, 5000) || null;
    const notes = str(body.notes, 5000) || null;
    const conf = String(body.confidentiality || "").toUpperCase();
    const confidentiality = ["BIASA", "PENTING", "RAHASIA"].includes(conf) ? conf : "BIASA";
    const isPublic = confidentiality === "RAHASIA" ? 0
      : direction === "INTERNAL" || business ? Number(body.is_public === true)
      : Number(body.is_public !== false);
    const status = direction === "INCOMING" ? "MANAGER_REVIEW" : "DRAFT";
    const role = direction === "INCOMING" ? "MANAGER" : direction === "OUTGOING" ? "STAFF" : user.role;

    const externalNumber = direction === "INCOMING" ? required(body.external_number, "Nomor dokumen asal", 255) : null;
    const sender = direction === "INCOMING" ? required(body.sender, "Asal/pengirim", 255)
      : direction === "INTERNAL" ? user.unit_name || user.name : null;
    const recipient = direction === "OUTGOING" ? required(body.recipient, "Tujuan dokumen", 255)
      : direction === "INTERNAL" ? managerLabel : null;
    const receivedDate = direction === "INCOMING" ? dateOnly(body.received_date || today, "Tanggal diterima") : null;
    const formatId = direction === "OUTGOING" ? required(body.number_format_id, "Format nomor", 36) : null;
    const issuedDate = direction === "OUTGOING" && body.issued_date ? dateOnly(body.issued_date, "Tanggal terbit") : null;
    const customBase = direction === "OUTGOING" && body.custom_number_base != null && String(body.custom_number_base).trim() !== ""
      ? Number(body.custom_number_base) : null;
    if (customBase !== null && (!Number.isInteger(customBase) || customBase < 1)) {
      throw new Error("Nomor dasar custom harus angka bulat minimal 1.");
    }

    if (file && typeof file !== "string" && file.size > 0) original = await saveUpload(file, "ORIGINAL");
    const data = await withTransaction(async conn => {
      await conn.execute(
        `INSERT INTO siap_letters
         (id,direction,document_type,number_format_id,external_number,subject,sender,recipient,
          letter_date,received_date,issued_date,confidentiality,summary,notes,status,\`current_role\`,
          current_owner_user_id,routing_target_user_id,is_public,is_backdated,created_by,updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, direction, documentType, formatId, externalNumber, subject, sender, recipient, letterDate,
          receivedDate, issuedDate, confidentiality, summary, notes, status, role,
          direction === "INCOMING" ? manager.id : business ? user.id : null, manager.id, isPublic, isBackdated, user.id, user.id],
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
      if (original) await insertLetterAttachment(conn, id, user.id, original, "ORIGINAL");

      const action = direction === "INCOMING" ? "REGISTER_INCOMING" : direction === "INTERNAL" ? "CREATE_INTERNAL" : "CREATE_OUTGOING";
      const comment = [
        number ? "Nomor direservasi: " + number : null,
        "Manager tujuan: " + managerLabel,
        direction !== "OUTGOING" ? notes : null,
      ].filter(Boolean).join(" • ");
      await conn.execute(
        `INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment)
         VALUES (?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), id, user.id, action, null, status, comment],
      );
      await auditLog({
        userId: user.id, action: "LETTER_CREATE", entityType: "LETTER", entityId: id,
        metadata: { direction, documentType, subject, managerTargetId: String(manager.id), isBackdated, customNumberBase: customBase },
        request,
      }, conn);
      const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM siap_letters WHERE id=? LIMIT 1", [id]);
      return rows[0];
    });
    original = null;
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) {
    if (original) await discardUncommittedFiles([original]);
    return NextResponse.json({
      ok: false, error: error instanceof Error ? error.message : "Gagal membuat dokumen.",
    }, { status: 400 });
  }
}
