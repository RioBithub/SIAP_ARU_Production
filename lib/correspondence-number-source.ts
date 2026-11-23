export const NOTA_NUMBER_CODES = ["UMUM", "OPS", "DIR"] as const;

export type NumberSourceSettings = { source: "SIAP" | "SHEETS"; sheetUrl: string };
export type RegisterNumber = { seq_base: number; variant: number; letter_date: string | null };
