import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { auditLog } from "@/lib/audit";
import { getAuthSession } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";

export async function GET() {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ error: "Sesi login berakhir." }, { status: 401 });
  if (session.owner.role !== "ROOT_ADMIN" || !session.user) {
    return NextResponse.json({ error: "Hanya Root Admin yang dapat mengganti akun." }, { status: 403 });
  }
  const [accounts] = await db.query<RowDataPacket[]>(
    `SELECT id,name,alias,email,role,unit_name FROM siap_users
     WHERE is_active=1 AND id<>? ORDER BY name,email`,
    [session.owner.id],
  );
  return NextResponse.json({ data: accounts }, { headers: { "Cache-Control": "private, no-store" } });
}

function isAccountId(value: unknown): value is string | null {
  return value === null || (
    typeof value === "string" && value.length > 0 && value.length <= 36 && value.trim() === value
  );
}

export async function POST(request: Request) {
  // A cross-origin browser cannot send this header without a CORS grant.
  if (request.headers.get("X-SIAP-Account-Switch") !== "1" ||
      ![null, "same-origin"].includes(request.headers.get("Sec-Fetch-Site"))) {
    return NextResponse.json({ error: "Permintaan pergantian akun tidak diizinkan." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const expectedTargetId = body?.expectedTargetId;
  const requestedTargetId = body?.targetUserId;
  if (!isAccountId(expectedTargetId) || !isAccountId(requestedTargetId)) {
    return NextResponse.json({ error: "Pilihan akun tidak valid." }, { status: 400 });
  }

  try {
    const result = await withTransaction(async conn => {
      const session = await getAuthSession(conn);
      if (!session) return { status: 401, error: "Sesi login berakhir." };
      if (session.owner.role !== "ROOT_ADMIN" && (requestedTargetId !== null || !session.targetId)) {
        return { status: 403, error: "Hanya Root Admin yang dapat mengganti akun." };
      }
      if (session.targetId !== expectedTargetId) {
        return { status: 409, error: "Akun sudah berubah. Muat ulang halaman." };
      }

      let targetId: string | null = null;
      if (requestedTargetId !== null) {
        const [[target]] = await conn.query<RowDataPacket[]>(
          "SELECT id FROM siap_users WHERE id=? AND is_active=1 AND id<>? FOR UPDATE",
          [requestedTargetId, session.owner.id],
        );
        if (!target) return { status: 404, error: "Akun tujuan tidak tersedia." };
        targetId = String(target.id);
      }
      if (targetId === session.targetId) return { status: 200 };

      await conn.execute("UPDATE siap_sessions SET impersonated_user_id=? WHERE id=?", [targetId, session.id]);
      await auditLog({
        user: session.owner,
        action: targetId === null ? "IMPERSONATION_END" : session.targetId ? "IMPERSONATION_SWITCH" : "IMPERSONATION_START",
        entityType: "USER",
        entityId: targetId ?? session.targetId,
        metadata: {
          fromUserId: session.targetId ?? session.owner.id,
          toUserId: targetId ?? session.owner.id,
        },
        request,
      }, conn);
      return { status: 200 };
    });
    return NextResponse.json(
      { ok: result.status === 200, error: result.error },
      { status: result.status, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Gagal mengganti akun SIAP ARU.", error);
    return NextResponse.json({ error: "Akun belum dapat diganti. Coba kembali." }, { status: 500 });
  }
}
