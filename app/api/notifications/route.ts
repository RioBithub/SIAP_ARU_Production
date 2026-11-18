import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { letterAccess } from "@/lib/letter-access";
import { dispositionAccess } from "@/lib/disposition-access";

export const runtime = "nodejs";

function visibleNotifications(user: Parameters<typeof letterAccess>[0]) {
  const letters = letterAccess(user);
  const tasks = dispositionAccess(user);
  return {
    clause: `n.recipient_user_id=? AND (
      (n.entity_type='LETTER' AND EXISTS (SELECT 1 FROM siap_letters l WHERE l.id=n.entity_id AND ${letters.clause}))
      OR (n.entity_type='DISPOSITION' AND EXISTS (SELECT 1 FROM siap_dispositions d WHERE d.id=n.entity_id AND ${tasks.clause}))
    )`,
    params: [user.id, ...letters.params, ...tasks.params],
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (process.env.SIAP_V11_ENABLED !== "1") {
    return NextResponse.json({ ok: true, data: { enabled: false, unread: 0, items: [] } });
  }
  const visible = visibleNotifications(user);
  const [items] = await db.query<RowDataPacket[]>(
    `SELECT CAST(n.id AS CHAR) AS id,n.entity_type,n.entity_id,n.title,n.created_at,n.read_at,
      COALESCE(l.subject,source.subject) AS subject,l.direction
     FROM siap_v11_notifications n
     LEFT JOIN siap_letters l ON n.entity_type='LETTER' AND l.id=n.entity_id
     LEFT JOIN siap_dispositions d ON n.entity_type='DISPOSITION' AND d.id=n.entity_id
     LEFT JOIN siap_letters source ON source.id=d.letter_id
     WHERE ${visible.clause} ORDER BY n.read_at IS NOT NULL,n.id DESC LIMIT 30`, visible.params,
  );
  const [[count]] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS unread FROM siap_v11_notifications n WHERE n.read_at IS NULL AND " + visible.clause, visible.params,
  );
  return NextResponse.json({ ok: true, data: {
    enabled: true, unread: Number(count.unread),
    items: items.map(({ entity_type, entity_id, direction, ...item }) => ({
      ...item,
      href: entity_type === "DISPOSITION" ? "/dispositions?disposition_id=" + entity_id
        : "/letters/" + ({ INCOMING: "incoming", INTERNAL: "internal", OUTGOING: "outgoing" } as Record<string, string>)[direction] + "?letter_id=" + entity_id,
    })),
  } }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (process.env.SIAP_V11_ENABLED !== "1") return NextResponse.json({ ok: false }, { status: 409 });
  const body = await request.json().catch(() => null);
  const id = body?.id;
  if (!/^[1-9]\d{0,19}$/.test(String(id ?? ""))) return NextResponse.json({ ok: false }, { status: 400 });
  const visible = visibleNotifications(user);
  await db.execute(
    "UPDATE siap_v11_notifications n SET read_at=COALESCE(read_at,UTC_TIMESTAMP()) WHERE n.id=? AND " + visible.clause,
    [id, ...visible.params],
  );
  return NextResponse.json({ ok: true });
}
