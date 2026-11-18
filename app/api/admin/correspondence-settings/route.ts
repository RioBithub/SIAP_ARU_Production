import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { delegatedUsers, delegationKey, incomingRecipients } from "@/lib/correspondence-settings";
import { withTransaction } from "@/lib/db";
import { str } from "@/lib/http";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const requestedManager = new URL(request.url).searchParams.get("manager_id");
  if (requestedManager && user.role !== "ROOT_ADMIN") {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const recipients = await incomingRecipients();
  const managerId = requestedManager || (user.role === "MANAGER" ? user.id : null);
  return NextResponse.json({
    ok: true, data: {
      ...recipients, delegation: managerId ? await delegatedUsers(managerId) : null,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (user.role !== "ROOT_ADMIN") return NextResponse.json({ ok: false }, { status: 403 });
  try {
    const body = await request.json();
    await withTransaction(async conn => {
      let key: string;
      let value: unknown;
      if (body.kind === "recipients") {
        if (!Array.isArray(body.recipients) || !body.recipients.length || body.recipients.length > 40 ||
            body.recipients.some((item: unknown) => typeof item !== "string" || !item.trim() || item.trim().length > 255)) {
          throw new Error("Isi daftar tujuan dengan 1 sampai 40 nama yang berbeda.");
        }
        const recipients: string[] = body.recipients.map((item: string) => item.trim());
        if (new Set(recipients.map(item => item.toLowerCase())).size !== recipients.length) {
          throw new Error("Nama tujuan harus berbeda.");
        }
        const defaultRecipient = str(body.defaultRecipient, 255);
        if (!recipients.includes(defaultRecipient)) throw new Error("Pilih tujuan default dari daftar.");
        key = "incoming_recipients";
        value = { defaultRecipient, recipients };
      } else if (body.kind === "delegation") {
        const managerId = str(body.managerId, 36);
        const [[manager]] = await conn.query<RowDataPacket[]>(
          "SELECT id FROM siap_users WHERE id=? AND is_active=1 AND role='MANAGER'", [managerId],
        );
        if (!manager) throw new Error("Pilih akun Manager aktif.");
        const ids = body.userIds;
        if (ids !== null) {
          if (!Array.isArray(ids) || ids.length > 250 || ids.some(id => typeof id !== "string" || !id || id.length > 36) ||
              new Set(ids).size !== ids.length) throw new Error("Daftar PIC tidak valid.");
          if (ids.length) {
            const [targets] = await conn.query<RowDataPacket[]>(
              "SELECT id FROM siap_users WHERE id IN (?) AND is_active=1 AND role IN ('STAFF','FINANCE')", [ids],
            );
            if (targets.length !== ids.length) throw new Error("Pilih hanya Staf atau Finance yang aktif.");
          }
        }
        key = delegationKey(managerId);
        value = ids;
      } else {
        throw new Error("Pengaturan tidak dikenal.");
      }
      await conn.execute(
        `INSERT INTO siap_correspondence_settings (setting_key,value_json,updated_by) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),updated_by=VALUES(updated_by)`,
        [key, JSON.stringify(value), user.id],
      );
      await auditLog({ user, action: "CORRESPONDENCE_SETTING_UPDATE", entityType: "SETTINGS",
        entityId: key, metadata: { value }, request }, conn);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error && !("code" in error)
      ? error.message : "Pengaturan belum dapat disimpan." }, { status: 400 });
  }
}
