import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getBusinessDocumentRow } from "@/lib/business-document-data";
import { db } from "@/lib/db";
import { required } from "@/lib/http";
import { checkedDate, invoiceVerified, officialManager } from "@/lib/v11-data";
import { requirePaymentDocuments } from "@/lib/v11-payment-documents";
import { jakartaDate } from "@/lib/v11-workflow";

type Queryable = Pick<PoolConnection, "query">;

function minorUnits(value: unknown) {
  const amount = String(value ?? "");
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(amount)) throw new Error("Nominal pembayaran tidak valid.");
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole + fraction.padEnd(2, "0"));
}

function decimal(value: bigint) {
  const text = value.toString().padStart(3, "0");
  return text.slice(0, -2) + "." + text.slice(-2);
}

async function readPayable(id: string, conn: Queryable, lock = false) {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT id,CAST(amount AS CHAR) total,CAST(paid_amount AS CHAR) paid,status FROM siap_payables WHERE id=?" +
      (lock ? " FOR UPDATE" : ""), [id],
  );
  if (!rows[0]) throw new Error("Buku utang untuk invoice ini tidak ditemukan.");
  return rows[0];
}

export async function invoicePaymentSummary(payableId: string | null, invoiceTotal: string) {
  if (!payableId) return { total: invoiceTotal, paid: "0.00", outstanding: invoiceTotal, status: "OPEN", payable_id: null };
  const p = await readPayable(payableId, db);
  return {
    total: p.total as string, paid: p.paid as string,
    outstanding: decimal(minorUnits(p.total) - minorUnits(p.paid)),
    status: p.status as string, payable_id: payableId,
  };
}

export async function preparePaymentTask(conn: PoolConnection, letter: RowDataPacket, workflow: RowDataPacket, managerId: string) {
  const manager = await officialManager(conn, managerId);
  if (manager.scope !== "KSU") throw new Error("Instruksi bayar hanya dapat dibuat Manager Keuangan, SDM & Umum.");
  if (letter.status !== "APPROVED" ||
      !await invoiceVerified(conn, letter.id, workflow.invoice_revision, letter.routing_target_user_id)) {
    throw new Error("Invoice harus terverifikasi dan disetujui sebelum pembayaran.");
  }
  await requirePaymentDocuments(conn, letter.id, workflow, letter.document_type);
  const [active] = await conn.query<RowDataPacket[]>(
    `SELECT 1 FROM siap_dispositions d JOIN siap_v11_dispositions v ON v.disposition_id=d.id
     WHERE d.letter_id=? AND v.purpose='INVOICE_PAYMENT'
       AND d.status NOT IN ('COMPLETED','RETURNED','CANCELLED') LIMIT 1`, [letter.id],
  );
  if (active.length) throw new Error("Selesaikan tugas pembayaran yang masih aktif sebelum membuat instruksi baru.");
  if (workflow.payable_id) {
    const p = await readPayable(workflow.payable_id, conn, true);
    if (minorUnits(p.paid) >= minorUnits(p.total)) throw new Error("Invoice sudah lunas.");
    return;
  }

  const invoice = await getBusinessDocumentRow(letter.id, conn);
  if (!invoice?.due_date_text || !invoice.total) throw new Error("Nominal dan jatuh tempo invoice belum lengkap.");
  const [existing] = await conn.query<RowDataPacket[]>(
    "SELECT id FROM siap_payables WHERE invoice_no=? LIMIT 1 FOR UPDATE", [letter.external_number],
  );
  if (existing.length) throw new Error("Nomor invoice sudah ada di buku utang. Rekonsiliasi dengan Finance sebelum membuat instruksi.");
  const id = randomUUID();
  await conn.execute(
    `INSERT INTO siap_payables
      (id,counterparty,invoice_no,invoice_date,due_date,amount,paid_amount,status,notes,created_by,updated_by)
     VALUES (?,?,?,?,?,?,0,'OPEN',?,?,?)`,
    [id, letter.sender, letter.external_number, letter.letter_date, invoice.due_date_text, invoice.total,
      "Invoice masuk SIAP ARU V11", managerId, managerId],
  );
  await conn.execute("UPDATE siap_v11_letters SET payable_id=? WHERE letter_id=?", [id, letter.id]);
}

export async function recordPayment(
  conn: PoolConnection, workflow: RowDataPacket, task: RowDataPacket, actionId: string, evidenceId: string,
  input: Record<string, unknown>,
) {
  const payable = await readPayable(workflow.payable_id, conn, true);
  const amount = minorUnits(input.payment_amount);
  if (amount <= 0n || amount > minorUnits(payable.total) - minorUnits(payable.paid)) {
    throw new Error("Nominal harus lebih dari nol dan tidak melebihi sisa tagihan.");
  }
  const date = checkedDate(input.payment_date, "Tanggal bayar");
  if (date > jakartaDate()) throw new Error("Tanggal bayar tidak boleh di masa depan.");
  const payee = required(input.payment_payee, "Nama penerima", 255);
  const account = required(input.payment_account, "Rekening tujuan", 120);
  const reference = required(input.payment_reference, "Referensi pembayaran", 150);
  const key = reference.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
  const [existing] = await conn.query<RowDataPacket[]>(
    "SELECT 1 FROM siap_v11_payments WHERE letter_id=? AND active_reference=? LIMIT 1", [task.letter_id, key],
  );
  if (existing.length) throw new Error("Referensi pembayaran ini sudah dipakai untuk invoice.");
  const note = required(input.bookkeeping_note, "Catatan pembukuan", 1000);
  await conn.execute(
    `INSERT INTO siap_v11_payments
      (id,letter_id,payable_id,disposition_id,submitted_action_id,amount,payment_date,payee,recipient_account,
       reference,active_reference,bookkeeping_note,evidence_id,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING')`,
    [randomUUID(), task.letter_id, workflow.payable_id, task.id, actionId, decimal(amount), date, payee, account,
      reference, key, note, evidenceId],
  );
}

export async function decidePayment(conn: PoolConnection, task: RowDataPacket, managerId: string, decision: "APPROVED" | "RETURNED" | "CANCELLED") {
  const [payments] = await conn.query<RowDataPacket[]>(
    "SELECT id,payable_id,CAST(amount AS CHAR) amount FROM siap_v11_payments WHERE disposition_id=? AND status='PENDING' FOR UPDATE",
    [task.id],
  );
  if (decision === "CANCELLED" && !payments.length) return;
  if (payments.length !== 1) throw new Error("Satu catatan pembayaran pending wajib tersedia.");
  const p = payments[0];
  if (decision !== "APPROVED") {
    await conn.execute("UPDATE siap_v11_payments SET status=?,active_reference=NULL WHERE id=?", [decision, p.id]);
    return;
  }

  const manager = await officialManager(conn, managerId);
  if (manager.scope !== "KSU" || task.from_user_id !== managerId) throw new Error("ACC pembayaran hanya oleh Manager Keuangan pemberi tugas.");
  const payable = await readPayable(p.payable_id, conn, true);
  const paid = minorUnits(payable.paid) + minorUnits(p.amount);
  const total = minorUnits(payable.total);
  if (paid > total) throw new Error("Total pembayaran melebihi tagihan.");
  await conn.execute("UPDATE siap_v11_payments SET status='APPROVED',approved_by=?,approved_at=UTC_TIMESTAMP() WHERE id=?", [managerId, p.id]);
  await conn.execute("UPDATE siap_payables SET paid_amount=?,status=?,updated_by=? WHERE id=?",
    [decimal(paid), paid === total ? "PAID" : "PARTIAL", managerId, p.payable_id]);
}

export async function requireInvoicePaid(conn: PoolConnection, letterId: string, payableId: string | null) {
  if (!payableId) throw new Error("Invoice belum memiliki catatan bayar yang di-ACC.");
  const p = await readPayable(payableId, conn, true);
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT CAST(COALESCE(SUM(amount),0) AS CHAR) total FROM siap_v11_payments WHERE letter_id=? AND status='APPROVED'", [letterId],
  );
  if (p.status !== "PAID" || minorUnits(p.total) !== minorUnits(rows[0].total) || minorUnits(p.paid) !== minorUnits(p.total)) {
    throw new Error("Invoice belum lunas melalui pembayaran yang di-ACC Manager.");
  }
}

export async function linkedPayable(id: string, conn: Queryable = db) {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT letter_id FROM siap_v11_letters WHERE payable_id=?", [id]);
  return rows[0]?.letter_id as string | undefined;
}
