import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { auditProfileUpdate, duplicateProfileEmail, profileEmail, profileName, profileOptional } from "@/lib/account-profile";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { str } from "@/lib/http";
import { ROLE_LABELS } from "@/lib/types";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  if (user.role !== "ROOT_ADMIN") return NextResponse.json({ ok: false, error: "Akun ini memerlukan akses Root Admin." }, { status: 403 });
  try {
    const fields = await request.json();
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("Data akun tidak valid.");
    const role = str(fields.role, 40);
    if (role && !Object.hasOwn(ROLE_LABELS, role)) throw new Error("Role tidak valid.");
    const updatedName = fields.name === undefined ? undefined : profileName(fields.name);
    const updatedEmail = fields.email === undefined ? undefined : profileEmail(fields.email);
    const passwordHash = fields.password ? await hashPassword(String(fields.password)) : null;
    const profile = await withTransaction(async conn => {
      const [[target]] = await conn.query<RowDataPacket[]>(
        "SELECT name,email,alias,unit_name FROM siap_users WHERE id=? FOR UPDATE", [params.id],
      );
      if (!target) return null;
      const before = { name: String(target.name), email: String(target.email), alias: target.alias as string | null, unit_name: target.unit_name as string | null };
      const after = {
        name: updatedName ?? before.name,
        email: updatedEmail ?? before.email,
        alias: fields.alias === undefined ? before.alias : profileOptional(fields.alias, "Alias", 150),
        unit_name: fields.unit_name === undefined ? before.unit_name : profileOptional(fields.unit_name, "Unit", 120),
      };
      const isActive = typeof fields.is_active === "boolean" ? Number(fields.is_active) : null;
      await conn.execute(
        `UPDATE siap_users SET name=?,email=?,alias=?,role=COALESCE(NULLIF(?,''),role),
          unit_name=?,is_active=COALESCE(?,is_active),
          password_hash=COALESCE(?,password_hash) WHERE id=?`,
        [after.name, after.email, after.alias, role, after.unit_name, isActive, passwordHash, params.id],
      );
      await auditProfileUpdate(conn, user, params.id, before, after, "ADMIN", request);
      if (role || isActive !== null || passwordHash) {
        await auditLog({
          user, action: "USER_UPDATE", entityType: "USER", entityId: params.id,
          metadata: { role: role || undefined, is_active: fields.is_active, passwordReset: passwordHash ? true : undefined }, request,
        }, conn);
      }
      return after;
    });
    if (!profile) return NextResponse.json({ ok: false, error: "Akun tidak ditemukan." }, { status: 404 });
    return NextResponse.json({ ok: true, data: profile });
  } catch (error) {
    if (duplicateProfileEmail(error)) {
      return NextResponse.json({ ok: false, error: "Email sudah dipakai oleh akun lain." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error && !("code" in error)
      ? error.message : "Perubahan akun belum dapat disimpan." }, { status: 400 });
  }
}

export async function DELETE(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser(); if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(user.role!=="ROOT_ADMIN") return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  if(params.id===user.id) return NextResponse.json({ok:false,error:"Root yang sedang login tidak dapat menghapus dirinya sendiri."},{status:400});
  await db.execute(`UPDATE siap_users SET is_active=0 WHERE id=?`,[params.id]);
  await db.execute(`DELETE FROM siap_sessions WHERE user_id=?`,[params.id]);
  await auditLog({user,action:"USER_DISABLE",entityType:"USER",entityId:params.id,request});
  return NextResponse.json({ok:true});
}
