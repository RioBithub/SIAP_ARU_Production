import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (user.role !== "ROOT_ADMIN" || process.env.SIAP_V11_STAGE !== "1" ||
      !/^siap_aru_sqa_v11_[a-z0-9]{4,24}$/.test(process.env.DB_NAME ?? "")) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const [[marker]] = await db.query<RowDataPacket[]>("SELECT id FROM siap_v11_stage_marker");
  return NextResponse.json({ ok: true, data: { marker: marker.id, schema: process.env.DB_NAME } },
    { headers: { "Cache-Control": "private, no-store" } });
}
