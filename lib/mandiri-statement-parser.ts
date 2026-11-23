import { createHash } from "node:crypto";
import type { BriStatementTransaction, ParsedBriStatement } from "@/lib/bri-statement-parser";

const datePattern = "(\\d{1,2} [A-Za-z]{3} \\d{4})";
const months = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");
const amountPattern = "-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d{2}";
const invalidLayout = () => new Error("Format tabel PDF Mandiri tidak terbaca lengkap. Gunakan PDF Account Statement asli dari Mandiri.");

function date(value: string) {
  const [day, month, year] = value.split(" ");
  const monthNo = months.indexOf(month.toUpperCase()) + 1;
  const iso = `${year}-${String(monthNo).padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(iso + "T00:00:00Z");
  if (!monthNo || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== iso) throw invalidLayout();
  return iso;
}

function cents(value?: string) {
  if (!value || !new RegExp(`^${amountPattern}$`).test(value)) throw invalidLayout();
  const amount = Number(value.replace(/[,.]/g, ""));
  if (!Number.isSafeInteger(amount)) throw invalidLayout();
  return amount;
}

function summaryRow(lines: string[], label: RegExp) {
  const index = lines.findIndex(line => label.test(line));
  if (index < 0) throw invalidLayout();
  return (lines.slice(index + 1).find(line => line.trim()) || "").trim().split(/\s{2,}/);
}

type MandiriTransaction = BriStatementTransaction & { reference_no: string | null };

function parsePage(page: string) {
  const lines = page.split("\n");
  const header = lines.findIndex(line => /Posting Date\s+Remark\s+Reference No\.\s+Debit\s+Credit\s+Balance/i.test(line));
  if (header < 0) return [];
  const labels = lines[header];
  const remark = labels.search(/Remark/i);
  const reference = labels.search(/Reference No\./i);
  const debit = labels.search(/Debit/i);
  const credit = labels.search(/Credit/i);
  const balance = labels.search(/Balance/i);
  const amountStart = Math.floor((reference + "Reference No.".length + debit) / 2);
  const debitEnd = (debit + 5 + credit + 6) / 2;
  const creditEnd = (credit + 6 + balance + 7) / 2;

  return lines.slice(header + 1).join("\n").split(/\n(?:[ \t]*\n)+/).flatMap(block => {
    const row = block.split("\n");
    const left = row.map(line => line.slice(0, remark).trim()).join(" ");
    const dates = [...left.matchAll(new RegExp(datePattern + ",?\\s+(\\d{2}:\\d{2}:\\d{2})", "g"))];
    if (!left.trim() && !row.some(line => new RegExp(amountPattern).test(line.slice(amountStart)))) return [];
    if (dates.length !== 1 || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(dates[0][2])) throw invalidLayout();

    const amounts: number[][] = [[], [], []];
    for (const line of row) {
      for (const cell of line.slice(amountStart).matchAll(new RegExp(amountPattern, "g"))) {
        const end = amountStart + cell.index + cell[0].length;
        amounts[end <= debitEnd ? 0 : end <= creditEnd ? 1 : 2].push(cents(cell[0]));
      }
    }
    if (amounts.some(column => column.length !== 1)) throw invalidLayout();
    const [[debitValue], [creditValue], [balanceValue]] = amounts;
    const description = row.map(line => line.slice(remark, reference).trim()).filter(Boolean).join(" ");
    const referenceNo = row.map(line => line.slice(reference, amountStart).trim()).filter(part => part && part !== "-").join(" ");
    if (!description || description.length > 500 || referenceNo.length > 120 ||
        debitValue < 0 || creditValue < 0 || (debitValue > 0) === (creditValue > 0)) throw invalidLayout();
    return [{
      transaction_at: `${date(dates[0][1])} ${dates[0][2]}`, description, reference_no: referenceNo || null,
      debitValue, creditValue, balanceValue,
    }];
  });
}

export function parseMandiriStatementText(raw: string): ParsedBriStatement & { transactions: MandiriTransaction[] } {
  const text = raw.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
  if (!/^Account Statement\s*$/mi.test(text) || !/Account Statement Summary/i.test(text)) throw invalidLayout();
  const first = text.split("\f")[0].split("\n");
  const [account] = summaryRow(first, /^\s*Account No\.\s+Account Name/i);
  const [period, currency] = summaryRow(first, /^\s*Period\s+Currency/i);
  const [opening, countDebit, totalDebit] = summaryRow(first, /^\s*Opening Balance\s+No\. of Debit/i);
  const [closing, countCredit, totalCredit] = summaryRow(first, /^\s*Closing Balance\s+No\. of Credit/i);
  const created = text.match(new RegExp("^Created " + datePattern, "mi"));
  const dates = period?.match(new RegExp(`^${datePattern}\\s*-\\s*${datePattern}$`));
  if (!/^\d{8,30}$/.test(account) || !/^[A-Z]{3}$/.test(currency) || !created || !dates ||
      !/^\d+$/.test(countDebit) || !/^\d+$/.test(countCredit)) throw invalidLayout();
  const periodFrom = date(dates[1]);
  const periodTo = date(dates[2]);
  const statementDate = date(created[1]);
  if (periodFrom > periodTo) throw invalidLayout();

  const openingValue = cents(opening);
  const closingValue = cents(closing);
  const debitTotal = cents(totalDebit);
  const creditTotal = cents(totalCredit);
  // The footer and page break can follow a wrapped remark. Keep each page's column positions.
  const rows = text.split("\f").flatMap(page => parsePage(page.replace(/^.*\bPage \d+ of \d+\s*$/gmi, "")));
  let balanceValue = openingValue;
  let debitSum = 0;
  let creditSum = 0;
  let previous = "";
  const fingerprints = new Set<string>();
  const mismatch = () => new Error("Jumlah transaksi, total debit/kredit, atau saldo Mandiri tidak cocok dengan PDF. Impor dibatalkan.");
  const transactions = rows.map(({ debitValue, creditValue, balanceValue: officialBalance, ...row }) => {
    const day = row.transaction_at.slice(0, 10);
    if (day < periodFrom || day > periodTo || row.transaction_at < previous) throw mismatch();
    previous = row.transaction_at;
    debitSum += debitValue;
    creditSum += creditValue;
    balanceValue += creditValue - debitValue;
    if (balanceValue !== officialBalance) throw mismatch();
    const fingerprint = createHash("sha256").update(
      JSON.stringify(["MANDIRI", account, row.transaction_at, debitValue, creditValue, officialBalance,
        row.reference_no?.replace(/\s/g, "").toUpperCase() || ""]),
    ).digest("hex");
    if (fingerprints.has(fingerprint)) throw mismatch();
    fingerprints.add(fingerprint);
    return { ...row, teller_id: null, debit_amount: debitValue / 100, credit_amount: creditValue / 100,
      balance_after: officialBalance / 100, fingerprint };
  });
  if (rows.filter(row => row.debitValue > 0).length !== Number(countDebit) ||
      rows.filter(row => row.creditValue > 0).length !== Number(countCredit) ||
      debitSum !== debitTotal || creditSum !== creditTotal || balanceValue !== closingValue) throw mismatch();
  return {
    account_number: account, statement_date: statementDate, period_from: periodFrom, period_to: periodTo,
    product_name: null, currency, opening_balance: openingValue / 100, closing_balance: closingValue / 100,
    total_debit: debitTotal / 100, total_credit: creditTotal / 100, transactions, warnings: [],
  };
}
