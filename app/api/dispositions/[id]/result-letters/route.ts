import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { findDispositionResultLetters } from "@/lib/correspondence-data";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const [rows] = await db.query<(RowDataPacket & { id: string; letter_id: string; to_user_id: string })[]>(
    "SELECT id,letter_id,to_user_id FROM siap_dispositions WHERE id=? AND status='IN_PROGRESS' LIMIT 1",
    [params.id],
  );
  const disposition = rows[0];
  if (!disposition || (user.role !== "ROOT_ADMIN" && disposition.to_user_id !== user.id)) {
    return NextResponse.json({ ok: false, error: "Disposisi tidak tersedia untuk pengiriman hasil." }, { status: 403 });
  }
  const query = new URL(request.url).searchParams.get("q")?.trim();
  const data = await findDispositionResultLetters(db, user, disposition, { query });
  return NextResponse.json({ ok: true, data });
}
