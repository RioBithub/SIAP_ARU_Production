import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { auditProfileUpdate, profileName, profileOptional } from "@/lib/account-profile";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, data: user });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  try {
    const fields = await request.json();
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      return NextResponse.json({ ok: false, error: "Data profil tidak valid." }, { status: 400 });
    }
    if (Object.keys(fields).some(field => field !== "name" && field !== "alias")) {
      return NextResponse.json({ ok: false, error: "Profil sendiri hanya mendukung perubahan nama dan alias." }, { status: 403 });
    }
    const name = fields.name === undefined ? undefined : profileName(fields.name);
    const updated = await withTransaction(async conn => {
      const [[current]] = await conn.query<RowDataPacket[]>(
        "SELECT name,email,alias,unit_name FROM siap_users WHERE id=? AND is_active=1 FOR UPDATE", [user.id],
      );
      if (!current) return null;
      const before = { name: String(current.name), email: String(current.email), alias: current.alias as string | null, unit_name: current.unit_name as string | null };
      const after = { ...before, name: name ?? before.name, alias: fields.alias === undefined ? before.alias : profileOptional(fields.alias, "Alias", 150) };
      if (before.name !== after.name || before.alias !== after.alias) {
        await conn.execute("UPDATE siap_users SET name=?,alias=? WHERE id=?", [after.name, after.alias, user.id]);
        await auditProfileUpdate(conn, user, user.id, before, after, "SELF", request);
      }
      return after;
    });
    if (!updated) return NextResponse.json({ ok: false, error: "Akun tidak aktif." }, { status: 401 });
    return NextResponse.json({ ok: true, data: updated });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error && !("code" in error)
      ? error.message : "Profil belum dapat disimpan." }, { status: 400 });
  }
}
