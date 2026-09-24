import { NextResponse } from "next/server";
import { createSession, verifyCredentials } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
    if (ip) {
      const [attempts] = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM siap_audit_logs
         WHERE action='LOGIN_FAILED' AND ip_address=? AND created_at >= (UTC_TIMESTAMP() - INTERVAL 15 MINUTE)`,
        [ip]
      );
      if (Number(attempts[0]?.c || 0) >= 10) {
        return NextResponse.json({ ok:false, error:"Terlalu banyak percobaan login. Coba lagi beberapa menit." }, { status:429 });
      }
    }
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Email dan password wajib diisi." }, { status: 400 });
    }
    const user = await verifyCredentials(email, password);
    if (!user) {
      await auditLog({ action: "LOGIN_FAILED", entityType: "AUTH", metadata: { email }, request });
      return NextResponse.json({ ok: false, error: "Email atau password salah." }, { status: 401 });
    }
    await createSession(user.id, request);
    await auditLog({ userId: user.id, action: "LOGIN", entityType: "AUTH", entityId: user.id, request });
    return NextResponse.json({ ok: true, data: user });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Login gagal." }, { status: 500 });
  }
}
