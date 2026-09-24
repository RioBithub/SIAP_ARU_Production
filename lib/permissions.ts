import { NextResponse } from "next/server";
import type { Role, SessionUser } from "@/lib/types";

export function hasRole(user: SessionUser, allowed: Role[]) {
  return user.role === "ROOT_ADMIN" || allowed.includes(user.role);
}

export function isSuperuser(user: SessionUser | { role: Role }) {
  return user.role === "ROOT_ADMIN";
}

export function apiForbidden(message = "Anda tidak memiliki akses untuk tindakan ini.") {
  return NextResponse.json({ ok: false, error: message }, { status: 403 });
}

export function canSeeFinance(role: Role) {
  return ["ROOT_ADMIN", "FINANCE", "MANAGER", "DIRECTOR_OPS", "PRESIDENT_DIRECTOR"].includes(role);
}

export function canEditFinance(role: Role) {
  return ["ROOT_ADMIN", "FINANCE"].includes(role);
}

export function canManageUsers(role: Role) {
  return role === "ROOT_ADMIN";
}

export function canRegisterIncoming(role: Role) {
  return role === "ROOT_ADMIN" || role === "STAFF";
}

export function canCreateOutgoing(role: Role) {
  return role === "ROOT_ADMIN" || role === "STAFF";
}

export function canCreateInternal(role: Role) {
  return role === "ROOT_ADMIN" || role === "STAFF";
}

export function canCreateDisposition(role: Role) {
  return ["ROOT_ADMIN", "MANAGER", "DIRECTOR_OPS", "PRESIDENT_DIRECTOR"].includes(role);
}
