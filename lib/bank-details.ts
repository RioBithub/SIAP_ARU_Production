import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { auditLog } from "@/lib/audit";
import { bankImportKind } from "@/lib/bank-import-kind";
import { isBankDetailDate, parseBankDetailWorkbook } from "@/lib/bank-detail-workbook";
import { BankWriteError, withBankAccountWrite } from "@/lib/bank-write";
import { withTransaction } from "@/lib/db";
import type { SessionUser } from "@/lib/types";
import { deleteStoredFile, MAX_FILE_BYTES, saveUpload } from "@/lib/upload";

const amountKey = (date: string, debit: number, credit: number) =>
  `${date}:${Math.round(debit * 100)}:${Math.round(credit * 100)}`;

export async function getBankDetails(accountId: string, from: string, to: string) {
  if (!accountId || !isBankDetailDate(from) || !isBankDetailDate(to) || from > to) {
    throw new BankWriteError("Pilih rekening dan rentang tanggal yang valid.", 400);
  }
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) {
    throw new BankWriteError("Tampilkan maksimal satu tahun per laporan.", 400);
  }
  return withTransaction(async conn => {
    const [[account]] = await conn.query<RowDataPacket[]>(
      "SELECT id,bank_name,account_number,account_name,currency,finance_locked FROM siap_bank_accounts WHERE id=? AND is_active=1", [accountId]);
    if (!account || !bankImportKind(account.bank_name)) throw new BankWriteError("Pilih rekening BRI atau Mandiri yang aktif.", 404);

    const [details] = await conn.query<RowDataPacket[]>(
      `SELECT CAST(d.id AS CHAR) id,DATE_FORMAT(d.entry_date,'%Y-%m-%d') entry_date,d.description,d.proof_no,
              d.debit_amount,d.credit_amount,d.balance,d.gl_debit_increases,b.original_name
       FROM siap_bank_detail_rows d JOIN siap_bank_detail_imports b ON b.id=d.import_id
       WHERE d.bank_account_id=? AND d.entry_date BETWEEN ? AND ? ORDER BY d.entry_date,d.id LIMIT 10001`, [accountId, from, to]);
    if (details.length > 10000) throw new BankWriteError("Terlalu banyak baris. Pilih rentang tanggal yang lebih pendek.", 400);

    const [transactions] = await conn.query<RowDataPacket[]>(
      `SELECT id,DATE_FORMAT(transaction_at,'%Y-%m-%d') entry_date,description,debit_amount,credit_amount,
              IF(import_batch_id IS NULL, 'Input manual', 'Impor PDF') source
       FROM siap_bank_transactions WHERE bank_account_id=? AND status='ACTIVE'
       AND transaction_at>=? AND transaction_at<DATE_ADD(?, INTERVAL 1 DAY)
       ORDER BY transaction_at,id`, [accountId, from, to]);
    const keyForDetail = (row: RowDataPacket) => amountKey(row.entry_date,
      Number(row.gl_debit_increases) ? row.credit_amount : row.debit_amount,
      Number(row.gl_debit_increases) ? row.debit_amount : row.credit_amount);
    const detailCounts = new Map<string, number>();
    const transactionMatches = new Map<string, RowDataPacket[]>();
    for (const row of details) {
      const key = keyForDetail(row);
      detailCounts.set(key, (detailCounts.get(key) ?? 0) + 1);
    }
    for (const row of transactions) {
      const key = amountKey(row.entry_date, row.debit_amount, row.credit_amount);
      const matches = transactionMatches.get(key) ?? [];
      matches.push(row);
      transactionMatches.set(key, matches);
    }

    const [imports] = await conn.query<RowDataPacket[]>(
      `SELECT id,original_name,document_id,inserted_count,duplicate_count,
              DATE_FORMAT(period_from,'%Y-%m-%d') period_from,DATE_FORMAT(period_to,'%Y-%m-%d') period_to
       FROM siap_bank_detail_imports WHERE bank_account_id=? AND period_from<=? AND period_to>=?
       ORDER BY created_at DESC,id DESC LIMIT 100`, [accountId, to, from]);

    return { account, imports, rows: details.map(row => {
      const key = keyForDetail(row);
      const matches = transactionMatches.get(key);
      const transaction = matches?.length === 1 && detailCounts.get(key) === 1 ? matches[0] : null;
      return {
        id: String(row.id), entry_date: String(row.entry_date), description: String(row.description),
        proof_no: row.proof_no as string | null, debit_amount: Number(row.debit_amount), credit_amount: Number(row.credit_amount),
        balance: Number(row.balance), original_name: String(row.original_name),
        transaction, status: transaction ? "LINKED" : matches?.length ? "AMBIGUOUS" : "UNMATCHED",
      };
    }) };
  });
}

export async function importBankDetails(user: SessionUser, accountId: string, file: File, request: Request) {
  const extension = /\.(xls|xlsx)$/i.exec(file.name)?.[1].toLowerCase();
  if (!extension || !file.size || file.size > MAX_FILE_BYTES) throw new BankWriteError("Pilih berkas .xls atau .xlsx berukuran maksimal 10 MB.", 400);
  const buffer = Buffer.from(await file.arrayBuffer());
  if (extension === "xls" ? !buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))
    : !buffer.subarray(0, 4).equals(Buffer.from("504b0304", "hex"))) {
    throw new BankWriteError("Isi berkas tidak sesuai dengan format Excel.", 400);
  }
  const parsed = parseBankDetailWorkbook(buffer);
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const uploadState: { storedPath?: string } = {};

  try {
    return await withBankAccountWrite(user.role, accountId, async (conn, account) => {
      if (bankImportKind(account.bank_name) !== parsed.bank || String(account.account_number).replace(/\D/g, "") !== parsed.accountNumber) {
        throw new BankWriteError("Bank dan nomor rekening di Excel harus sama dengan rekening yang dipilih.", 400);
      }
      const [[previous]] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM siap_bank_detail_imports WHERE bank_account_id=? AND file_hash=?", [accountId, fileHash]);
      if (previous) return { inserted: 0, duplicates: parsed.details.length, from: parsed.from, to: parsed.to };

      const existing = new Set<string>();
      for (let start = 0; start < parsed.details.length; start += 500) {
        const keys = parsed.details.slice(start, start + 500).map(row => row.fingerprint);
        const [rows] = await conn.query<RowDataPacket[]>(
          "SELECT fingerprint FROM siap_bank_detail_rows WHERE bank_account_id=? AND fingerprint IN (?)", [accountId, keys]);
        for (const row of rows) existing.add(row.fingerprint);
      }
      const freshRows = parsed.details.filter(row => !existing.has(row.fingerprint));
      const result = { inserted: freshRows.length, duplicates: existing.size, from: parsed.from, to: parsed.to };
      if (!freshRows.length) return result;

      const upload = await saveUpload(file, "ADDITIONAL");
      uploadState.storedPath = upload.storagePath;
      const documentId = randomUUID();
      const importId = randomUUID();
      await conn.execute(
        `INSERT INTO siap_bank_documents
         (id,bank_account_id,document_date,period_from,period_to,document_kind,description,original_name,stored_name,storage_path,
          mime_type,original_size,stored_size,is_compressed,uploaded_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [documentId, accountId, parsed.to, parsed.from, parsed.to, "RINCIAN_REKENING_KORAN",
         "Laporan Buku Bank " + parsed.bank, upload.originalName, upload.storedName, upload.storagePath,
         upload.mimeType, upload.originalSize, upload.storedSize, Number(upload.isCompressed), user.id]);
      await conn.execute(
        `INSERT INTO siap_bank_detail_imports
         (id,bank_account_id,file_hash,document_id,original_name,period_from,period_to,inserted_count,duplicate_count,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`, [importId, accountId, fileHash, documentId, upload.originalName,
         parsed.from, parsed.to, result.inserted, result.duplicates, user.id]);
      for (let start = 0; start < freshRows.length; start += 500) {
        const values = freshRows.slice(start, start + 500).map(row => [
          accountId, importId, row.fingerprint, row.date, row.description, row.proof,
          row.debit / 100, row.credit / 100, row.balance / 100, Number(parsed.debitIncreases),
        ]);
        await conn.query(`INSERT INTO siap_bank_detail_rows
          (bank_account_id,import_id,fingerprint,entry_date,description,proof_no,debit_amount,credit_amount,balance,gl_debit_increases)
          VALUES ?`, [values]);
      }
      await auditLog({ user, action: "BANK_DETAILS_IMPORT", entityType: "BANK_DETAIL_IMPORT", entityId: importId, request,
        metadata: { accountId, bank: parsed.bank, ...result } }, conn);
      return result;
    });
  } catch (cause) {
    if (uploadState.storedPath) await deleteStoredFile(uploadState.storedPath).catch(() => {});
    throw cause;
  }
}
