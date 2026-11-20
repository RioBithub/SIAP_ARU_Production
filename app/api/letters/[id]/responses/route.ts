import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleLetter } from "@/lib/letter-access";
import { canRespondToNota } from "@/lib/nota-responses";

export const runtime = "nodejs";

const responseNotifications = `n.entity_type='LETTER' AND n.entity_id=? AND n.recipient_user_id=?
  AND n.read_at IS NULL AND audit.action='LETTER_RESPONSE'`;

export async function GET(_: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  const letter = await getAccessibleLetter(user, params.id);
  if (letter?.direction !== "INTERNAL") return NextResponse.json({ ok: false, error: "Nota Dinas tidak ditemukan." }, { status: 404 });
  const [[counts]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS unread, CAST(MAX(n.id) AS CHAR) AS last_id
     FROM siap_v11_notifications n JOIN siap_audit_logs audit ON audit.id=n.audit_id
     WHERE ${responseNotifications}`, [params.id, user.id],
  );
  const [responses] = await db.query<RowDataPacket[]>(
    `SELECT a.id,a.comment,a.created_at,u.name AS actor_name,u.role AS actor_role
     FROM siap_letter_actions a JOIN siap_users u ON u.id=a.actor_user_id
     WHERE a.letter_id=? AND a.action='RESPONSE' ORDER BY a.created_at,a.id`, [params.id],
  );
  const [files] = await db.query<RowDataPacket[]>(
    `SELECT f.id,f.letter_action_id,f.original_name FROM siap_attachments f JOIN siap_letter_actions a ON a.id=f.letter_action_id
     WHERE f.letter_id=? AND a.letter_id=f.letter_id AND a.action='RESPONSE' ORDER BY f.created_at,f.id`, [params.id],
  );
  return NextResponse.json({ ok: true, data: {
    unread: Number(counts.unread), lastNotificationId: counts.last_id, respondable: await canRespondToNota(db, user, letter),
    responses: responses.map(response => ({ ...response, files: files.filter(file => file.letter_action_id === response.id) })),
  } }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  const letter = await getAccessibleLetter(user, params.id);
  if (letter?.direction !== "INTERNAL") return NextResponse.json({ ok: false, error: "Nota Dinas tidak ditemukan." }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (typeof body?.through !== "string" || !/^[1-9]\d{0,19}$/.test(body.through)) {
    return NextResponse.json({ ok: false, error: "Notifikasi tidak valid." }, { status: 400 });
  }
  await db.execute(
    `UPDATE siap_v11_notifications n JOIN siap_audit_logs audit ON audit.id=n.audit_id
     SET n.read_at=UTC_TIMESTAMP() WHERE ${responseNotifications} AND n.id<=?`, [params.id, user.id, body.through],
  );
  return NextResponse.json({ ok: true });
}
