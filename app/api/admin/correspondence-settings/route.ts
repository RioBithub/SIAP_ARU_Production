import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { delegatedUsers, delegationKey, incomingRecipients, numberSourceSettings } from "@/lib/correspondence-settings";
import { withTransaction } from "@/lib/db";
import { str } from "@/lib/http";
import { REGISTER_SHEETS } from "@/lib/aru-register";
import { normalizeSheetUrl, readNumberRegister } from "@/lib/google-number-register";
import { isGeneralPicRole } from "@/lib/v11-workflow";
import type { NumberSourceSettings } from "@/lib/correspondence-number-source";

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
      ...(user.role === "ROOT_ADMIN" && !requestedManager ? { numbering: await numberSourceSettings() } : {}),
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (user.role !== "ROOT_ADMIN") return NextResponse.json({ ok: false }, { status: 403 });
  try {
    const body = await request.json();
    const sheetUrl = normalizeSheetUrl(body.sheetUrl);
    const matches = await readNumberRegister(sheetUrl, REGISTER_SHEETS);
    return NextResponse.json({ ok: true, data: { sheetUrl,
      tabs: matches.map(({ config, rows, incompleteDates }) => ({
        tab: config.sheet, count: rows.length, incompleteDates,
      })) } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Koneksi Google Sheets gagal." },
      { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (user.role !== "ROOT_ADMIN") return NextResponse.json({ ok: false }, { status: 403 });
  try {
    const body = await request.json();
    let numbering: NumberSourceSettings | undefined;
    if (body.kind === "numbering") {
      if (body.source !== "SIAP" && body.source !== "SHEETS") throw new Error("Pilih sumber nomor surat.");
      const sheetUrl = body.source === "SHEETS" || body.sheetUrl ? normalizeSheetUrl(body.sheetUrl) : "";
      if (body.source === "SHEETS") await readNumberRegister(sheetUrl, REGISTER_SHEETS);
      numbering = { source: body.source, sheetUrl };
    }
    await withTransaction(async conn => {
      let key: string;
      let value: unknown;
      if (numbering) {
        key = "number_source";
        value = numbering;
      } else if (body.kind === "recipients") {
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
          if (!Array.isArray(ids) || ids.length > 250 || ids.some(id => typeof id !== "string" || !id || id.length > 36 || id === managerId) ||
              new Set(ids).size !== ids.length) throw new Error("Daftar PIC tidak valid.");
          if (ids.length) {
            const [targets] = await conn.query<RowDataPacket[]>(
              "SELECT id,role FROM siap_users WHERE id IN (?) AND is_active=1", [ids],
            );
            if (targets.length !== ids.length || targets.some(target => !isGeneralPicRole(target.role))) throw new Error("Pilih hanya Staf atau Finance yang aktif.");
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
    return NextResponse.json({ ok: true, ...(numbering ? { data: numbering } : {}) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error && !("code" in error)
      ? error.message : "Pengaturan belum dapat disimpan." }, { status: 400 });
  }
}
