import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { str } from "@/lib/http";
import {
  deleteStoredFile,
  saveUpload,
  validateUploadBatch,
} from "@/lib/upload";
import { dispositionReviewStatus } from "@/lib/workflow-policy";
import { mayAccessDisposition } from "@/lib/disposition-access";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";

async function parseRequest(request: Request) {
  if (
    (request.headers.get("content-type") || "").includes("multipart/form-data")
  ) {
    const form = await request.formData();
    return {
      action: String(form.get("action") || "").toUpperCase(),
      note: str(form.get("note"), 5000),
      files: form
        .getAll("files")
        .filter((x): x is File => x instanceof File && x.size > 0),
    };
  }
  const body = await request.json();
  return {
    action: String(body.action || "").toUpperCase(),
    note: str(body.note, 5000),
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
  const saved: Array<Awaited<ReturnType<typeof saveUpload>> & { id: string }> =
    [];
  let committed = false;
  try {
    const { action, note, files } = await parseRequest(request);
    validateUploadBatch(files);
    const [sources] = await db.query<RowDataPacket[]>(
      "SELECT letter_id FROM siap_dispositions WHERE id=?",
      [params.id],
    );
    if (!sources[0]) throw new Error("Disposisi tidak ditemukan.");
    const data = await withTransaction(async (conn) => {
      // All workflow mutations lock the source letter before the task, including child creation.
      const [letters] = await conn.query<RowDataPacket[]>(
        "SELECT direction,status FROM siap_letters WHERE id=? FOR UPDATE",
        [sources[0].letter_id],
      );
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT d.*,fu.role originator_role,tu.role assignee_role FROM siap_dispositions d JOIN siap_users fu ON fu.id=d.from_user_id JOIN siap_users tu ON tu.id=d.to_user_id WHERE d.id=? FOR UPDATE`,
        [params.id],
      );
      const d = rows[0];
      if (!d) throw new Error("Disposisi tidak ditemukan.");
      const isRoot = user.role === "ROOT_ADMIN",
        before = String(d.status),
        owner = String(d.current_owner_user_id || d.to_user_id);
      if (action === "ADD_NOTE") {
        if (!(await mayAccessDisposition(user, params.id, true, conn)))
          throw new Error("Tidak berhak menambah catatan/lampiran.");
        if (!note && !files.length)
          throw new Error("Isi catatan atau pilih lampiran tambahan.");
      } else if (!isRoot && owner !== user.id)
        throw new Error("Disposisi ini sedang berada pada pihak lain.");
      let after = before,
        nextOwner = owner,
        resultNote = d.result_note || null,
        submittedAt = d.submitted_at || null,
        reviewedAt = d.reviewed_at || null,
        returnNote = d.return_note || null;
      let stepIndex: number | null =
        d.review_step_index == null ? null : Number(d.review_step_index);
      const [reviewers] = await conn.query<RowDataPacket[]>(
        "SELECT r.*,u.role active_role,u.is_active FROM siap_disposition_reviewers r JOIN siap_users u ON u.id=r.user_id WHERE r.disposition_id=? ORDER BY r.step_order ASC",
        [params.id],
      );
      function assignStep(index: number) {
        const step = reviewers[index];
        if (
          !step ||
          !step.is_active ||
          String(step.active_role) !== String(step.reviewer_role)
        )
          throw new Error(
            "Pemeriksa pada jalur tugas sudah nonaktif atau berganti role. Hubungi Root Admin.",
          );
        after = dispositionReviewStatus(step.reviewer_role as Role);
        nextOwner = String(step.user_id);
        stepIndex = index;
      }
      async function legacyRoleUser(role: string) {
        const [active] = await conn.query<RowDataPacket[]>(
          "SELECT id FROM siap_users WHERE role=? AND is_active=1 ORDER BY name ASC LIMIT 1",
          [role],
        );
        if (!active[0]) throw new Error("Reviewer aktif tidak ditemukan.");
        return String(active[0].id);
      }
      if (action === "SEEN" || action === "START") {
        if (!["UNSEEN", "SEEN"].includes(before))
          throw new Error("Tugas tidak berada pada tahap dilihat atau mulai.");
        if (!isRoot && String(d.to_user_id) !== user.id)
          throw new Error(
            "Hanya penerima tugas yang dapat memulai atau menandai sudah dibaca.",
          );
        after = action === "SEEN" ? "SEEN" : "IN_PROGRESS";
      } else if (action === "SUBMIT_RESULT") {
        if (
          before !== "IN_PROGRESS" ||
          (!isRoot && String(d.to_user_id) !== user.id)
        )
          throw new Error(
            "Hasil hanya dapat dikirim penerima yang sedang mengerjakan.",
          );
        if (!note)
          throw new Error("Ringkasan hasil tindak lanjut wajib diisi.");
        const [children] = await conn.query<RowDataPacket[]>(
          "SELECT id FROM siap_dispositions WHERE parent_id=? AND status<>'COMPLETED' FOR UPDATE",
          [params.id],
        );
        if (children.length)
          throw new Error(
            "Selesaikan review seluruh tugas lanjutan terlebih dahulu. Tugas yang dikembalikan perlu dikirim ulang.",
          );
        resultNote = note;
        submittedAt = new Date();
        reviewedAt = null;
        if (stepIndex !== null) {
          assignStep(0);
        } else if (d.originator_role === "PRESIDENT_DIRECTOR") {
          after =
            d.assignee_role === "DIRECTOR_OPS"
              ? "REVIEW_DIRUT"
              : "REVIEW_DIROPS";
          nextOwner =
            d.assignee_role === "DIRECTOR_OPS"
              ? String(d.from_user_id)
              : await legacyRoleUser("DIRECTOR_OPS");
        } else if (d.originator_role === "DIRECTOR_OPS") {
          after = "REVIEW_DIROPS";
          nextOwner = String(d.from_user_id);
        } else if (d.originator_role === "MANAGER") {
          after = "REVIEW_MANAGER";
          nextOwner = String(d.from_user_id);
        } else {
          after = "COMPLETED";
          nextOwner = String(d.from_user_id);
          reviewedAt = new Date();
        }
      } else if (action === "APPROVE_RESULT" || action === "RETURN_RESULT") {
        const reviewRoles: Record<string, Role> = {
          REVIEW_FINANCE: "FINANCE",
          REVIEW_MANAGER: "MANAGER",
          REVIEW_DIROPS: "DIRECTOR_OPS",
          REVIEW_DIRUT: "PRESIDENT_DIRECTOR",
          REVIEW_ROOT: "ROOT_ADMIN",
        };
        if (
          !reviewRoles[before] ||
          (!isRoot && user.role !== reviewRoles[before])
        )
          throw new Error("Tugas tidak sedang menunggu review Anda.");
        if (
          stepIndex !== null &&
          (!reviewers[stepIndex] ||
            String(reviewers[stepIndex].user_id) !== owner ||
            dispositionReviewStatus(
              reviewers[stepIndex].reviewer_role as Role,
            ) !== before)
        )
          throw new Error("Jalur review tugas tidak sesuai tahap saat ini.");
        if (action === "RETURN_RESULT") {
          if (!note) throw new Error("Alasan pengembalian hasil wajib diisi.");
          after = "IN_PROGRESS";
          nextOwner = String(d.to_user_id);
          returnNote = note;
          reviewedAt = null;
          if (stepIndex !== null) stepIndex = 0;
        } else if (stepIndex !== null) {
          if (stepIndex + 1 < reviewers.length) assignStep(stepIndex + 1);
          else {
            after = "COMPLETED";
            nextOwner = String(d.from_user_id);
            reviewedAt = new Date();
          }
        } else if (
          before === "REVIEW_DIROPS" &&
          d.originator_role === "PRESIDENT_DIRECTOR"
        ) {
          after = "REVIEW_DIRUT";
          nextOwner = String(d.from_user_id);
        } else {
          after = "COMPLETED";
          nextOwner = String(d.from_user_id);
          reviewedAt = new Date();
        }
      } else if (action === "RETURN_TASK") {
        if (
          !["UNSEEN", "SEEN", "IN_PROGRESS"].includes(before) ||
          (!isRoot && String(d.to_user_id) !== user.id)
        )
          throw new Error("Tugas tidak dapat dikembalikan pada tahap ini.");
        if (!note)
          throw new Error("Alasan pengembalian disposisi wajib diisi.");
        const [children] = await conn.query<RowDataPacket[]>(
          "SELECT id FROM siap_dispositions WHERE parent_id=? AND status<>'COMPLETED' FOR UPDATE",
          [params.id],
        );
        if (children.length)
          throw new Error(
            "Tuntaskan tugas lanjutan sebelum mengembalikan tugas asal.",
          );
        after = "RETURNED";
        nextOwner = String(d.from_user_id);
        returnNote = note;
      } else if (action === "RESEND") {
        if (
          before !== "RETURNED" ||
          (!isRoot && String(d.from_user_id) !== user.id)
        )
          throw new Error(
            "Hanya pemberi tugas yang dapat mengirim ulang tugas yang dikembalikan.",
          );
        if (!note) throw new Error("Catatan pengiriman ulang wajib diisi.");
        const [active] = await conn.query<RowDataPacket[]>(
          "SELECT id FROM siap_users WHERE id=? AND is_active=1",
          [d.to_user_id],
        );
        if (!active[0]) throw new Error("Penerima tugas sudah nonaktif.");
        after = "UNSEEN";
        nextOwner = String(d.to_user_id);
      } else if (action !== "ADD_NOTE")
        throw new Error("Tindakan tidak valid.");
      for (const file of files)
        saved.push({
          id: crypto.randomUUID(),
          ...(await saveUpload(file, "ADDITIONAL")),
        });
      const actionId = crypto.randomUUID();
      await conn.execute(
        `UPDATE siap_dispositions SET status=?,current_owner_user_id=?,result_note=?,submitted_at=?,reviewed_at=?,return_note=?,review_step_index=?,seen_at=CASE WHEN ? IN ('SEEN','START') THEN COALESCE(seen_at,UTC_TIMESTAMP()) ELSE seen_at END,started_at=CASE WHEN ?='START' THEN COALESCE(started_at,UTC_TIMESTAMP()) ELSE started_at END,completed_at=CASE WHEN ?=1 THEN UTC_TIMESTAMP() ELSE completed_at END,returned_at=CASE WHEN ?=1 THEN UTC_TIMESTAMP() ELSE returned_at END WHERE id=?`,
        [
          after,
          nextOwner,
          resultNote,
          submittedAt,
          reviewedAt,
          returnNote,
          stepIndex,
          action,
          action,
          before !== "COMPLETED" && after === "COMPLETED" ? 1 : 0,
          before !== "RETURNED" && after === "RETURNED" ? 1 : 0,
          params.id,
        ],
      );
      await conn.execute(
        "INSERT INTO siap_disposition_actions(id,disposition_id,actor_user_id,action,from_status,to_status,note) VALUES(?,?,?,?,?,?,?)",
        [actionId, params.id, user.id, action, before, after, note || null],
      );
      for (const f of saved)
        await conn.execute(
          `INSERT INTO siap_attachments(id,letter_id,disposition_id,disposition_action_id,attachment_kind,original_name,stored_name,storage_path,mime_type,original_size,stored_size,is_compressed,uploaded_by) VALUES(?,?,?,?,'PROCESS',?,?,?,?,?,?,?,?)`,
          [
            f.id,
            d.letter_id,
            params.id,
            actionId,
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
      if (letters[0]?.direction !== "OUTGOING") {
        if (action === "START")
          await conn.execute(
            "UPDATE siap_letters SET status='IN_PROGRESS',updated_by=? WHERE id=? AND status IN ('APPROVED','DISPOSED','IN_PROGRESS')",
            [user.id, d.letter_id],
          );
        if (after === "COMPLETED") {
          const [pending] = await conn.query<RowDataPacket[]>(
            "SELECT COUNT(*) total FROM siap_dispositions WHERE letter_id=? AND status NOT IN ('COMPLETED','RETURNED')",
            [d.letter_id],
          );
          if (Number(pending[0]?.total || 0) === 0)
            await conn.execute(
              "UPDATE siap_letters SET status='COMPLETED',updated_by=? WHERE id=? AND status IN ('APPROVED','DISPOSED','IN_PROGRESS')",
              [user.id, d.letter_id],
            );
        }
      }
      await auditLog({
        conn,
        userId: user.id,
        action: `DISPOSITION_${action}`,
        entityType: "DISPOSITION",
        entityId: params.id,
        metadata: {
          from: before,
          to: after,
          note,
          nextOwner,
          parentId: d.parent_id,
          attachments: saved.map((f) => f.originalName),
        },
        request,
      });
      return { status: after, attachments: saved.length };
    });
    committed = true;
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    if (!committed)
      await Promise.all(
        saved.map((f) => deleteStoredFile(f.storagePath).catch(() => {})),
      );
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Proses gagal." },
      { status: 400 },
    );
  }
}
