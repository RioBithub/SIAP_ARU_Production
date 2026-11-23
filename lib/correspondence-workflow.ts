import type { Role } from "@/lib/types";

export const REVIEW_STATUS = {
  MANAGER: "MANAGER_REVIEW",
  DIRECTOR_OPS: "DIRECTOR_OPS_REVIEW",
  PRESIDENT_DIRECTOR: "PRESIDENT_DIRECTOR_REVIEW",
} as const;

export type ReviewRole = keyof typeof REVIEW_STATUS;
export const REVIEW_ROLES = Object.keys(REVIEW_STATUS) as ReviewRole[];

export function reviewRole(status: string): ReviewRole | undefined {
  return REVIEW_ROLES.find(role => REVIEW_STATUS[role] === status);
}

export function canHandleSecretariat(role: Role) {
  return role === "SECRETARIAT" || role === "ROOT_ADMIN";
}

export const RESULT_REQUIREMENTS = {
  SUMMARY: "Ringkasan hasil",
  ATTACHMENT: "Ringkasan dan lampiran",
  OUTGOING_LETTER: "Surat Keluar yang sudah terbit",
} as const;

export type ResultRequirement = keyof typeof RESULT_REQUIREMENTS;

export function resultRequirement(value: unknown): ResultRequirement {
  if (value === undefined || value === "SUMMARY") return "SUMMARY";
  if (value === "ATTACHMENT" || value === "OUTGOING_LETTER") return value;
  throw new Error("Jenis hasil disposisi tidak valid.");
}

export const PURGE_CONFIRMATION = "HAPUS PERMANEN";

export const NOTA_DIRECTORS = ["DIRECTOR_OPS", "PRESIDENT_DIRECTOR"] as const;

export function isNotaDirector(role: Role) {
  return NOTA_DIRECTORS.some(director => director === role);
}

export function canRequestNotaDraft(role: Role) {
  return role === "MANAGER" || isNotaDirector(role);
}

export function canReceiveDirectorNota(sender: Role, recipient: Role) {
  return ["MANAGER", "STAFF", "FINANCE", "SECRETARIAT"].includes(recipient) ||
    (sender === "PRESIDENT_DIRECTOR" && recipient === "DIRECTOR_OPS");
}

export type LetterHistoryEntry = {
  id: string;
  action: string;
  actor_name: string;
  actor_role: Role;
  created_at: string | Date;
  from_status: string | null;
  to_status: string | null;
  comment: string | null;
};

const letterActions: Record<string, string> = {
  RECEIVE_INCOMING: "Diserahkan ke Sekretariat",
  REGISTER_INCOMING: "Surat Diregistrasi",
  CREATE_OUTGOING: "Draft Dibuat",
  CREATE_INTERNAL: "Nota Dinas Dibuat",
  SEND_NOTA_REPLY: "Balasan Nota Dinas Dikirim",
  SEND_NOTA_DIRECT: "Nota Dinas Direksi Dikirim",
  HANDOFF_NOTA_DRAFT: "Draf diserahkan ke pengirim",
  SUBMIT: "Diajukan",
  APPROVE: "Disetujui & Diteruskan",
  APPROVE_FINAL: "Disetujui / Selesai",
  UNDO_APPROVAL: "Persetujuan dibatalkan",
  RETURN: "Dikembalikan",
  RETURN_PREVIOUS: "Kembali satu tingkat",
  REJECT: "Ditolak",
  PREPARE_ISSUE: "Nomor difinalisasi",
  MEKARI_PDF_READY: "PDF tanda tangan tersedia",
  ISSUE: "Diterbitkan",
  MARK_SENT: "Pengiriman dicatat",
  CANCEL: "Dibatalkan",
  COMPLETE: "Diselesaikan",
  RESPONSE: "Tanggapan",
  GENERATE_NOTA_PDF: "PDF Nota Dinas dibuat",
  GENERATE_OUTGOING_PDF: "PDF Surat Keluar dibuat",
  DECLARE_NOTA_SIGNED: "Tanda tangan dicatat oleh pengirim",
  RESET_NOTA_SIGNATURE: "Nota Dinas ditandai belum ditandatangani",
  UPLOAD_OUTGOING_SIGNATURE: "PDF Surat Keluar bertanda tangan diunggah",
  UPLOAD_NOTA_SIGNATURE: "PDF bertanda tangan diunggah",
  ASSIGN_NOTA_SIGNATURE: "Bantuan tanda tangan diperbarui",
  UPDATE_INVOICE_PAYMENT_MODE: "Jenis pembayaran invoice diperbarui",
  REVIEW_INVOICE_PAYMENT_MODE: "Jenis pembayaran invoice disetujui ulang",
  IMPORT_LEGACY_EXCEL: "Diimpor dari Excel Lama",
};

export function letterActionLabel(action: string, resultingStatus?: string | null) {
  if (action === "APPROVE" && resultingStatus === "APPROVED") return "Disetujui";
  return letterActions[action] || action.replace(/_/g, " ");
}

export function letterDirectionLabel(direction: string) {
  if (direction === "INCOMING") return "Surat Masuk";
  if (direction === "OUTGOING") return "Surat Keluar";
  if (direction === "INTERNAL") return "Nota Dinas";
  return "Dokumen";
}

export function formatLetterFileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? (bytes / 1024).toFixed(0) + " KB"
    : (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

const dispositionActions: Record<string, string> = {
  CREATE: "Disposisi dibuat",
  SEEN: "Dilihat",
  START: "Mulai ditindaklanjuti",
  SUBMIT_RESULT: "Hasil dikirim",
  APPROVE_RESULT: "Hasil disetujui",
  RETURN_RESULT: "Hasil dikembalikan",
  RETURN_TASK: "Disposisi dikembalikan",
  REASSIGN_TASK: "Disposisi ditugaskan ulang",
  ROUTE_REVIEW_DIROPS: "Hasil diarahkan ke review Dirops",
  CANCEL_TASK: "Disposisi dibatalkan",
};

export function dispositionActionLabel(action: string) {
  return dispositionActions[action] || action.replace(/_/g, " ");
}
