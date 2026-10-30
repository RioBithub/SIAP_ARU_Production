import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import {
  canCreateInternal,
  canCreateOutgoing,
  canRegisterIncoming,
} from "@/lib/permissions";
import { dateOnly, required, str } from "@/lib/http";
import { reserveOutgoingNumber } from "@/lib/numbering";
import { initialLetterReview } from "@/lib/workflow-policy";
import { letterAccessPredicate } from "@/lib/letter-access";
import { deleteStoredFile, saveUpload } from "@/lib/upload";
import { assertDocumentUploads } from "@/lib/upload-policy";

export const runtime = "nodejs";

async function getManagerTarget(value: unknown) {
  const targetId = required(value, "Manager tujuan", 36);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id,name,email,role,unit_name
     FROM siap_users
     WHERE id=? AND is_active=1 AND role='MANAGER'
     LIMIT 1`,
    [targetId],
  );
  const target = rows[0];
  if (!target)
    throw new Error("Manager tujuan tidak ditemukan atau tidak aktif.");
  return target;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );

  const url = new URL(request.url);
  const direction = url.searchParams.get("direction");
  const status = url.searchParams.get("status");
  const documentType = url.searchParams.get("document_type");
  const year = url.searchParams.get("year");
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") || 100), 1),
    2500,
  );

  const where: string[] = ["1=1"];
  const params: unknown[] = [];

  if (direction) {
    where.push("l.direction=?");
    params.push(direction);
  }
  if (status) {
    where.push("l.status=?");
    params.push(status);
  }
  if (documentType) {
    where.push("l.document_type=?");
    params.push(documentType);
  }
  if (year && /^\d{4}$/.test(year)) {
    where.push("YEAR(l.letter_date)=?");
    params.push(Number(year));
  }

  if (q) {
    where.push(
      "(l.letter_number LIKE ? OR l.external_number LIKE ? OR l.subject LIKE ? OR l.sender LIKE ? OR l.recipient LIKE ?)",
    );
    const like = `%${q.slice(0, 100)}%`;
    params.push(like, like, like, like, like);
  }

  const access = letterAccessPredicate(user);
  where.push(access.sql);
  params.push(...access.params);
  const view = url.searchParams.get("view");
  if (view === "attention") {
    where.push(
      "l.status IN ('FINANCE_REVIEW','MANAGER_REVIEW','DIRECTOR_OPS_REVIEW','PRESIDENT_DIRECTOR_REVIEW')",
    );
    if (user.role !== "ROOT_ADMIN") {
      where.push(
        "(l.current_owner_user_id=? OR (l.current_owner_user_id IS NULL AND l.`current_role`=?))",
      );
      params.push(user.id, user.role);
    }
  } else if (view === "awareness") {
    where.push(
      "l.direction='INCOMING' AND l.status<>'CANCELLED' AND NOT EXISTS(SELECT 1 FROM siap_letter_reads r WHERE r.letter_id=l.id AND r.user_id=?)",
    );
    params.push(user.id);
  }

  params.push(limit);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT l.*,
      EXISTS(SELECT 1 FROM siap_letter_reads rr WHERE rr.letter_id=l.id AND rr.user_id=?) AS is_read_by_me,
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
      (SELECT COUNT(*) FROM siap_attachments a WHERE a.letter_id=l.id AND a.disposition_id IS NULL) AS attachment_count
     FROM siap_letters l
     JOIN siap_users u ON u.id=l.created_by
     LEFT JOIN siap_users uo ON uo.id=l.current_owner_user_id
     LEFT JOIN siap_users rt ON rt.id=l.routing_target_user_id
     LEFT JOIN siap_number_formats nf ON nf.id=l.number_format_id
     LEFT JOIN siap_number_ledger nl ON nl.letter_id=l.id
     WHERE ${where.join(" AND ")}
     ORDER BY l.letter_date DESC, l.created_at DESC
     LIMIT ?`,
    [user.id, ...params],
  );

  return NextResponse.json({ ok: true, data: rows });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );

  const saved: Array<
    Awaited<ReturnType<typeof saveUpload>> & { id: string; kind: string }
  > = [];
  let committed = false;
  try {
    let body: any;
    let original: File | null = null;
    let additional: File[] = [];
    if (
      (request.headers.get("content-type") || "").includes(
        "multipart/form-data",
      )
    ) {
      const form = await request.formData();
      body = Object.fromEntries(form.entries());
      body.is_public = ["on", "true"].includes(String(form.get("is_public")));
      const main = form.get("original_file");
      original = main instanceof File && main.size > 0 ? main : null;
      additional = form
        .getAll("additional_files")
        .filter((f): f is File => f instanceof File && f.size > 0);
    } else body = await request.json();
    assertDocumentUploads(original, additional);
    const direction = required(
      body.direction,
      "Arah dokumen",
      20,
    ).toUpperCase();

    if (!["INCOMING", "OUTGOING", "INTERNAL"].includes(direction))
      throw new Error("Arah dokumen tidak valid.");

    if (direction === "INCOMING" && !canRegisterIncoming(user.role))
      return NextResponse.json(
        {
          ok: false,
          error:
            "Hanya Staff atau Root Admin yang dapat meregistrasi surat masuk.",
        },
        { status: 403 },
      );

    if (direction === "OUTGOING" && !canCreateOutgoing(user.role))
      return NextResponse.json(
        {
          ok: false,
          error:
            "Surat keluar disusun oleh Staff Administrasi. Root Admin tetap dapat membuatnya sebagai superuser.",
        },
        { status: 403 },
      );

    if (direction === "INTERNAL" && !canCreateInternal(user.role))
      return NextResponse.json(
        { ok: false, error: "Role ini tidak diizinkan membuat Nota Dinas." },
        { status: 403 },
      );

    const id = crypto.randomUUID();
    const documentType = required(body.document_type, "Jenis dokumen", 80);
    if (direction === "OUTGOING") {
      const [typeRows] = await db.query<RowDataPacket[]>(
        "SELECT id FROM siap_document_types WHERE code=? AND direction='OUTGOING' AND is_active=1 LIMIT 1",
        [documentType],
      );
      if (!typeRows[0])
        throw new Error("Jenis surat keluar tidak ditemukan / tidak aktif.");
    }
    const subject = required(body.subject, "Perihal", 500);
    const letterDate = dateOnly(body.letter_date, "Tanggal dokumen");
    const manager = await getManagerTarget(body.routing_target_user_id);
    const financeReviewerId = str(body.finance_reviewer_user_id, 36) || null;
    if (financeReviewerId) {
      if (
        direction === "OUTGOING" ||
        !["ROOT_ADMIN", "STAFF"].includes(user.role)
      )
        throw new Error(
          "Review awal Finance tersedia untuk Surat Masuk atau Nota Dinas dari Staff.",
        );
      const [financeUsers] = await db.query<RowDataPacket[]>(
        "SELECT id FROM siap_users WHERE id=? AND role='FINANCE' AND is_active=1",
        [financeReviewerId],
      );
      if (!financeUsers[0] || financeReviewerId === user.id)
        throw new Error(
          "Pilih Finance reviewer aktif yang berbeda dari penyusun.",
        );
    }
    const firstReview = initialLetterReview({
      direction,
      created_by: user.id,
      routing_target_user_id: String(manager.id),
      finance_reviewer_user_id: financeReviewerId,
    });

    const confidentiality = ["BIASA", "PENTING", "RAHASIA"].includes(
      String(body.confidentiality || "").toUpperCase(),
    )
      ? String(body.confidentiality).toUpperCase()
      : "BIASA";

    const today = new Date().toISOString().slice(0, 10);
    const isBackdated = letterDate < today ? 1 : 0;
    const requestedPublic = body.is_public === true;
    const isPublic =
      confidentiality === "RAHASIA"
        ? 0
        : direction === "OUTGOING"
          ? body.is_public === false
            ? 0
            : 1
          : requestedPublic
            ? 1
            : 0;

    await withTransaction(async (conn) => {
      if (direction === "INCOMING") {
        const externalNumber = required(
          body.external_number,
          "Nomor surat asal",
          255,
        );
        const sender = required(body.sender, "Asal/pengirim", 255);
        const receivedDate = dateOnly(
          body.received_date || today,
          "Tanggal diterima",
        );

        await conn.execute(
          `INSERT INTO siap_letters
         (id,direction,document_type,external_number,subject,sender,letter_date,received_date,
          confidentiality,summary,notes,status,\`current_role\`,current_owner_user_id,
          routing_target_user_id,finance_reviewer_user_id,is_public,is_backdated,created_by,updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id,
            "INCOMING",
            documentType,
            externalNumber,
            subject,
            sender,
            letterDate,
            receivedDate,
            confidentiality,
            str(body.summary, 5000) || null,
            str(body.notes, 5000) || null,
            firstReview.status,
            firstReview.role,
            firstReview.userId,
            String(manager.id),
            financeReviewerId,
            isPublic,
            isBackdated,
            user.id,
            user.id,
          ],
        );

        await conn.execute(
          `INSERT INTO siap_letter_actions
         (id,letter_id,actor_user_id,action,from_status,to_status,comment)
         VALUES (?,?,?,?,?,?,?)`,
          [
            crypto.randomUUID(),
            id,
            user.id,
            "REGISTER_INCOMING",
            null,
            firstReview.status,
            `Manager tujuan: ${manager.name}${manager.unit_name ? ` — ${manager.unit_name}` : ""}${body.notes ? ` • ${str(body.notes, 5000)}` : ""}`,
          ],
        );
      } else if (direction === "INTERNAL") {
        if (documentType !== "NOTA_DINAS")
          throw new Error("Dokumen internal Staff ke atasan harus Nota Dinas.");

        const recipient = `${manager.name}${manager.unit_name ? ` — ${manager.unit_name}` : ""}`;
        const sender = user.unit_name || user.name;

        await conn.execute(
          `INSERT INTO siap_letters
         (id,direction,document_type,subject,sender,recipient,letter_date,confidentiality,
          summary,notes,status,\`current_role\`,routing_target_user_id,finance_reviewer_user_id,is_public,is_backdated,
          created_by,updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id,
            "INTERNAL",
            documentType,
            subject,
            sender,
            recipient,
            letterDate,
            confidentiality,
            str(body.summary, 5000) || null,
            str(body.notes, 5000) || null,
            "DRAFT",
            user.role,
            String(manager.id),
            financeReviewerId,
            isPublic,
            isBackdated,
            user.id,
            user.id,
          ],
        );

        await conn.execute(
          `INSERT INTO siap_letter_actions
         (id,letter_id,actor_user_id,action,from_status,to_status,comment)
         VALUES (?,?,?,?,?,?,?)`,
          [
            crypto.randomUUID(),
            id,
            user.id,
            "CREATE_INTERNAL",
            null,
            "DRAFT",
            `Manager tujuan: ${recipient}${body.notes ? ` • ${str(body.notes, 5000)}` : ""}`,
          ],
        );
      } else {
        const recipient = required(body.recipient, "Tujuan surat", 255);
        const formatId = required(body.number_format_id, "Format nomor", 36);
        const issuedDate = body.issued_date
          ? dateOnly(body.issued_date, "Tanggal terbit")
          : null;

        const requestedSeqBase =
          body.custom_number_base == null ||
          String(body.custom_number_base).trim() === ""
            ? null
            : Number(body.custom_number_base);

        if (
          requestedSeqBase !== null &&
          (!Number.isInteger(requestedSeqBase) || requestedSeqBase < 1)
        )
          throw new Error("Nomor dasar custom harus angka bulat minimal 1.");

        {
          await conn.execute(
            `INSERT INTO siap_letters
           (id,direction,document_type,number_format_id,subject,recipient,letter_date,issued_date,
            confidentiality,summary,notes,status,\`current_role\`,routing_target_user_id,
            is_public,is_backdated,created_by,updated_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              id,
              "OUTGOING",
              documentType,
              formatId,
              subject,
              recipient,
              letterDate,
              issuedDate,
              confidentiality,
              str(body.summary, 5000) || null,
              str(body.notes, 5000) || null,
              "DRAFT",
              "STAFF",
              String(manager.id),
              isPublic,
              isBackdated,
              user.id,
              user.id,
            ],
          );

          const num = await reserveOutgoingNumber({
            conn,
            formatId,
            letterId: id,
            letterDate,
            userId: user.id,
            documentType,
            requestedSeqBase,
          });

          await conn.execute(
            `UPDATE siap_letters SET letter_number=? WHERE id=?`,
            [num.rendered, id],
          );

          await conn.execute(
            `INSERT INTO siap_letter_actions
           (id,letter_id,actor_user_id,action,from_status,to_status,comment)
           VALUES (?,?,?,?,?,?,?)`,
            [
              crypto.randomUUID(),
              id,
              user.id,
              "CREATE_OUTGOING",
              null,
              "DRAFT",
              `Nomor direservasi: ${num.rendered} • Manager tujuan: ${manager.name}${manager.unit_name ? ` — ${manager.unit_name}` : ""}`,
            ],
          );
        }
      }

      if (original)
        saved.push({
          id: crypto.randomUUID(),
          kind: "ORIGINAL",
          ...(await saveUpload(original, "ORIGINAL")),
        });
      for (const file of additional)
        saved.push({
          id: crypto.randomUUID(),
          kind: "ADDITIONAL",
          ...(await saveUpload(file, "ADDITIONAL")),
        });
      for (const f of saved)
        await conn.execute(
          `INSERT INTO siap_attachments(id,letter_id,attachment_kind,original_name,stored_name,storage_path,mime_type,original_size,stored_size,is_compressed,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          [
            f.id,
            id,
            f.kind,
            f.originalName,
            f.storedName,
            f.storagePath,
            f.mimeType,
            f.originalSize,
            f.storedSize,
            f.isCompressed ? 1 : 0,
            user.id,
          ],
        );

      await auditLog({
        conn,
        userId: user.id,
        action: "LETTER_CREATE",
        entityType: "LETTER",
        entityId: id,
        metadata: {
          direction,
          documentType,
          subject,
          managerTargetId: String(manager.id),
          financeReviewerId,
          isBackdated: Boolean(isBackdated),
          customNumberBase: body.custom_number_base || null,
        },
        request,
      });
    });
    committed = true;

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM siap_letters WHERE id=? LIMIT 1`,
      [id],
    );

    return NextResponse.json({ ok: true, data: rows[0] }, { status: 201 });
  } catch (error) {
    if (!committed)
      await Promise.all(
        saved.map((f) => deleteStoredFile(f.storagePath).catch(() => {})),
      );
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Gagal membuat dokumen.",
      },
      { status: 400 },
    );
  }
}
