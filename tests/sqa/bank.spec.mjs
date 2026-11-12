import { randomInt } from "node:crypto";
import XLSX from "xlsx";
import { del, expect, multipart, patch, pdfFile, post, samples, test } from "./helpers.mjs";

const base = "/api/finance";
const statements = `${base}/bank-statement`;
const imports = `${statements}/imports`;
const docs = `${base}/bank-documents`;
const accountsPath = `${base}/bank-accounts`;
const transactions = `${base}/bank-transactions`;
const from = "2025-01-01";
const to = "2025-01-31";
const period = (id, start = from, end = to) => `account_id=${id}&from=${start}&to=${end}`;
const bankData = () => ({
  bank_name: "BRI Demo", account_name: "Rekening Fiktif SQA", currency: "IDR",
  account_number: `0000000${randomInt(10_000_000, 99_999_999)}`, opening_balance: 1_000_000,
  opening_balance_date: from,
});

async function bankAccount(api) {
  const data = bankData();
  const { id } = await api("finance", accountsPath, post(data, 201));
  return { id, ...data };
}

function briPDF(number, extra = []) {
  return pdfFile("bri-fiktif-sqa.pdf", [
    "LAPORAN TRANSAKSI FINANSIAL",
    "STATEMENT OF FINANCIAL TRANSACTION",
    `No. Rekening : ${number}`,
    "Tanggal Laporan : 31/01/2025",
    "Periode Transaksi : 01/01/2025 - 31/01/2025",
    "Opening Balance   Total Debit   Total Credit   Closing Balance",
    "1,000,000.00     50,000.00     200,000.00     1,150,000.00",
    "04/01/2025 10:00:00  PENERIMAAN  TL0001  0.00  200,000.00  1,200,000.00",
    "05/01/2025 10:00:00  BIAYA  TL0002  50,000.00  0.00  1,150,000.00",
    ...extra,
  ]);
}

const uploadBri = (api, account, file, status = 201) => api("finance", `${statements}/import-bri`, multipart({
  account_id: account.id, file,
}, status));

test("BNK-01 | Saldo awal, mutasi, saldo akhir, dan periode Rekening Koran", async ({ api }) => {
  const url = `${statements}?${period(samples.bank)}`;
  const full = await api("manager", url);
  expect(full).toMatchObject({ opening_balance: 1_000_000, closing_balance: 1_150_000, total_debit: 50_000, total_credit: 200_000 });
  expect(full.rows.map((row) => row.balance)).toEqual([1_200_000, 1_150_000]);
  expect(full.terbilang).toContain("RUPIAH");
  const partial = await api("manager", `${statements}?${period(samples.bank, "2025-01-05", to)}`);
  expect(partial).toMatchObject({ opening_balance: 1_200_000, closing_balance: 1_150_000, total_debit: 50_000, total_credit: 0 });
  expect(partial.rows).toHaveLength(1);
  await api("staff", url, { expect: 403 });
});

test("BNK-02 | Buat dan ubah master rekening sesuai hak akses", async ({ api }) => {
  const account = await bankAccount(api);
  const revised = { ...account, account_name: "Rekening Fiktif Revisi", opening_balance: 1_500_000 };
  await api("manager", `${accountsPath}/${account.id}`, patch(revised, 403));
  await api("finance", `${accountsPath}/${account.id}`, patch(revised));
  const list = await api("dirops", accountsPath);
  expect(list.find((item) => item.id === account.id)).toMatchObject({ account_name: revised.account_name });
  expect((await api("finance", `${statements}?${period(account.id)}`)).opening_balance).toBe(1_500_000);
});

test("BNK-03 | Tambah, edit, dan batalkan mutasi tanpa mengubah saldo awal", async ({ api }) => {
  const { id: accountId } = await bankAccount(api);
  const row = {
    bank_account_id: accountId, transaction_at: "2025-01-08 10:00:00",
    description: "Mutasi manual fiktif", credit_amount: 50_000, debit_amount: 0,
  };
  await api("finance", transactions, post({ ...row, debit_amount: 50_000 }, 400));
  await api("finance", transactions, post({ ...row, transaction_at: "2024-12-31 10:00:00" }, 400));
  const { id } = await api("finance", transactions, post(row, 201));
  const path = `${transactions}/${id}`;
  const read = () => api("finance", `${statements}?${period(accountId)}`);
  expect((await read()).closing_balance).toBe(1_050_000);
  await api("finance", path, patch({ ...row, credit_amount: 75_000 }));
  expect((await read()).closing_balance).toBe(1_075_000);
  await api("finance", path, del({}, 400));
  await api("finance", path, del({ reason: "Pembatalan simulasi" }));
  expect(await read()).toMatchObject({ rows: [], closing_balance: 1_000_000, opening_balance: 1_000_000 });
});

test("BNK-04 | Ekspor Excel Rekening Koran memuat saldo dan data transaksi", async ({ api }) => {
  const path = `${statements}/export?${period(samples.bank)}`;
  const response = await api.response("manager", path);
  expect(response.headers()["content-disposition"]).toMatch(/attachment;.*\.xlsx/);
  const workbook = XLSX.read(await response.body(), { type: "buffer" });
  expect(workbook.SheetNames).toEqual(["Rekening Koran", "Data Transaksi"]);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Data Transaksi"]);
  expect(rows.map((row) => row.saldo)).toEqual([1_200_000, 1_150_000]);
  expect(XLSX.utils.sheet_to_json(workbook.Sheets["Rekening Koran"], { header: 1 }).flat()).toContain("Saldo Akhir");
  await api.response("staff", path, { expect: 403 });
});

test("BNK-05 | Unggah, unduh, dan hapus Dokumen Bank", async ({ api }) => {
  const file = pdfFile("arsip-bank-fiktif.pdf");
  const { id } = await api("finance", docs, multipart({
    bank_account_id: samples.bank, document_date: to, period_from: from, period_to: to,
    document_kind: "REKENING_KORAN", description: "Dokumen dummy", file,
  }, 201));
  const list = () => api("manager", `${docs}?account_id=${samples.bank}`);
  expect((await list()).find((row) => row.id === id)).toMatchObject({ original_name: file.name, period_from: from, period_to: to });
  const download = `${docs}/${id}/download`;
  expect(await (await api.response("manager", download)).body()).toEqual(file.buffer);
  await api.response("staff", download, { expect: 403 });
  await api("manager", `${docs}/${id}`, del(undefined, 403));
  expect(await api("finance", `${docs}/${id}`, del())).toMatchObject({ deleted: true, file_warning: null });
  await api.response("finance", download, { expect: 404 });
  expect((await list()).some((row) => row.id === id)).toBe(false);
});

test("BNK-06 | Impor PDF BRI sintetis, penolakan berkas salah, dan deduplikasi", async ({ api }) => {
  const account = await bankAccount(api);
  const file = briPDF(account.account_number);
  await uploadBri(api, account, pdfFile("bukan-koran.pdf"), 400);
  await uploadBri(api, account, briPDF("000000000000099"), 400);
  expect(await api("finance", `${imports}?account_id=${account.id}`)).toHaveLength(0);
  const imported = await uploadBri(api, account, file);
  expect(imported).toMatchObject({
    account_id: account.id, opening_balance: 1_000_000, closing_balance: 1_150_000,
    inserted_count: 2, duplicate_count: 0, warnings: [],
  });
  await uploadBri(api, account, file, 409);
  const reprint = await uploadBri(api, account, briPDF(account.account_number, ["Catatan cetak ulang fiktif"]));
  expect(reprint).toMatchObject({ inserted_count: 0, duplicate_count: 2 });
  const result = await api("finance", `${statements}?${period(account.id)}`);
  expect(result.rows).toHaveLength(2);
  expect(result.closing_balance).toBe(1_150_000);
});

test("BNK-07 | Koreksi saldo dan undo impor mempertahankan mutasi manual", async ({ api }) => {
  const account = await bankAccount(api);
  const { id: manualId } = await api("finance", transactions, post({
    bank_account_id: account.id, transaction_at: "2025-01-20 10:00:00", description: "Mutasi manual tetap ada",
    credit_amount: 10_000, debit_amount: 0,
  }, 201));
  const { id } = await uploadBri(api, account, briPDF(account.account_number));
  const path = `${imports}/${id}`;
  const read = () => api("finance", `${statements}?${period(account.id)}`);
  expect((await read()).rows).toHaveLength(3);
  await api("finance", path, patch({ opening_balance: 1_100_000, closing_balance: 1_250_000 }));
  expect(await read()).toMatchObject({ opening_balance: 1_100_000, closing_balance: 1_260_000,
    balance_source: { type: "BRI_IMPORT", import_id: id, official_closing_balance: 1_250_000 } });
  expect(await api("finance", `${path}/undo`, post({ reason: "Ulangi import fiktif" }))).toEqual({ removed_transactions: 2 });
  await api("finance", `${path}/undo`, post({ reason: "Undo kedua" }, 400));
  expect((await api("manager", `${imports}?account_id=${account.id}`))[0]).toMatchObject({ id, status: "UNDONE" });
  const restored = await read();
  expect(restored.rows.map((row) => row.id)).toEqual([manualId]);
  expect(restored.closing_balance).toBe(1_010_000);
});
