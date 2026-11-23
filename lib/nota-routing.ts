import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { activeReviewer } from "@/lib/correspondence-data";
import { notaAuthorId } from "@/lib/nota-document";
import { canReceiveDirectorNota, isNotaDirector, NOTA_DIRECTORS } from "@/lib/correspondence-workflow";
import type { Role, SessionUser } from "@/lib/types";
import { officialManager } from "@/lib/v11-data";

type Queryable = Pick<PoolConnection, "query">;
type NotaParty = { id: string; name: string; role: Role; unit_name: string | null };

export const notaPartyLabel = (account: Pick<NotaParty, "name" | "unit_name">) =>
  [account.name, account.unit_name].filter(Boolean).join(" — ");

export async function activeNotaAccount(conn: Queryable, id: string) {
  const [[account]] = await conn.query<(RowDataPacket & NotaParty)[]>(
    "SELECT id,name,role,unit_name FROM siap_users WHERE id=? AND is_active=1", [id],
  );
  return account ?? null;
}

export async function notaPrimaryTarget(conn: Queryable, authorRole: Role, targetId: string, direct: boolean) {
  if (!direct) return authorRole === "MANAGER"
    ? activeReviewer(conn, targetId, [...NOTA_DIRECTORS]) : officialManager(conn, targetId);
  const account = await activeNotaAccount(conn, targetId);
  if (!account || !canReceiveDirectorNota(authorRole, account.role)) {
    throw new Error("Pilih penerima Nota Dinas Direksi yang aktif.");
  }
  return account;
}

export async function listNotaRecipients(conn: Queryable, letterId: string) {
  const [rows] = await conn.query<(RowDataPacket & NotaParty)[]>(
    `SELECT u.id,u.name,u.role,u.unit_name FROM siap_v11_nota_recipients r
     JOIN siap_users u ON u.id=r.recipient_user_id WHERE r.letter_id=? ORDER BY u.name,u.id`, [letterId],
  );
  return rows;
}

export async function validateNotaRecipients(conn: Queryable, value: unknown, author: Pick<NotaParty, "id" | "role">,
  primaryId: string | null, direct: boolean) {
  if (!Array.isArray(value) || value.some(id => typeof id !== "string" || !id || id.length > 36)) {
    throw new Error("Daftar penerima tambahan tidak valid.");
  }
  const ids = [...new Set<string>(value)].filter(id => id !== primaryId);
  if (!ids.length) return [];
  const [people] = await conn.query<(RowDataPacket & NotaParty)[]>(
    "SELECT id,name,role,unit_name FROM siap_users WHERE is_active=1 AND id IN (?) ORDER BY name,id", [ids],
  );
  if (people.length !== ids.length || people.some(person =>
    person.id === author.id || (direct && !canReceiveDirectorNota(author.role, person.role)))) {
    throw new Error("Pilih akun aktif yang boleh menerima Nota Dinas ini.");
  }
  return people;
}

export async function saveNotaRecipients(conn: PoolConnection, letterId: string, people: Pick<NotaParty, "id">[]) {
  await conn.execute("DELETE FROM siap_v11_nota_recipients WHERE letter_id=?", [letterId]);
  if (people.length) await conn.query("INSERT INTO siap_v11_nota_recipients (letter_id,recipient_user_id) VALUES ?",
    [people.map(person => [letterId, person.id])]);
}

export async function isAdditionalNotaRecipient(conn: Queryable, letter: RowDataPacket, userId: string) {
  if (letter.direction !== "INTERNAL" || !["APPROVED", "COMPLETED"].includes(letter.status)) return false;
  const [[recipient]] = await conn.query<RowDataPacket[]>(
    "SELECT 1 FROM siap_v11_nota_recipients WHERE letter_id=? AND recipient_user_id=?", [letter.id, userId],
  );
  return Boolean(recipient);
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
       AND action IN ('APPROVE','APPROVE_FINAL','RETURN','RETURN_PREVIOUS','REJECT') LIMIT 1`,
      [letter.id, author.id],
    );
    if (!prior && !await isAdditionalNotaRecipient(conn, letter, author.id)) return null;
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
