import type { RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/types";

export function letterAccessPredicate(
  user: SessionUser,
  alias = "l",
  contribute = false,
) {
  if (user.role === "ROOT_ADMIN")
    return { sql: "1=1", params: [] as unknown[] };
  const direct = `(${alias}.created_by=? OR ${alias}.current_owner_user_id=?
    OR (${alias}.current_owner_user_id IS NULL AND ${alias}.\`current_role\`=?)
    OR ${alias}.routing_target_user_id=? OR ${alias}.finance_reviewer_user_id=?
    OR EXISTS(SELECT 1 FROM siap_letter_actions la WHERE la.letter_id=${alias}.id AND la.actor_user_id=?))`;
  const params: unknown[] = [
    user.id,
    user.id,
    user.role,
    user.id,
    user.id,
    user.id,
  ];
  if (contribute) return { sql: direct, params };
  // Early awareness does not grant approval or editing permissions. Secret letters retain their restricted route.
  return {
    sql: `(${direct} OR ${alias}.is_public=1
    OR (${alias}.direction='INCOMING' AND ${alias}.confidentiality<>'RAHASIA' AND ? IN ('DIRECTOR_OPS','PRESIDENT_DIRECTOR'))
    OR EXISTS(SELECT 1 FROM siap_dispositions ld WHERE ld.letter_id=${alias}.id AND (ld.to_user_id=? OR ld.from_user_id=? OR ld.current_owner_user_id=?))
    OR EXISTS(SELECT 1 FROM siap_disposition_reviewers lr JOIN siap_dispositions ld ON ld.id=lr.disposition_id WHERE ld.letter_id=${alias}.id AND lr.user_id=?))`,
    params: [...params, user.role, user.id, user.id, user.id, user.id],
  };
}

export async function mayAccessLetter(
  user: SessionUser,
  letterId: string,
  contribute = false,
  executor: Pool | PoolConnection = db,
) {
  const access = letterAccessPredicate(user, "l", contribute);
  const [rows] = await executor.query<RowDataPacket[]>(
    `SELECT 1 FROM siap_letters l WHERE l.id=? AND ${access.sql} LIMIT 1`,
    [letterId, ...access.params],
  );
  return Boolean(rows[0]);
}
