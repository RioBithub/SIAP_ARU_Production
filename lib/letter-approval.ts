import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { reviewRole } from "@/lib/correspondence-workflow";
import type { SessionUser } from "@/lib/types";

type Queryable = Pick<PoolConnection, "query">;
export type ApprovalSnapshot = { id: string; status: string; role: string | null; ownerId: string | null };

export async function reversibleApproval(conn: Queryable, user: SessionUser, letter: RowDataPacket) {
  if (!["DIRECTOR_OPS_REVIEW", "PRESIDENT_DIRECTOR_REVIEW", "SECRETARIAT_REVIEW", "READY_TO_ISSUE", "APPROVED"].includes(letter.status)
      || letter.issued_date || letter.sent_date) return null;
  const [[blocked]] = await conn.query<RowDataPacket[]>(
    `SELECT EXISTS (SELECT 1 FROM siap_v11_letters WHERE letter_id=? AND (payable_id IS NOT NULL OR signature_attachment_id IS NOT NULL))
      OR EXISTS (SELECT 1 FROM siap_dispositions WHERE letter_id=? AND status NOT IN ('COMPLETED','CANCELLED','RETURNED'))
      OR EXISTS (SELECT 1 FROM siap_v11_signing WHERE letter_id=?)
      OR EXISTS (SELECT 1 FROM siap_v11_attachment_signing s
        JOIN siap_attachments a ON a.id=s.source_attachment_id WHERE a.letter_id=?)
      AS downstream`,
    [letter.id, letter.id, letter.id, letter.id],
  );
  if (blocked.downstream) return null;

  let snapshot: ApprovalSnapshot | null = letter.approval_snapshot
    ? (typeof letter.approval_snapshot === "string" ? JSON.parse(letter.approval_snapshot) : letter.approval_snapshot)
    : null;
  const [actions] = await conn.query<RowDataPacket[]>(
    `SELECT a.*,u.role AS approver_role
     FROM siap_letter_actions a JOIN siap_users u ON u.id=a.actor_user_id
     WHERE a.letter_id=? AND ${snapshot ? "a.id=?" : "a.from_status<>a.to_status"}
     ORDER BY a.created_at DESC,a.id DESC LIMIT 2`, [letter.id, ...(snapshot ? [snapshot.id] : [])],
  );
  const approval = actions[0];
  if (!approval || !["APPROVE", "APPROVE_FINAL"].includes(approval.action) || approval.to_status !== letter.status ||
      (user.role !== "ROOT_ADMIN" && approval.actor_user_id !== user.id)) return null;
  if (!snapshot) {
    // Older approvals can be recovered only when the last transition and its reviewer are unambiguous.
    if (actions[1] && Number(new Date(approval.created_at)) === Number(new Date(actions[1].created_at))) return null;
    const role = approval.from_status === "SECRETARIAT_REVIEW" ? "SECRETARIAT" : reviewRole(approval.from_status);
    if (!role || role !== approval.approver_role) return null;
    snapshot = { id: approval.id, status: approval.from_status, role,
      ownerId: role === "SECRETARIAT" ? null : approval.actor_user_id };
  }
  if (snapshot.ownerId) {
    const [[owner]] = await conn.query<RowDataPacket[]>(
      "SELECT id FROM siap_users WHERE id=? AND role=? AND is_active=1", [snapshot.ownerId, snapshot.role],
    );
    if (!owner) return null;
  }
  const [[later]] = await conn.query<RowDataPacket[]>(
    `SELECT 1 FROM siap_dispositions WHERE letter_id=? AND created_at>=? LIMIT 1`, [letter.id, approval.created_at],
  );
  return later ? null : snapshot;
}
