import crypto from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { activeReviewer } from "@/lib/correspondence-data";
import { db } from "@/lib/db";
import { required, str } from "@/lib/http";
import { MAX_FILE_BYTES, saveUpload } from "@/lib/upload";
import {
  DELIVERY_METHODS, PERSEKOT_DOCUMENTS, REQUESTING_UNITS, TASK_PURPOSES, unitManagerScope,
  type ManagerScope, type RequestingUnit, type TaskPurpose,
} from "@/lib/v11-workflow";

type Queryable = Pick<PoolConnection, "query">;

export function v11Enabled() {
  return process.env.SIAP_V11_ENABLED === "1";
}

export async function officialManager(conn: Queryable, id: string, unit?: RequestingUnit | null) {
  const manager = await activeReviewer(conn, id, ["MANAGER"]);
  const [rows] = await conn.query<RowDataPacket[]>("SELECT scope FROM siap_v11_managers WHERE user_id=?", [id]);
  const scope = rows[0]?.scope as ManagerScope | undefined;
  if (scope !== "OPS" && scope !== "KSU") throw new Error("Pilih salah satu Manager yang terdaftar untuk alur V11.");
  const expected = unitManagerScope(unit);
  if (expected && expected !== scope) throw new Error("Manager tujuan tidak sesuai dengan unit pemohon.");
  return { ...manager, scope };
}

export async function v11Letter(id: string, conn: Queryable = db) {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM siap_v11_letters WHERE letter_id=?", [id]);
  return rows[0] ?? null;
}

export function requestingUnit(value: unknown): RequestingUnit {
  if (typeof value !== "string" || !Object.hasOwn(REQUESTING_UNITS, value)) throw new Error("Pilih unit pemohon yang valid.");
  return value as RequestingUnit;
}

export function checkedDate(value: unknown, label: string) {
  const text = required(value, label, 10);
  const parsed = new Date(text + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== text || text < "1000-01-01") throw new Error(label + " tidak valid.");
  return text;
}

export function receiptFields(input: Record<string, unknown>, complete: boolean) {
  const receivedTime = str(input.received_time, 8);
  const method = str(input.delivery_method, 16);
  const deliveredBy = str(input.delivered_by, 255);
  const receivedBy = str(input.received_by, 255);
  if (receivedTime && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(receivedTime)) throw new Error("Jam terima WIB tidak valid.");
  if (method && !Object.hasOwn(DELIVERY_METHODS, method)) throw new Error("Cara penerimaan tidak valid.");
  if (complete && (!receivedTime || !method || !deliveredBy || !receivedBy)) {
    throw new Error("Jam WIB, cara penerimaan, nama pengantar, dan nama penerima wajib diisi.");
  }
  return {
    receivedTime: receivedTime || null, method: method || null,
    deliveredBy: deliveredBy || null, receivedBy: receivedBy || null,
    note: str(input.receipt_note, 1000) || null,
  };
}

export function takeFile(value: FormDataEntryValue | null | undefined): File | null {
  return value && typeof value !== "string" && value.size > 0 ? value : null;
}

export async function proofMimeType(file: File, pdfOnly = false) {
  if (file.size < 8 || file.size > MAX_FILE_BYTES) throw new Error("Ukuran bukti tidak valid (maksimal 10 MB).");
  const header = Buffer.from(await file.slice(0, 8).arrayBuffer());
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "pdf" && header.subarray(0, 5).toString("ascii") === "%PDF-") {
    const tail = await file.slice(Math.max(0, file.size - 2048)).text();
    if (!tail.includes("%%EOF")) throw new Error("Berkas PDF tidak lengkap.");
    return "application/pdf";
  }
  if (!pdfOnly && ext === "png" && header.equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (!pdfOnly && (ext === "jpg" || ext === "jpeg") && header.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg";
  throw new Error(pdfOnly ? "Unggah berkas PDF yang valid." : "Unggah bukti PDF, JPG, atau PNG yang valid.");
}

export async function saveProof(file: File, pdfOnly = false, kind: "ORIGINAL" | "ADDITIONAL" = "ADDITIONAL") {
  const type = await proofMimeType(file, pdfOnly);
  return saveUpload(new File([file], file.name, { type }), kind);
}

export function persekotChecklist(value: unknown) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some(key => typeof key !== "string" || !Object.hasOwn(PERSEKOT_DOCUMENTS, key))) {
    throw new Error("Checklist Persekot tidak valid.");
  }
  return [...new Set(value.filter(key => key !== "SPB"))] as string[];
}

export function taskPurpose(value: unknown): TaskPurpose {
  if (value === undefined) return "GENERAL";
  if (typeof value !== "string" || !Object.hasOwn(TASK_PURPOSES, value)) throw new Error("Tujuan disposisi tidak valid.");
  return value as TaskPurpose;
}

export function invoiceKey(vendor: string, number: string) {
  const normalize = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(JSON.stringify([normalize(vendor), normalize(number)])).digest("hex");
}

export async function invoiceVerified(conn: Queryable, letterId: string, revision: number, managerId: string | null) {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT 1 FROM siap_dispositions d JOIN siap_v11_dispositions v ON v.disposition_id=d.id " +
    "WHERE d.letter_id=? AND d.status='COMPLETED' AND d.from_user_id=? AND v.purpose='INVOICE_VERIFY' " +
    "AND v.invoice_revision=? LIMIT 1", [letterId, managerId, revision],
  );
  return rows.length > 0;
}

export async function activeTasks(conn: Queryable, letterId: string) {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT 1 FROM siap_dispositions WHERE letter_id=? AND status NOT IN ('COMPLETED','RETURNED','CANCELLED') LIMIT 1", [letterId],
  );
  return rows.length > 0;
}
