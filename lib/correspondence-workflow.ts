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
