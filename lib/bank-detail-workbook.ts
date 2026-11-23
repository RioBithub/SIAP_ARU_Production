import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { bankImportKind } from "./bank-import-kind";

const MAX_ROWS = 10_000;
const clean = (value: unknown) => String(value ?? "").trim();
const heading = (value: unknown) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
const columnNames = [
  ["TANGGAL", "TGL", "DATE"],
  ["KETERANGAN", "URAIAN", "DESCRIPTION"],
  ["NOBUKTI", "NOMORBUKTI", "BUKTI", "REFERENCE", "REFERENSI"],
  ["DEBET", "DEBIT"],
  ["KREDIT", "CREDIT"],
  ["SALDO", "BALANCE"],
];

export function isBankDetailDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateText(value: unknown, date1904: boolean) {
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value, { date1904 });
    return date ? [date.y, date.m, date.d].map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0")).join("-") : "";
  }
  const input = clean(value);
  const local = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(input);
  return local ? `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}` : input;
}

function amount(value: unknown, row: number, blankIsZero = false) {
  let input = clean(value);
  if (blankIsZero && (input === "" || input === "-")) return 0;
  if (typeof value === "string") {
    input = input.replace(/^\((.+)\)$/, "-$1").replace(/\s+/g, "");
    if (/^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(input) || /^-?\d+,\d{1,2}$/.test(input)) {
      input = input.replace(/\./g, "").replace(",", ".");
    } else if (/^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(input)) {
      input = input.replace(/,/g, "");
    }
  }
  const parsed = Number(input);
  const cents = Math.round(parsed * 100);
  if (input === "" || !/^-?\d+(\.\d+)?$/.test(input) || !Number.isSafeInteger(cents) || Math.abs(parsed * 100 - cents) > 0.0001) {
    throw new Error(`Nominal di baris ${row} tidak valid.`);
  }
  return cents;
}

export function parseBankDetailWorkbook(bytes: Buffer) {
  const workbook = XLSX.read(bytes, { type: "buffer", sheetRows: MAX_ROWS + 1, cellText: false });
  const tables = workbook.SheetNames.flatMap(name => {
    const sheet = workbook.Sheets[name];
    const source = sheet["!fullref"] || sheet["!ref"];
    if (!source) return [];
    const range = XLSX.utils.decode_range(source);
    // Edit- or print-generated empty areas can extend the used columns.
    range.e.c = Math.min(31, range.e.c);
    range.s.c = 0;
    const limit = range.e.r - range.s.r + 1;
    range.e.r = Math.min(range.e.r, range.s.r + MAX_ROWS - 1);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, range });
    const header = rows.slice(0, 50).findIndex(row =>
      columnNames.every(names => row.some(cell => names.includes(heading(cell)))),
    );
    return header < 0 ? [] : [{ rows, header, lineOffset: range.s.r + 1, limit }];
  });
  if (tables.length !== 1) throw new Error("Gunakan satu tabel Laporan Buku Bank dengan kolom Tanggal, Keterangan, No. Bukti, Debet, Kredit, dan Saldo.");
  const { rows, header, lineOffset, limit } = tables[0];
  if (limit > MAX_ROWS) throw new Error("Excel maksimal 10.000 baris per unggahan.");
  const tabHeader = rows[header].map(heading);
  const columns = columnNames.map(names => tabHeader.findIndex(cell => names.includes(cell)));
  const preface = rows.slice(0, header).flat().map(clean).join("\n");
  const bank = bankImportKind(preface);
  const account = /\b(?:NO\.?\s*)?(?:REK(?:ENING)?|ACCOUNT\s*(?:NO\.?|NUMBER))\s*[:#=]?\s*([\d.-]+(?:[ \t]+[\d.-]+)*)/i.exec(preface);
  const accountNumber = account?.[1].replace(/\D/g, "") ?? "";
  if (!bank || accountNumber.length < 5) throw new Error("Cantumkan BRI atau Mandiri serta nomor REK pada bagian atas Excel.");

  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  const records: { date: string; description: string; proof: string | null; debit: number; credit: number; balance: number; line: number }[] = [];
  let opening: { date: string; balance: number } | undefined;
  let closing: { date: string; balance: number; debit: number; credit: number } | undefined;
  for (const [index, row] of rows.entries()) {
    if (index <= header) continue;
    const line = lineOffset + index;
    const [rawDate, rawDescription, rawProof, debit, credit, balance] = columns.map(column => row[column]);
    const date = dateText(rawDate, date1904);
    const description = clean(rawDescription);
    const proof = clean(rawProof) || null;
    if (!isBankDetailDate(date)) {
      if (/^\d[\d/-]*$/.test(date) || (date && proof)) throw new Error(`Tanggal di baris ${line} tidak valid.`);
      continue;
    }
    if (!proof && records.length === 0 && /\bSALDO\b/i.test(description)) {
      opening = { date, balance: amount(balance, line) };
      continue;
    }
    if (!proof && /\b(?:TOTAL|JUMLAH)\b/i.test(description)) {
      closing = { date, balance: amount(balance, line), debit: amount(debit, line, true), credit: amount(credit, line, true) };
      break;
    }
    if (!description || description.length > 2000 || (proof && proof.length > 150)) throw new Error(`Keterangan atau nomor bukti di baris ${line} tidak valid.`);
    const debitCents = amount(debit, line, true);
    const creditCents = amount(credit, line, true);
    if (debitCents < 0 || creditCents < 0 || debitCents + creditCents === 0) throw new Error(`Mutasi di baris ${line} tidak valid.`);
    records.push({ date, description, proof, debit: debitCents, credit: creditCents, balance: amount(balance, line), line });
  }
  if (!opening || !closing || !records.length) throw new Error("Excel harus memuat saldo awal, transaksi, dan baris total bertanggal.");
  const start = opening;
  const end = closing;
  let previous = start.balance;
  let debitIncreases = true;
  let debitDecreases = true;
  let debitTotal = 0;
  let creditTotal = 0;
  const occurrences = new Map<string, number>();
  const details = records.map(record => {
    if (record.date < start.date || record.date > end.date) throw new Error(`Tanggal baris ${record.line} di luar periode Excel.`);
    const movement = record.debit - record.credit;
    debitIncreases &&= record.balance - previous === movement;
    debitDecreases &&= previous - record.balance === movement;
    if (!debitIncreases && !debitDecreases) throw new Error(`Saldo di baris ${record.line} tidak cocok dengan debet dan kredit.`);
    previous = record.balance;
    debitTotal += record.debit;
    creditTotal += record.credit;
    const identity = JSON.stringify([record.date, (record.proof || record.description).toUpperCase().replace(/\s+/g, " "),
      record.debit, record.credit, record.proof ? null : record.balance]);
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    const fingerprint = createHash("sha256").update(JSON.stringify([identity, occurrence])).digest("hex");
    return { ...record, fingerprint };
  });
  if (debitTotal !== end.debit || creditTotal !== end.credit || previous !== end.balance) {
    throw new Error("Jumlah debet, kredit, atau saldo akhir tidak cocok dengan baris total Excel.");
  }
  return { bank, accountNumber, from: start.date, to: end.date, details, debitIncreases };
}
