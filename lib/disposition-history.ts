import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { canHandleSecretariat } from "@/lib/correspondence-workflow";
import { dispositionAccess } from "@/lib/disposition-access";
import { letterAccess } from "@/lib/letter-access";
import type { SessionUser } from "@/lib/types";

type Queryable = Pick<PoolConnection, "query">;
export type HistoryTask = RowDataPacket & { id: string; letter_id: string; parent_id: string | null };

export async function listHistoryTasks(conn: Queryable, user: SessionUser, letterIds: string[], outgoingReport = false) {
  if (!letterIds.length) return [];
  const access = dispositionAccess(user);
  const letter = letterAccess(user);
  const reportAccess = outgoingReport && canHandleSecretariat(user.role)
    ? ` OR (d.visibility='ROUTE' AND ${letter.clause})`
    : "";
  const [rows] = await conn.query<HistoryTask[]>(
    `SELECT d.id,d.letter_id,d.parent_id,d.instruction,d.result_note,d.priority,d.visibility,d.status,d.result_requirement,
       DATE_FORMAT(d.due_date,'%Y-%m-%d') AS due_date,d.due_time,d.created_at,l.subject,
       f.name AS from_name,t.name AS to_name,c.name AS owner_name,v.purpose
     FROM siap_dispositions d
     JOIN siap_letters l ON l.id=d.letter_id
     JOIN siap_users f ON f.id=d.from_user_id JOIN siap_users t ON t.id=d.to_user_id
     LEFT JOIN siap_users c ON c.id=d.current_owner_user_id
     LEFT JOIN siap_v11_dispositions v ON v.disposition_id=d.id
     WHERE l.id IN (?) AND (${access.clause}${reportAccess})
     ORDER BY d.created_at,d.id`,
    [letterIds, ...access.params, ...(reportAccess ? letter.params : [])],
  );
  return rows;
}

export function previousDispositionTasks(rows: HistoryTask[], task: Pick<HistoryTask, "id" | "parent_id" | "letter_id">) {
  const byId = new Map(rows.map(row => [row.id, row]));
  const seen = new Set([task.id]);
  const previous: HistoryTask[] = [];
  let parent = task.parent_id;
  while (parent && !seen.has(parent)) {
    const row = byId.get(parent);
    if (!row || row.letter_id !== task.letter_id) break;
    previous.push(row);
    seen.add(parent);
    parent = row.parent_id;
  }
  return previous.reverse();
}

export function selectDispositionHistory(rows: HistoryTask[], anchors: Set<string>) {
  const selected = new Set(anchors);
  const children = new Map<string, HistoryTask[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const branch = children.get(row.parent_id) ?? [];
    branch.push(row);
    children.set(row.parent_id, branch);
  }
  const descendants = new Set(anchors);
  for (const id of descendants) {
    for (const child of children.get(id) ?? []) descendants.add(child.id);
  }
  for (const id of descendants) selected.add(id);
  for (const row of rows) {
    if (!anchors.has(row.id)) continue;
    for (const parent of previousDispositionTasks(rows, row)) selected.add(parent.id);
  }
  return rows.filter(row => selected.has(row.id));
}

export async function listDispositionEvents(conn: Queryable, user: SessionUser, ids: string[]) {
  if (!ids.length) return [];
  const access = letterAccess(user);
  const [actions] = await conn.query<RowDataPacket[]>(
    `SELECT a.id,a.disposition_id,a.action,a.from_status,a.to_status,a.note,a.created_at,
       u.name AS actor_name,u.role AS actor_role,l.id AS result_id,l.subject AS result_subject,
       COALESCE(l.letter_number,l.external_number,l.subject) AS result_number
     FROM siap_disposition_actions a JOIN siap_users u ON u.id=a.actor_user_id
     LEFT JOIN siap_letters l ON l.id=a.result_letter_id AND ${access.clause}
     WHERE a.disposition_id IN (?)
     ORDER BY a.created_at,(a.action<>'CREATE'),a.id`, [...access.params, ids],
  );
  return actions;
}

export async function listDispositionHistoryFiles(conn: Queryable, ids: string[]) {
  if (!ids.length) return [];
  const [files] = await conn.query<RowDataPacket[]>(
    `SELECT a.id,a.disposition_id,a.disposition_action_id,a.original_name,a.original_size,a.is_compressed,
       a.created_at,u.name AS uploaded_by_name
     FROM siap_attachments a JOIN siap_users u ON u.id=a.uploaded_by
     WHERE a.disposition_id IN (?) ORDER BY a.created_at,a.id`, [ids],
  );
  return files;
}
