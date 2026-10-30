import type { RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/types";

export function dispositionAccessPredicate(
  user: SessionUser,
  alias = "d",
  contribute = false,
) {
  if (user.role === "ROOT_ADMIN")
    return { sql: "1=1", params: [] as unknown[] };
  const direct = `(${alias}.from_user_id=? OR ${alias}.to_user_id=? OR ${alias}.current_owner_user_id=?
    OR EXISTS(SELECT 1 FROM siap_disposition_actions da WHERE da.disposition_id=${alias}.id AND da.actor_user_id=?)
    OR EXISTS(SELECT 1 FROM siap_disposition_reviewers dr WHERE dr.disposition_id=${alias}.id AND dr.user_id=?))`;
  const params: unknown[] = [user.id, user.id, user.id, user.id, user.id];
  if (contribute) return { sql: direct, params };
  return {
    sql: `(${direct} OR ${alias}.visibility='PUBLIC' OR (${alias}.visibility='ROUTE' AND EXISTS(
    SELECT 1 FROM siap_dispositions dx WHERE dx.letter_id=${alias}.letter_id AND (dx.from_user_id=? OR dx.to_user_id=? OR dx.current_owner_user_id=?
      OR EXISTS(SELECT 1 FROM siap_disposition_reviewers rx WHERE rx.disposition_id=dx.id AND rx.user_id=?)))))`,
    params: [...params, user.id, user.id, user.id, user.id],
  };
}

export async function mayAccessDisposition(
  user: SessionUser,
  dispositionId: string,
  contribute = false,
  executor: Pool | PoolConnection = db,
): Promise<boolean> {
  const access = dispositionAccessPredicate(user, "d", contribute);
  const [rows] = await executor.query<RowDataPacket[]>(
    `SELECT d.id FROM siap_dispositions d WHERE d.id=? AND ${access.sql} LIMIT 1`,
    [dispositionId, ...access.params],
  );
  if (rows[0]) return true;
  // Parent participants must be able to inspect and annotate delegated results, including private child tasks.
  const visited = new Set<string>();
  let id: string | null = dispositionId;
  const parentAccess = dispositionAccessPredicate(user, "d", true);
  for (let depth = 0; id && depth < 20; depth++) {
    if (visited.has(id)) return false;
    visited.add(id);
    const [parents]: [RowDataPacket[], unknown] = await executor.query<
      RowDataPacket[]
    >(`SELECT parent_id FROM siap_dispositions WHERE id=?`, [id]);
    id = parents[0]?.parent_id ? String(parents[0].parent_id) : null;
    if (!id) return false;
    const [allowed] = await executor.query<RowDataPacket[]>(
      `SELECT 1 FROM siap_dispositions d WHERE d.id=? AND ${parentAccess.sql} LIMIT 1`,
      [id, ...parentAccess.params],
    );
    if (allowed[0]) return true;
  }
  return false;
}
