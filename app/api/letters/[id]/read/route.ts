import { NextResponse } from "next/server";
import type { ResultSetHeader } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { mayAccessLetter } from "@/lib/letter-access";
import { withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  if (!(await mayAccessLetter(user, params.id)))
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  try {
    await withTransaction(async (conn) => {
      const [result] = await conn.execute<ResultSetHeader>(
        "INSERT IGNORE INTO siap_letter_reads(letter_id,user_id,first_read_at) VALUES(?,?,UTC_TIMESTAMP())",
        [params.id, user.id],
      );
      if (result.affectedRows)
        await auditLog({
          conn,
          userId: user.id,
          action: "LETTER_READ",
          entityType: "LETTER",
          entityId: params.id,
          request,
        });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof Error ? e.message : "Gagal menandai surat sudah dibaca.",
      },
      { status: 400 },
    );
  }
}
