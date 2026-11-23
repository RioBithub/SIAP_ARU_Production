export type BankImportKind = "BRI" | "MANDIRI";

export function bankImportKind(bankName: string): BankImportKind | null {
  const name = bankName.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/ +/g, " ").trim();
  if (/\b(?:BRI|BANK RAKYAT INDONESIA)\b/.test(name)) return "BRI";
  if (/\bMANDIRI\b/.test(name) && !/\bSYARIAH\b/.test(name)) return "MANDIRI";
  return null;
}
