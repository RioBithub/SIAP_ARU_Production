import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { delegatedUsers } from "@/lib/correspondence-settings";
import { checkedDate, officialManager } from "@/lib/v11-data";
import { requirePaymentDocuments } from "@/lib/v11-payment-documents";
import { dispositionTargetRoles, staffCanVerify, staffUnit, unitManagerScope } from "@/lib/v11-workflow";
import type { SessionUser } from "@/lib/types";

export function dispositionDeadlineInput(fields: Record<string, unknown>) {
  const date = fields.due_date ? checkedDate(fields.due_date, "Tanggal target selesai") : null;
  const time = fields.due_time ? String(fields.due_time) : null;
  if (time && (!date || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    throw new Error("Isi tanggal dan jam target selesai yang valid (WIB).");
  }
  return { date, time };
}

export async function dispositionTarget(conn: PoolConnection, user: SessionUser, id: string, strict: boolean, purpose: string) {
  const [targets] = await conn.query<RowDataPacket[]>(
    "SELECT id,role,unit_name FROM siap_users WHERE id=? AND is_active=1 LIMIT 1", [id],
  );
  const target = targets[0];
  if (!target) throw new Error("Penerima disposisi tidak ditemukan atau tidak aktif.");
  if (!dispositionTargetRoles(user.role, strict).includes(target.role)) {
    throw new Error("Penerima tidak sesuai jalur delegasi disposisi.");
  }
  if (strict && target.role === "MANAGER") await officialManager(conn, target.id);
  if (user.role === "MANAGER") {
    const manager = strict ? await officialManager(conn, user.id) : null;
    const configured = purpose === "GENERAL" ? await delegatedUsers(user.id, conn) : null;
    if (configured !== null) {
      if (!configured.includes(target.id)) throw new Error("Penerima belum terdaftar sebagai PIC Manager ini.");
    } else if (manager) {
      const targetScope = target.role === "FINANCE" ? "KSU" : unitManagerScope(staffUnit(target.unit_name));
      if (targetScope && targetScope !== manager.scope) throw new Error("Penerima berada di bawah Manager lain.");
    }
  }
  return target;
}

export async function assertInvoiceVerificationAssignment(
  conn: PoolConnection, user: SessionUser, letter: RowDataPacket, workflow: RowDataPacket, target: RowDataPacket,
) {
  if (user.role !== "MANAGER" || letter.status !== "MANAGER_REVIEW" || letter.current_owner_user_id !== user.id ||
      letter.routing_target_user_id !== user.id || target.role !== "STAFF" ||
      !staffCanVerify(workflow.requesting_unit, target.unit_name)) {
    throw new Error("Manager reviewer harus menugaskan verifikasi kepada Staff unit pemohon.");
  }
  await officialManager(conn, user.id, workflow.requesting_unit);
  const [prior] = await conn.query<RowDataPacket[]>(
    `SELECT 1 FROM siap_dispositions d JOIN siap_v11_dispositions v ON v.disposition_id=d.id
     WHERE d.letter_id=? AND v.purpose='INVOICE_VERIFY' AND v.invoice_revision=?
       AND d.status NOT IN ('RETURNED','CANCELLED') LIMIT 1`, [letter.id, workflow.invoice_revision],
  );
  if (prior.length) throw new Error("Revisi ini sudah memiliki tugas verifikasi.");
}

export async function assertPaymentRequestAssignment(
  conn: PoolConnection, user: SessionUser, letter: RowDataPacket, workflow: RowDataPacket, target: RowDataPacket,
  parentId: string | null,
) {
  if (parentId || user.role !== "MANAGER" || target.role !== "FINANCE" || letter.status !== "APPROVED") {
    throw new Error("Manager KSU menugaskan Nota Dinas yang telah disetujui langsung kepada Finance.");
  }
  const manager = await officialManager(conn, user.id);
  if (manager.scope !== "KSU") throw new Error("Instruksi bayar hanya dapat dibuat Manager KSU.");
  const [prior] = await conn.query<RowDataPacket[]>(
    `SELECT 1 FROM siap_dispositions d JOIN siap_v11_dispositions v ON v.disposition_id=d.id
     WHERE d.letter_id=? AND v.purpose='REQUEST_PAYMENT' AND d.status NOT IN ('RETURNED','CANCELLED') LIMIT 1`,
    [letter.id],
  );
  if (prior.length) throw new Error("Sudah ada instruksi pembayaran untuk pengajuan ini.");
  await requirePaymentDocuments(conn, letter.id, workflow, letter.document_type);
}
