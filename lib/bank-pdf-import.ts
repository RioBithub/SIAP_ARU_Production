import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { getCurrentUser } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { bankImportKind, type BankImportKind } from "@/lib/bank-import-kind";
import { BankWriteError, bankWriteStatus, withBankAccountWrite } from "@/lib/bank-write";
import { parseBriStatementText, type BriStatementTransaction, type ParsedBriStatement } from "@/lib/bri-statement-parser";
import { parseMandiriStatementText } from "@/lib/mandiri-statement-parser";
import { db } from "@/lib/db";
import { extractPdfText } from "@/lib/pdf-text";
import { canEditFinance } from "@/lib/permissions";
import { deleteStoredFile, MAX_FILE_BYTES, saveUpload } from "@/lib/upload";

type BankPdfTransaction = BriStatementTransaction & { reference_no?: string | null };
type BankPdf = Omit<ParsedBriStatement, "transactions"> & { transactions: BankPdfTransaction[] };
const sourceFormats = { BRI: "BRI_IBBIZ_PDF", MANDIRI: "MANDIRI_ACCOUNT_STATEMENT_PDF" };
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

export async function importBankPdf(request: Request, bank: BankImportKind) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  if (!canEditFinance(user.role)) return NextResponse.json({ ok: false, error: "Hanya Finance dan Root Admin yang dapat mengimpor." }, { status: 403 });

  let saved: Awaited<ReturnType<typeof saveUpload>> | null = null;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !/\.pdf$/i.test(file.name)) throw new Error(`Pilih PDF rekening koran ${bank}.`);
    if (!file.size || file.size > MAX_FILE_BYTES) throw new Error("Ukuran PDF harus antara 1 byte dan 10 MB.");
    const text = await extractPdfText(file);
    const parsed: BankPdf = bank === "BRI" ? parseBriStatementText(text) : parseMandiriStatementText(text);
    const requested = String(form.get("account_id") ?? "").trim();
    let accountId = requested;
    if (!accountId) {
      const [accounts] = await db.query<RowDataPacket[]>("SELECT id,bank_name,account_number FROM siap_bank_accounts WHERE is_active=1");
      const matches = accounts.filter(account => bankImportKind(account.bank_name) === bank && digits(account.account_number) === parsed.account_number);
      if (!matches.length) throw new Error(`Rekening ${bank} dari PDF belum terdaftar di SIAP.`);
      if (matches.length > 1) throw new Error("Ada lebih dari satu rekening yang cocok. Pilih rekening tujuan.");
      accountId = String(matches[0].id);
    }
    const fileHash = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
    const batchId = randomUUID();
    const documentId = randomUUID();

    const result = await withBankAccountWrite(user.role, accountId, async (conn, account) => {
      if (bankImportKind(account.bank_name) !== bank || digits(account.account_number) !== parsed.account_number) {
        throw new Error("Bank atau nomor rekening PDF tidak sesuai dengan rekening tujuan.");
      }
      if (parsed.currency && parsed.currency.toUpperCase() !== String(account.currency).toUpperCase()) {
        throw new Error("Valuta PDF tidak sama dengan valuta rekening tujuan.");
      }
      const [[existing]] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM siap_bank_import_batches WHERE bank_account_id=? AND file_hash=? AND status='ACTIVE' LIMIT 1`,
        [accountId, fileHash],
      );
      if (existing) throw new BankWriteError("PDF yang sama sudah pernah diimpor untuk rekening ini.", 409);
      const upload = await saveUpload(file, "ADDITIONAL");
      saved = upload;

      await conn.execute(
        `INSERT INTO siap_bank_documents
         (id,bank_account_id,document_date,period_from,period_to,document_kind,description,original_name,stored_name,storage_path,mime_type,original_size,stored_size,is_compressed,uploaded_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [documentId,accountId,parsed.statement_date,parsed.period_from,parsed.period_to,`REKENING_KORAN_${bank}`,
         `Rekening koran ${bank} ${parsed.period_from} s.d. ${parsed.period_to}`,
         upload.originalName,upload.storedName,upload.storagePath,upload.mimeType,upload.originalSize,upload.storedSize,Number(upload.isCompressed),user.id],
      );
      await conn.execute(
        `INSERT INTO siap_bank_import_batches
         (id,bank_account_id,source_bank,source_format,parser_version,original_name,file_hash,statement_date,period_from,period_to,
          statement_opening_balance,statement_closing_balance,total_debit,total_credit,source_transaction_count,source_document_id,
          parse_warnings_json,parsed_json,status,created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`,
        [batchId,accountId,bank,sourceFormats[bank],"1.0",upload.originalName,fileHash,parsed.statement_date,parsed.period_from,parsed.period_to,
         parsed.opening_balance,parsed.closing_balance,parsed.total_debit,parsed.total_credit,parsed.transactions.length,documentId,
         JSON.stringify(parsed.warnings),JSON.stringify(parsed),user.id],
      );
      const fingerprints = parsed.transactions.map(tx => tx.fingerprint);
      const seen = new Set<string>();
      for (let start = 0; start < fingerprints.length; start += 1000) {
        const [matches] = await conn.query<RowDataPacket[]>(
          "SELECT external_fingerprint FROM siap_bank_transactions WHERE bank_account_id=? AND external_fingerprint IN (?)",
          [accountId, fingerprints.slice(start, start + 1000)],
        );
        for (const row of matches) seen.add(String(row.external_fingerprint));
      }
      let inserted = 0;
      let duplicates = 0;
      for (const [index, tx] of parsed.transactions.entries()) {
        if (seen.has(tx.fingerprint)) {
          duplicates++;
          continue;
        }
        await conn.execute(
          `INSERT INTO siap_bank_transactions
           (id,bank_account_id,import_batch_id,source_row_no,external_fingerprint,transaction_at,description,teller_id,reference_no,
            debit_amount,credit_amount,source_balance_after,status,created_by,updated_by)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`,
          [randomUUID(),accountId,batchId,index+1,tx.fingerprint,tx.transaction_at,tx.description,tx.teller_id,tx.reference_no ?? null,
           tx.debit_amount,tx.credit_amount,tx.balance_after,user.id,user.id],
        );
        seen.add(tx.fingerprint);
        inserted++;
      }
      await conn.execute("UPDATE siap_bank_import_batches SET inserted_count=?,duplicate_count=? WHERE id=?",
        [inserted, duplicates, batchId]);
      await auditLog({
        user, action: `BANK_${bank}_PDF_IMPORT`, entityType: "BANK_IMPORT", entityId: batchId, request,
        metadata: { accountId, sourceBank: bank, periodFrom: parsed.period_from, periodTo: parsed.period_to,
          inserted, duplicates, openingBalance: parsed.opening_balance, closingBalance: parsed.closing_balance },
      }, conn);
      return { inserted, duplicates };
    });
    saved = null;
    return NextResponse.json({ ok: true, data: {
      id: batchId, source_bank: bank, account_id: accountId, account_number: parsed.account_number,
      statement_date: parsed.statement_date, period_from: parsed.period_from, period_to: parsed.period_to,
      opening_balance: parsed.opening_balance, closing_balance: parsed.closing_balance,
      total_debit: parsed.total_debit, total_credit: parsed.total_credit,
      source_transaction_count: parsed.transactions.length, inserted_count: result.inserted, duplicate_count: result.duplicates,
      warnings: parsed.warnings,
    } }, { status: 201 });
  } catch (error) {
    const uncommitted = saved as Awaited<ReturnType<typeof saveUpload>> | null;
    if (uncommitted) await deleteStoredFile(uncommitted.storagePath).catch(() => {});
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : `Impor PDF ${bank} gagal.` },
      { status: bankWriteStatus(error) });
  }
}
