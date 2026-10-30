import crypto from "crypto";
import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { dateOnly, str } from "@/lib/http";
import {
  deleteStoredFile,
  saveUpload,
  validateUploadBatch,
} from "@/lib/upload";
import {
  initialLetterReview,
  letterReviewRole,
  returnedLetterReview,
} from "@/lib/workflow-policy";
import { mayAccessLetter } from "@/lib/letter-access";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";

async function activeReviewer(
  conn: PoolConnection,
  role: Role,
  id?: string | null,
) {
  if (["MANAGER", "FINANCE"].includes(role) && !id)
    throw new Error("Penerima review pada jalur dokumen belum ditentukan.");
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM siap_users WHERE role=? AND is_active=1 ${id ? "AND id=?" : ""} ORDER BY name ASC LIMIT 1`,
    id ? [role, id] : [role],
  );
  if (!rows[0])
    throw new Error("Reviewer aktif pada jalur dokumen tidak ditemukan.");
  return String(rows[0].id);
}

async function parseRequest(request: Request) {
  if (
    (request.headers.get("content-type") || "").includes("multipart/form-data")
  ) {
    const form = await request.formData();
    return {
      action: String(form.get("action") || "").toUpperCase(),
      comment: str(form.get("comment"), 5000),
      issuedDate: str(form.get("issued_date"), 10),
      files: form
        .getAll("files")
        .filter((x): x is File => x instanceof File && x.size > 0),
    };
  }
  const body = await request.json();
  return {
    action: String(body.action || "").toUpperCase(),
    comment: str(body.comment, 5000),
    issuedDate: str(body.issued_date, 10),
    files: [] as File[],
  };
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  const savedFiles: Array<
    Awaited<ReturnType<typeof saveUpload>> & { id: string }
  > = [];
  let committed = false;
  try {
    const {
      action,
      comment,
      issuedDate: rawIssuedDate,
      files,
    } = await parseRequest(request);
    validateUploadBatch(files);
    const data = await withTransaction(async (conn) => {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT l.*,u.role creator_role FROM siap_letters l JOIN siap_users u ON u.id=l.created_by WHERE l.id=? FOR UPDATE`,
        [params.id],
      );
      const letter = rows[0];
      if (!letter) throw new Error("Dokumen tidak ditemukan.");
      const status = String(letter.status),
        direction = String(letter.direction);
      let next = status;
      let nextRole: string | null = letter.current_role || null;
      let nextOwner: string | null = letter.current_owner_user_id || null;
      let issuedDate: string | null = null;
      const route = {
        direction,
        created_by: String(letter.created_by),
        routing_target_user_id: letter.routing_target_user_id
          ? String(letter.routing_target_user_id)
          : null,
        finance_reviewer_user_id: letter.finance_reviewer_user_id
          ? String(letter.finance_reviewer_user_id)
          : null,
      };
      const actor = user;
      function assertReviewer() {
        const expected = letterReviewRole(status);
        if (!expected) throw new Error("Dokumen tidak sedang menunggu review.");
        if (
          actor.role !== "ROOT_ADMIN" &&
          (actor.role !== expected || (nextOwner && nextOwner !== actor.id))
        )
          throw new Error(
            "Dokumen ini harus ditinjau reviewer yang dituju pada tahap saat ini.",
          );
      }
      if (action === "SUBMIT") {
        if (!["DRAFT", "RETURNED_STAFF"].includes(status))
          throw new Error(
            "Dokumen tidak berada pada tahap yang dapat diajukan.",
          );
        if (user.role !== "ROOT_ADMIN" && String(letter.created_by) !== user.id)
          throw new Error("Hanya penyusun yang dapat mengajukan dokumen.");
        const first = initialLetterReview(route);
        next = first.status;
        nextRole = first.role;
        nextOwner = await activeReviewer(conn, first.role, first.userId);
      } else if (action === "APPROVE") {
        assertReviewer();
        if (status === "FINANCE_REVIEW") {
          next = "MANAGER_REVIEW";
          nextRole = "MANAGER";
          nextOwner = await activeReviewer(
            conn,
            "MANAGER",
            route.routing_target_user_id,
          );
        } else if (status === "MANAGER_REVIEW") {
          next = "DIRECTOR_OPS_REVIEW";
          nextRole = "DIRECTOR_OPS";
          nextOwner = await activeReviewer(conn, "DIRECTOR_OPS");
        } else if (status === "DIRECTOR_OPS_REVIEW") {
          next = "PRESIDENT_DIRECTOR_REVIEW";
          nextRole = "PRESIDENT_DIRECTOR";
          nextOwner = await activeReviewer(conn, "PRESIDENT_DIRECTOR");
        } else {
          next = direction === "OUTGOING" ? "READY_TO_ISSUE" : "APPROVED";
          nextRole = direction === "OUTGOING" ? "STAFF" : null;
          nextOwner =
            direction === "OUTGOING" ? String(letter.created_by) : null;
        }
      } else if (action === "APPROVE_FINAL") {
        if (
          direction !== "INTERNAL" ||
          !["MANAGER_REVIEW", "DIRECTOR_OPS_REVIEW"].includes(status)
        )
          throw new Error(
            "Nota Dinas hanya dapat diselesaikan pada level Manager atau Dirops yang sedang mereview.",
          );
        assertReviewer();
        next = "APPROVED";
        nextRole = null;
        nextOwner = null;
      } else if (action === "RETURN") {
        assertReviewer();
        if (!comment) throw new Error("Alasan pengembalian wajib diisi.");
        const diropsId =
          status === "PRESIDENT_DIRECTOR_REVIEW" && direction !== "OUTGOING"
            ? await activeReviewer(conn, "DIRECTOR_OPS")
            : undefined;
        const returned = returnedLetterReview(route, status, diropsId);
        next = returned.status;
        nextRole = returned.role;
        nextOwner = returned.userId;
        if (next === "RETURNED_STAFF") nextRole = String(letter.creator_role);
        else
          nextOwner = await activeReviewer(conn, nextRole as Role, nextOwner);
      } else if (action === "RESPONSE" || action === "ADD_NOTE") {
        if (action === "RESPONSE" && direction !== "INTERNAL")
          throw new Error("Tanggapan khusus tersedia untuk Nota Dinas.");
        if (!(await mayAccessLetter(user, params.id, true, conn)))
          throw new Error(
            "Anda tidak berhak menambah catatan pada dokumen ini.",
          );
        if (!comment && !files.length)
          throw new Error("Isi catatan atau pilih lampiran tambahan.");
        // Append-only contribution: status, current reviewer and approval chain stay unchanged.
      } else if (action === "ISSUE") {
        if (direction !== "OUTGOING" || status !== "READY_TO_ISSUE")
          throw new Error("Surat belum siap diterbitkan.");
        if (user.role !== "ROOT_ADMIN" && String(letter.created_by) !== user.id)
          throw new Error(
            "Hanya penyusun atau Root yang dapat menerbitkan surat.",
          );
        issuedDate = rawIssuedDate
          ? dateOnly(rawIssuedDate, "Tanggal terbit")
          : new Date().toISOString().slice(0, 10);
        next = "ISSUED";
        nextRole = null;
        nextOwner = null;
      } else if (action === "COMPLETE") {
        if (
          !["ROOT_ADMIN", "DIRECTOR_OPS", "PRESIDENT_DIRECTOR"].includes(
            user.role,
          ) ||
          !["APPROVED", "DISPOSED", "IN_PROGRESS"].includes(status) ||
          direction === "OUTGOING"
        )
          throw new Error("Dokumen belum dapat diselesaikan pada tahap ini.");
        if (!(await mayAccessLetter(user, params.id, false, conn)))
          throw new Error("Tidak memiliki akses dokumen.");
        next = "COMPLETED";
        nextRole = null;
        nextOwner = null;
      } else if (action === "CANCEL") {
        if (user.role !== "ROOT_ADMIN" && String(letter.created_by) !== user.id)
          throw new Error("Tidak berhak membatalkan dokumen.");
        if (!comment) throw new Error("Alasan pembatalan wajib diisi.");
        next = "CANCELLED";
        nextRole = null;
        nextOwner = null;
      } else throw new Error("Tindakan tidak dikenal.");
      for (const file of files)
        savedFiles.push({
          id: crypto.randomUUID(),
          ...(await saveUpload(file, "ADDITIONAL")),
        });
      const actionId = crypto.randomUUID();
      await conn.execute(
        `UPDATE siap_letters SET status=?,\`current_role\`=?,current_owner_user_id=?,cancelled_reason=IF(?='CANCEL',?,cancelled_reason),issued_date=CASE WHEN ?='ISSUE' THEN ? ELSE issued_date END,updated_by=? WHERE id=?`,
        [
          next,
          nextRole,
          nextOwner,
          action,
          comment || null,
          action,
          issuedDate,
          user.id,
          params.id,
        ],
      );
      await conn.execute(
        `INSERT INTO siap_letter_actions(id,letter_id,actor_user_id,action,from_status,to_status,comment) VALUES(?,?,?,?,?,?,?)`,
        [actionId, params.id, user.id, action, status, next, comment || null],
      );
      for (const file of savedFiles)
        await conn.execute(
          `INSERT INTO siap_attachments(id,letter_id,letter_action_id,attachment_kind,original_name,stored_name,storage_path,mime_type,original_size,stored_size,is_compressed,uploaded_by) VALUES(?,?,?,'PROCESS',?,?,?,?,?,?,?,?)`,
          [
            file.id,
            params.id,
            actionId,
            file.originalName,
            file.storedName,
            file.storagePath,
            file.mimeType,
            file.originalSize,
            file.storedSize,
            file.isCompressed ? 1 : 0,
            user.id,
          ],
        );
      if (action === "ISSUE")
        await conn.execute(
          "UPDATE siap_number_ledger SET status='ISSUED' WHERE letter_id=? AND status='RESERVED'",
          [params.id],
        );
      if (action === "CANCEL")
        await conn.execute(
          "UPDATE siap_number_ledger SET status='CANCELLED',cancelled_reason=? WHERE letter_id=? AND status<>'CANCELLED'",
          [comment, params.id],
        );
      await auditLog({
        conn,
        userId: user.id,
        action: `LETTER_${action}`,
        entityType: "LETTER",
        entityId: params.id,
        metadata: {
          from: status,
          to: next,
          comment,
          direction,
          processAttachments: savedFiles.map((f) => f.originalName),
          issuedDate,
        },
        request,
      });
      return { status: next, actionId, attachments: savedFiles.length };
    });
    committed = true;
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    if (!committed)
      await Promise.all(
        savedFiles.map((f) => deleteStoredFile(f.storagePath).catch(() => {})),
      );
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Proses gagal." },
      { status: 400 },
    );
  }
}
