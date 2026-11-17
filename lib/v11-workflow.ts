import type { Role } from "@/lib/types";

export const MANAGER_SCOPES = { OPS: "Manager Operasional", KSU: "Manager Keuangan, SDM & Umum" } as const;
export type ManagerScope = keyof typeof MANAGER_SCOPES;
export const REQUESTING_UNITS = {
  OPS: "Operasional", KEU: "Keuangan", SDM: "SDM", UMUM: "Umum / Administrasi",
  IT: "IT & Sistem", PENGADAAN: "Pengadaan", LEGAL: "Legal & Kepatuhan", LAINNYA: "Unit lainnya / PIC",
} as const;
export type RequestingUnit = keyof typeof REQUESTING_UNITS;
export const DELIVERY_METHODS = {
  FISIK: "Diantar langsung / kurir", EMAIL: "Email", DIGITAL: "Media digital lain", INTERNAL: "Serah terima internal",
} as const;
export const PERSEKOT_DOCUMENTS = {
  BPK: "BPK Pengajuan", SPB: "Surat Perintah Bayar (SPB)", NOTA: "Nota Dinas kepada Keuangan / Direksi",
  KONTRAK: "Kontrak Perjanjian", SPK: "Surat Perintah Kerja", MARGIN: "Perhitungan Margin",
  PESANAN: "Surat Pesanan", REKENING: "Informasi Pembayaran / Rekening Penerima",
} as const;
export const TASK_PURPOSES = {
  GENERAL: "Tindak lanjut umum", INVOICE_VERIFY: "Verifikasi invoice oleh unit", INVOICE_PAYMENT: "Pembayaran dan pencatatan",
} as const;
export type TaskPurpose = keyof typeof TASK_PURPOSES;
export const TERMINAL_TASK_STATES = ["COMPLETED", "RETURNED", "CANCELLED"];

export function invoiceVerificationStatus(documentStatus: string, verified: boolean) {
  if (documentStatus === "REJECTED" || documentStatus === "CANCELLED") return documentStatus;
  return verified ? "APPROVED" : "WAITING_VERIFICATION";
}

export function unitManagerScope(unit: unknown): ManagerScope | null {
  if (unit === "OPS") return "OPS";
  if (["KEU", "SDM", "UMUM"].includes(String(unit))) return "KSU";
  return null;
}

const STAFF_UNITS: Record<string, RequestingUnit> = {
  operasional: "OPS", "unit operasional": "OPS", ops: "OPS",
  keuangan: "KEU", finance: "KEU", sdm: "SDM", "sdm & umum": "SDM", "sdm dan umum": "SDM",
  umum: "UMUM", administrasi: "UMUM", "umum / administrasi": "UMUM", "sdm / umum": "SDM",
  it: "IT", "it / sistem": "IT", "it & sistem": "IT", "teknologi informasi": "IT",
  pengadaan: "PENGADAAN", legal: "LEGAL", "legal & kepatuhan": "LEGAL", "pic lapangan": "LAINNYA",
};

export function staffUnit(unitName: string | null): RequestingUnit | null {
  const unit = unitName?.trim().toLowerCase().replace(/\s+/g, " ") || "";
  return Object.hasOwn(STAFF_UNITS, unit) ? STAFF_UNITS[unit] : null;
}

export function staffCanVerify(requestingUnit: RequestingUnit, accountUnit: string | null) {
  if (requestingUnit === "UMUM" && /^(sdm (?:&|dan|\/) umum)$/i.test(accountUnit?.trim() || "")) return true;
  return staffUnit(accountUnit) === requestingUnit;
}

export function dispositionTargetRoles(role: Role, strict: boolean): Role[] {
  if (role === "PRESIDENT_DIRECTOR") return strict ? ["DIRECTOR_OPS", "MANAGER"] : ["DIRECTOR_OPS", "MANAGER", "FINANCE", "STAFF"];
  if (role === "DIRECTOR_OPS") return strict ? ["MANAGER"] : ["MANAGER", "FINANCE", "STAFF"];
  if (role === "MANAGER") return ["FINANCE", "STAFF"];
  if (role === "ROOT_ADMIN") return ["PRESIDENT_DIRECTOR", "DIRECTOR_OPS", "MANAGER", "FINANCE", "STAFF"];
  return [];
}

export function jakartaDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date());
}
