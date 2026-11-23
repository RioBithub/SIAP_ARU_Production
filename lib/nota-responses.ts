import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { SessionUser } from "@/lib/types";
import { notaAuthorId } from "@/lib/nota-document";
import { isAdditionalNotaRecipient } from "@/lib/nota-routing";
import { v11Letter } from "@/lib/v11-data";

export async function canRespondToNota(conn: Pick<PoolConnection, "query">, user: SessionUser, letter: RowDataPacket) {
  if (letter.direction !== "INTERNAL" || letter.status === "CANCELLED") return false;
  if (user.role === "ROOT_ADMIN" || [letter.created_by, letter.current_owner_user_id].includes(user.id)) return true;
  const workflow = await v11Letter(letter.id, conn);
  if (notaAuthorId(letter, workflow) === user.id ||
      (user.role === "STAFF" && workflow?.nota_drafter_user_id === user.id) ||
      await isAdditionalNotaRecipient(conn, letter, user.id)) return true;
  const [[prior]] = await conn.query<RowDataPacket[]>(
    "SELECT 1 FROM siap_letter_actions WHERE letter_id=? AND actor_user_id=? AND action NOT IN ('UPLOAD_NOTA_SIGNATURE','RESPONSE') LIMIT 1",
    [letter.id, user.id],
  );
  return Boolean(prior);
}
