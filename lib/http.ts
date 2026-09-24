import { NextResponse } from "next/server";

export function jsonOk(data: unknown = {}) {
  return NextResponse.json({ ok: true, data });
}

export function jsonError(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Terjadi kesalahan.";
  return NextResponse.json({ ok: false, error: message }, { status });
}

export function str(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

export function required(value: unknown, label: string, max = 1000) {
  const v = str(value, max);
  if (!v) throw new Error(`${label} wajib diisi.`);
  return v;
}

export function dateOnly(value: unknown, label: string) {
  const v = required(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${label} tidak valid.`);
  return v;
}

export function amount(value: unknown, label = "Nominal") {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} tidak valid.`);
  return n;
}
