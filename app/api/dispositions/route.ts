import crypto from "crypto";
import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getCurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { canCreateDisposition } from "@/lib/permissions";
import { auditLog } from "@/lib/audit";
import { dateOnly, required } from "@/lib/http";
import { buildDispositionReviewRoute } from "@/lib/workflow-policy";
import { dispositionAccessPredicate } from "@/lib/disposition-access";
import { mayAccessLetter } from "@/lib/letter-access";
import {
  deleteStoredFile,
  saveUpload,
  validateUploadBatch,
} from "@/lib/upload";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";

async function activeUser(
  conn: PoolConnection,
  id: string | null,
  role?: Role,
) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id,role FROM siap_users WHERE is_active=1 ${id ? "AND id=?" : "AND role=?"} ORDER BY name ASC LIMIT 1`,
    [id || role],
  );
  const row = rows[0];
  if (!row || (role && row.role !== role))
    throw new Error(
      "Penerima atau pemeriksa aktif pada jalur tugas tidak ditemukan.",
    );
  return { userId: String(row.id), role: row.role as Role };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  const access = dispositionAccessPredicate(user);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT d.*,l.subject,l.letter_number,l.external_number,l.direction,l.document_type,
      fu.name from_name,fu.role from_role,tu.name to_name,tu.role to_role,cu.name current_owner_name,cu.role current_owner_role,
      (SELECT COUNT(*) FROM siap_attachments a WHERE a.disposition_id=d.id) attachment_count,
      (SELECT COUNT(*) FROM siap_dispositions ch WHERE ch.parent_id=d.id AND ch.status<>'COMPLETED') pending_children
     FROM siap_dispositions d JOIN siap_letters l ON l.id=d.letter_id
     JOIN siap_users fu ON fu.id=d.from_user_id JOIN siap_users tu ON tu.id=d.to_user_id
     LEFT JOIN siap_users cu ON cu.id=d.current_owner_user_id
     WHERE ${access.sql} ORDER BY d.created_at DESC LIMIT 300`,
    access.params,
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
  if (!canCreateDisposition(user.role))
    return NextResponse.json(
      { ok: false, error: "Role Anda tidak dapat membuat disposisi." },
      { status: 403 },
    );
  const saved: Array<Awaited<ReturnType<typeof saveUpload>> & { id: string }> =
    [];
  let committed = false;
  try {
    let b: Record<string, unknown>;
    let files: File[] = [];
    if (
      (request.headers.get("content-type") || "").includes(
        "multipart/form-data",
      )
    ) {
      const form = await request.formData();
      b = Object.fromEntries(form.entries());
      files = form
        .getAll("files")
        .filter((f): f is File => f instanceof File && f.size > 0);
    } else b = await request.json();
    validateUploadBatch(files);
    const letterId = required(b.letter_id, "Dokumen", 36),
      toUserId = required(b.to_user_id, "Penerima disposisi", 36),
      instruction = required(b.instruction, "Instruksi", 5000);
    const parentId = String(b.parent_id || "").trim() || null;
    if (!(await mayAccessLetter(user, letterId)))
      throw new Error("Tidak memiliki akses ke dokumen sumber.");
    const id = crypto.randomUUID(),
      actionId = crypto.randomUUID();
    const data = await withTransaction(async (conn) => {
      const [letters] = await conn.query<RowDataPacket[]>(
        "SELECT id,status,direction,confidentiality,routing_target_user_id FROM siap_letters WHERE id=? FOR UPDATE",
        [letterId],
      );
      const letter = letters[0];
      if (!letter) throw new Error("Dokumen tidak ditemukan.");
      if (
        letter.direction === "OUTGOING"
          ? letter.status !== "ISSUED"
          : !["APPROVED", "DISPOSED", "IN_PROGRESS", "COMPLETED"].includes(
              String(letter.status),
            )
      )
        throw new Error(
          "Disposisi dibuat setelah approval selesai; Surat Keluar harus sudah diterbitkan.",
        );
      let parent: RowDataPacket | null = null;
      if (parentId) {
        const [parents] = await conn.query<RowDataPacket[]>(
          "SELECT * FROM siap_dispositions WHERE id=? FOR UPDATE",
          [parentId],
        );
        parent = parents[0] || null;
        if (
          !parent ||
          String(parent.letter_id) !== letterId ||
          parent.status !== "IN_PROGRESS" ||
          String(parent.to_user_id) !== user.id ||
          String(parent.current_owner_user_id || parent.to_user_id) !== user.id
        )
          throw new Error(
            "Hanya penerima tugas yang sedang mengerjakan dapat meneruskan tugas tersebut.",
          );
      }
      const assignee = await activeUser(conn, toUserId);
      const managerId = String(
        b.manager_user_id || letter.routing_target_user_id || "",
      ).trim();
      const needsManager =
        !parentId &&
        (user.role === "FINANCE" ||
          (["PRESIDENT_DIRECTOR", "DIRECTOR_OPS"].includes(user.role) &&
            ["FINANCE", "STAFF"].includes(assignee.role)));
      if (needsManager && !managerId)
        throw new Error("Pilih Manager pemeriksa hasil.");
      const manager = needsManager
        ? await activeUser(conn, managerId, "MANAGER")
        : null;
      const dirops =
        !parentId &&
        user.role === "PRESIDENT_DIRECTOR" &&
        assignee.role !== "DIRECTOR_OPS"
          ? await activeUser(conn, null, "DIRECTOR_OPS")
          : null;
      const route = buildDispositionReviewRoute({
        originator: { userId: user.id, role: user.role },
        assignee,
        manager,
        dirops,
        parentId,
      });
      let visibility = ["PUBLIC", "ROUTE", "PRIVATE"].includes(
        String(b.visibility || "").toUpperCase(),
      )
        ? String(b.visibility).toUpperCase()
        : "ROUTE";
      if (
        letter.confidentiality === "RAHASIA" ||
        parent?.visibility === "PRIVATE"
      )
        visibility = "PRIVATE";
      else if (parent?.visibility === "ROUTE" && visibility === "PUBLIC")
        visibility = "ROUTE";
      const priority = ["NORMAL", "HIGH", "URGENT"].includes(
        String(b.priority || "").toUpperCase(),
      )
        ? String(b.priority).toUpperCase()
        : "NORMAL";
      const due = b.due_date ? dateOnly(b.due_date, "Target selesai") : null;
      await conn.execute(
        `INSERT INTO siap_dispositions(id,letter_id,parent_id,from_user_id,to_user_id,current_owner_user_id,visibility,instruction,status,priority,due_date,review_step_index) VALUES(?,?,?,?,?,?,?,?,'UNSEEN',?,?,0)`,
        [
          id,
          letterId,
          parentId,
          user.id,
          toUserId,
          toUserId,
          visibility,
          instruction,
          priority,
          due,
        ],
      );
      for (let step = 0; step < route.length; step++)
        await conn.execute(
          "INSERT INTO siap_disposition_reviewers(disposition_id,step_order,user_id,reviewer_role) VALUES(?,?,?,?)",
          [id, step, route[step].userId, route[step].role],
        );
      await conn.execute(
        "INSERT INTO siap_disposition_actions(id,disposition_id,actor_user_id,action,from_status,to_status,note) VALUES(?,?,?,'CREATE',NULL,'UNSEEN',?)",
        [actionId, id, user.id, instruction],
      );
      for (const file of files)
        saved.push({
          id: crypto.randomUUID(),
          ...(await saveUpload(file, "ADDITIONAL")),
        });
      for (const f of saved)
        await conn.execute(
          `INSERT INTO siap_attachments(id,letter_id,disposition_id,disposition_action_id,attachment_kind,original_name,stored_name,storage_path,mime_type,original_size,stored_size,is_compressed,uploaded_by) VALUES(?,?,?,?,'PROCESS',?,?,?,?,?,?,?,?)`,
          [
            f.id,
            letterId,
            id,
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
      if (
        letter.direction !== "OUTGOING" &&
        ["APPROVED", "COMPLETED"].includes(String(letter.status))
      )
        await conn.execute(
          "UPDATE siap_letters SET status='DISPOSED',updated_by=? WHERE id=?",
          [user.id, letterId],
        );
      await auditLog({
        conn,
        userId: user.id,
        action: "DISPOSITION_CREATE",
        entityType: "DISPOSITION",
        entityId: id,
        metadata: {
          letterId,
          parentId,
          toUser: toUserId,
          visibility,
          priority,
          due,
          reviewRoute: route,
          attachments: saved.map((f) => f.originalName),
        },
        request,
      });
      return { id, parent_id: parentId, attachments: saved.length };
    });
    committed = true;
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (e) {
    if (!committed)
      await Promise.all(
        saved.map((f) => deleteStoredFile(f.storagePath).catch(() => {})),
      );
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Gagal membuat disposisi.",
      },
      { status: 400 },
    );
  }
}
