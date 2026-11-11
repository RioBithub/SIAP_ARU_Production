import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/types";

export function letterAccess(user: SessionUser) {
  if (user.role === "ROOT_ADMIN") return { clause: "1=1", params: [] };
  return {
    clause: `(
      l.is_public=1 OR l.created_by=? OR l.current_owner_user_id=?
      OR (l.current_owner_user_id IS NULL AND l.\`current_role\`=?)
      OR EXISTS (SELECT 1 FROM siap_dispositions d WHERE d.letter_id=l.id
        AND (d.to_user_id=? OR d.from_user_id=? OR d.current_owner_user_id=?))
      OR EXISTS (
        SELECT 1 FROM siap_disposition_actions result
        JOIN siap_dispositions d ON d.id=result.disposition_id
        WHERE result.result_letter_id=l.id
          AND (d.to_user_id=? OR d.from_user_id=? OR d.current_owner_user_id=?
            OR EXISTS (SELECT 1 FROM siap_disposition_actions review
              WHERE review.disposition_id=d.id AND review.actor_user_id=?))
      )
      OR EXISTS (SELECT 1 FROM siap_letter_actions a WHERE a.letter_id=l.id AND a.actor_user_id=?)
    )`,
    params: [user.id, user.id, user.role, user.id, user.id, user.id,
      user.id, user.id, user.id, user.id, user.id],
  };
}

export async function getAccessibleLetter(user: SessionUser, id: string, conn: Pick<PoolConnection, "query"> = db) {
  const access = letterAccess(user);
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT l.* FROM siap_letters l WHERE l.id=? AND ${access.clause} LIMIT 1`,
    [id, ...access.params]
  );
  return rows[0] ?? null;
}
