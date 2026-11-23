import type { PoolConnection } from "mysql2/promise";
import { auditLog } from "@/lib/audit";
import type { SessionUser } from "@/lib/types";

export type AccountIdentity = { name: string; email: string; alias: string | null; unit_name: string | null };

export function profileName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 150 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("Isi nama yang valid, maksimal 150 karakter.");
  }
  return name;
}

export function profileOptional(value: unknown, label: string, limit: number) {
  if (value == null) return null;
  if (typeof value !== "string" || value.trim().length > limit || /[\u0000-\u001f\u007f]/.test(value.trim())) {
    throw new Error(`${label} maksimal ${limit} karakter.`);
  }
  return value.trim() || null;
}

export function profileEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Isi alamat email yang valid, maksimal 190 karakter.");
  }
  return email;
}

export function duplicateProfileEmail(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
}

export async function auditProfileUpdate(conn: PoolConnection, user: SessionUser, userId: string,
  before: AccountIdentity, after: AccountIdentity, source: "SELF" | "ADMIN", request: Request) {
  const changes: Partial<Record<keyof AccountIdentity, { before: string | null; after: string | null }>> = {};
  for (const key of ["name", "email", "alias", "unit_name"] as const) {
    if (before[key] !== after[key]) changes[key] = { before: before[key], after: after[key] };
  }
  if (!Object.keys(changes).length) return;
  await auditLog({
    user, action: "USER_PROFILE_UPDATE", entityType: "USER", entityId: userId,
    metadata: { source, changes }, request,
  }, conn);
}
