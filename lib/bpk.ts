import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { AruPdf } from "@/lib/aru-pdf";
import { terbilangRupiah } from "@/lib/bank-statement";
import { BPK_MONEY_FIELDS, BPK_STATUS, BPK_TEXT_FIELDS, rupiah, type BpkFields, type BpkInput, type BpkPayment, type BpkRecord } from "@/lib/bpk-fields";
import { getBusinessDocumentRow } from "@/lib/business-document-data";
import { INVOICE_INCOMING } from "@/lib/business-documents";
import { str } from "@/lib/http";
import { getAccessibleLetter, letterAccess } from "@/lib/letter-access";
import { insertLetterAttachment, type StoredLetterFile } from "@/lib/letter-uploads";
import { canEditFinance } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import { checkedDate, saveProof, v11Letter } from "@/lib/v11-data";
import { canEditPaymentDocuments, invoicePaymentAccess, invoicePaymentMode, paymentInstructionExists } from "@/lib/v11-payment-documents";
import { INVOICE_PAYMENT_MODES, jakartaDate, type InvoicePaymentMode } from "@/lib/v11-workflow";

type Queryable = Pick<PoolConnection, "query">;

function minorUnits(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) return 0n;
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(text)) throw new Error(`${label} harus berupa nominal positif dengan maksimal dua desimal.`);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole + fraction.padEnd(2, "0"));
}

export function bpkNet(details: BpkFields) {
  const amount = minorUnits(details.dpp, BPK_MONEY_FIELDS.dpp) +
    minorUnits(details.ppn, BPK_MONEY_FIELDS.ppn) - minorUnits(details.pph, BPK_MONEY_FIELDS.pph);
  const digits = amount.toString().padStart(3, "0");
  if (amount < 0n || digits.length > 15) throw new Error("Jumlah neto BPK di luar batas.");
  return digits.slice(0, -2) + "." + digits.slice(-2);
}

export function bpkInput(body: Record<string, unknown>, modeOverride?: InvoicePaymentMode): BpkInput {
  const mode = modeOverride ?? body.mode;
  if (mode !== "REGULAR" && mode !== "PERSEKOT") throw new Error("Pilih jenis pengeluaran.");
  const submitted_on = checkedDate(body.submitted_on, "Tanggal pengajuan");
  if (submitted_on > jakartaDate()) throw new Error("Tanggal pengajuan tidak boleh di masa depan.");
  const fields = (body.details || {}) as Record<string, unknown>;
  const details: BpkFields = {};
  for (const [key, [, limit]] of Object.entries(BPK_TEXT_FIELDS)) {
    details[key as keyof BpkFields] = str(fields[key], limit);
  }
  for (const [key, label] of Object.entries(BPK_MONEY_FIELDS)) {
    const amount = String(fields[key] ?? "").trim();
    if (amount) minorUnits(amount, label);
    details[key as keyof BpkFields] = amount;
  }
  if (fields.due_date) details.due_date = checkedDate(fields.due_date, "Tanggal jatuh tempo");
  bpkNet(details);
  return { mode, submitted_on, payee: str(body.payee, 255), expense_post: str(body.expense_post, 160), details };
}

export function checkBpkSubmission(bpk: BpkInput) {
  if (!bpk.payee || !bpk.expense_post || !bpk.details.description || bpkNet(bpk.details) === "0.00") {
    throw new Error("Lengkapi penerima pembayaran, pos, uraian, dan jumlah neto sebelum mengajukan BPK.");
  }
}

export async function bpkInvoice(conn: Queryable, user: SessionUser, id: string, lock = false) {
  const letter = await getAccessibleLetter(user, id, conn, lock);
  if (letter?.document_type !== INVOICE_INCOMING) return null;
  const workflow = await v11Letter(id, conn);
  if (!workflow) return null;
  const business = await getBusinessDocumentRow(id, conn);
  if (!business) return null;
  const mode = invoicePaymentMode(workflow).mode;
  const editable = !["CANCELLED", "REJECTED", "COMPLETED"].includes(letter.status) &&
    !await paymentInstructionExists(conn, id) && (
      (await invoicePaymentAccess(conn, letter, workflow, user))?.editable ||
      await canEditPaymentDocuments(conn, letter, user));
  const spk = business.invoice_spk_id ? await getAccessibleLetter(user, business.invoice_spk_id, conn) : null;
  return { letter, mode, editable: Boolean(editable), invoice_total: String(business.total),
    prefill: {
      submitted_on: jakartaDate(), mode,
      payee: String(letter.sender || ""), expense_post: user.unit_name || "",
      details: {
        description: [letter.subject, letter.external_number && "Invoice " + letter.external_number].filter(Boolean).join("\n"),
        basis: spk?.letter_number ?? spk?.external_number ?? "", due_date: String(business.due_date_text ?? ""),
      },
    } satisfies BpkInput,
  };
}

function bpkScope(user: SessionUser) {
  const access = letterAccess(user);
  return {
    clause: `((b.letter_id IS NOT NULL AND ${access.clause}) OR (b.letter_id IS NULL AND
      (b.created_by=? OR ?=1 OR (?=1 AND b.status<>'DRAFT'))))`,
    params: [...access.params, user.id, Number(user.role === "ROOT_ADMIN"), Number(canEditFinance(user.role))],
  };
}

const bpkQuery = `SELECT b.*,DATE_FORMAT(b.submitted_on,'%Y-%m-%d') AS submitted_on,author.name AS creator_name,
  CASE WHEN v.letter_id IS NOT NULL THEN IF(v.invoice_persekot_reason IS NULL,'REGULAR','PERSEKOT') ELSE b.mode END AS mode,
  l.external_number AS invoice_number,CAST(business.total AS CHAR) AS invoice_total,p.status AS ledger_status
  FROM siap_v11_bpk b JOIN siap_users author ON author.id=b.created_by
  LEFT JOIN siap_letters l ON l.id=b.letter_id LEFT JOIN siap_business_documents business ON business.letter_id=l.id
  LEFT JOIN siap_v11_letters v ON v.letter_id=l.id LEFT JOIN siap_payables p ON p.id=v.payable_id`;

export async function listBpk(conn: Queryable, user: SessionUser, query: string) {
  const scope = bpkScope(user);
  const like = `%${query}%`;
  const [rows] = await conn.query<RowDataPacket[]>(
    bpkQuery + ` WHERE ${scope.clause} AND (?='' OR b.payee LIKE ? OR b.expense_post LIKE ?
      OR b.evidence_number LIKE ? OR b.bpk_number LIKE ? OR l.external_number LIKE ?)
      ORDER BY b.updated_at DESC,b.id DESC LIMIT 120`, [...scope.params, query, like, like, like, like, like],
  );
  return rows.map(row => bpkRecord(row, user));
}

export async function getBpk(conn: Queryable, user: SessionUser, where: { id: string } | { letterId: string }) {
  const scope = bpkScope(user);
  const [[row]] = await conn.query<RowDataPacket[]>(
    bpkQuery + ` WHERE ${"id" in where ? "b.id" : "b.letter_id"}=? AND ${scope.clause}`,
    ["id" in where ? where.id : where.letterId, ...scope.params],
  );
  return row ?? null;
}

export function bpkRecord(row: RowDataPacket, user: SessionUser, payments: BpkPayment[] = []): BpkRecord {
  const details: BpkFields = typeof row.details === "string" ? JSON.parse(row.details) : row.details;
  const { checklist_attachment_id: _attachment, evidence_year: _year, ...record } = row;
  return { ...record, details, payments, net: bpkNet(details), manage: canEditFinance(user.role),
    editable: row.status === "DRAFT" && row.created_by === user.id } as BpkRecord;
}

export async function bpkPayments(conn: Queryable, letterId: string | null) {
  if (!letterId) return [];
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(payment_date,'%Y-%m-%d') AS date,CAST(amount AS CHAR) AS amount,reference
     FROM siap_v11_payments WHERE letter_id=? AND status='APPROVED' ORDER BY payment_date,created_at,id`, [letterId],
  );
  return rows as BpkPayment[];
}

const dateLabel = (date?: string | null) => date?.split("-").reverse().join("/");

export async function renderBpk(record: BpkRecord, type: "BPK" | "SPB") {
  const d = record.details;
  const status = record.ledger_status === "PAID" ? "Terbayar"
    : record.ledger_status === "PARTIAL" ? "Dibayar sebagian" : BPK_STATUS[record.status];
  const [whole, fraction] = record.net.split(".");
  const words = terbilangRupiah(Number(whole)) +
    (Number(fraction) > 0 ? " " + terbilangRupiah(Number(fraction)).replace(/RUPIAH$/, "SEN") : "");
  const pdf = await AruPdf.create(type === "BPK" ? "BUKTI PENGELUARAN KEUANGAN" : "SURAT PERINTAH BAYAR",
    [status, !record.letter_id || type === "SPB" ? INVOICE_PAYMENT_MODES[record.mode] : null,
      record.invoice_number && "Invoice " + record.invoice_number].filter(Boolean).join(" • "));
  pdf.fields([{ label: "Tanggal Pengajuan", value: dateLabel(record.submitted_on) },
    { label: "Nomor Bukti (Accounting)", value: record.evidence_number },
    { label: "Nomor BPK", value: record.bpk_number }]);
  pdf.fields([{ label: type === "SPB" ? "Harap Dibayar Kepada" : "Dibayarkan Kepada", value: record.payee },
    { label: "Yang Menerima", value: d.received_by }, { label: "Pos Pengeluaran", value: record.expense_post }]);
  pdf.section("URAIAN / KEPERLUAN");
  pdf.paragraph(d.description);
  if (d.basis || d.contract_amount || d.due_date) {
    pdf.fields([{ label: "Berdasarkan SPK / Perjanjian / PO", value: d.basis }]);
    pdf.fields([{ label: "Nilai Kontrak", value: d.contract_amount && rupiah(d.contract_amount) },
      { label: "Jatuh Tempo", value: dateLabel(d.due_date) }]);
  }
  if (type === "BPK") {
    pdf.section("RINCIAN NOMINAL");
    pdf.fields([{ label: "Kode Perkiraan", value: d.account_code }, { label: "DPP", value: rupiah(d.dpp) },
      { label: "DPP atas PPN Lainnya", value: d.alternative_dpp && rupiah(d.alternative_dpp) }]);
    pdf.fields([{ label: "PPN", value: [rupiah(d.ppn), d.ppn_description].filter(Boolean).join(" • ") },
      { label: "PPh Dipotong", value: [rupiah(d.pph), d.pph_description].filter(Boolean).join(" • ") }]);
  }
  pdf.fields([{ label: "Jumlah Neto", value: rupiah(record.net) },
    { label: "Terbilang", value: words }]);
  if (d.notes) { pdf.section("KETERANGAN"); pdf.paragraph(d.notes); }
  pdf.fields([{ label: "Bank Penerima", value: d.bank_name },
    { label: "Nomor Rekening", value: d.account_number }, { label: "Atas Nama", value: d.account_name }]);
  pdf.fields([{ label: "Pembuat", value: record.creator_name }]);
  pdf.section("PERSETUJUAN DAN PENERIMAAN");
  const approvers = [{ label: "Direksi", value: d.director }, { label: type === "SPB" ? "Atasan" : "Manager Keuangan", value: d.manager }];
  pdf.signatureLines(type === "SPB" ? approvers : [
    ...approvers, { label: "Pemegang Kas", value: "-" }, { label: "Yang Menerima", value: d.received_by },
  ]);
  if (d.paid_on || record.payments.length) {
    pdf.section("PEMBAYARAN TERCATAT");
    if (d.paid_on) pdf.paragraph([dateLabel(d.paid_on), d.paid_via, rupiah(record.net), d.paid_reference].filter(Boolean).join(" • "));
    for (const payment of record.payments) {
      pdf.paragraph([dateLabel(payment.date), rupiah(payment.amount), payment.reference].join(" • "));
    }
  }
  return pdf.bytes();
}

export async function attachBpk(conn: PoolConnection, user: SessionUser, record: BpkRecord, staged: StoredLetterFile[]) {
  if (!record.letter_id) return;
  const bytes = await renderBpk(record, "BPK");
  const file = await saveProof(new File([new Uint8Array(bytes)], `BPK-Pengajuan-${record.id.slice(0, 8)}.pdf`, { type: "application/pdf" }), true);
  staged.push(file);
  const id = await insertLetterAttachment(conn, record.letter_id, user.id, file, "PAYMENT_DOCUMENT");
  await conn.execute(
    `INSERT INTO siap_v11_payment_documents (letter_id,document_code,attachment_id) VALUES (?,'BPK',?)
     ON DUPLICATE KEY UPDATE attachment_id=VALUES(attachment_id)`, [record.letter_id, id],
  );
  await conn.execute("UPDATE siap_v11_bpk SET checklist_attachment_id=? WHERE id=?", [id, record.id]);
}
