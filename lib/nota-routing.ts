import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { notaAuthorId } from "@/lib/nota-document";
import { isNotaDirector } from "@/lib/correspondence-workflow";
import type { Role, SessionUser } from "@/lib/types";

type Queryable = Pick<PoolConnection, "query">;

export async function activeNotaAccount(conn: Queryable, id: string) {
  const [[account]] = await conn.query<(RowDataPacket & { id: string; name: string; role: Role; unit_name: string | null })[]>(
    "SELECT id,name,role,unit_name FROM siap_users WHERE id=? AND is_active=1", [id],
  );
  return account ?? null;
}

export async function notaReplyRecipient(conn: Queryable, author: Pick<SessionUser, "id" | "role">, letter: RowDataPacket,
  workflow: RowDataPacket | null) {
  if (!isNotaDirector(author.role) || letter.direction !== "INTERNAL" ||
      letter.document_type !== "NOTA_DINAS" || ["DRAFT", "CANCELLED"].includes(letter.status)) return null;
  const sender = notaAuthorId(letter, workflow);
  if (sender === author.id) return null;
  if (letter.current_owner_user_id !== author.id) {
    const [[prior]] = await conn.query<RowDataPacket[]>(
      `SELECT 1 FROM siap_letter_actions WHERE letter_id=? AND actor_user_id=?
       AND action IN ('APPROVE','APPROVE_FINAL','RETURN','RETURN_PREVIOUS','REJECT','RESPONSE') LIMIT 1`,
      [letter.id, author.id],
    );
    if (!prior) return null;
  }
  return activeNotaAccount(conn, sender);
}

export async function directorsForNotaReply(conn: Queryable, user: SessionUser, letter: RowDataPacket,
  workflow: RowDataPacket | null) {
  if (user.role !== "STAFF" || ["DRAFT", "CANCELLED"].includes(letter.status)) return [];
  const [people] = await conn.query<(RowDataPacket & { id: string; name: string; role: Role })[]>(
    `SELECT id,name,role FROM siap_users WHERE is_active=1 AND role IN ('DIRECTOR_OPS','PRESIDENT_DIRECTOR')
     ORDER BY name,id`,
  );
  const candidates = await Promise.all(people.map(async author => {
    const recipient = await notaReplyRecipient(conn, author, letter, workflow);
    return recipient && { id: author.id, name: author.name,
      recipient: { id: recipient.id, name: recipient.name, unit: recipient.unit_name } };
  }));
  return candidates.filter(candidate => candidate !== null);
}
