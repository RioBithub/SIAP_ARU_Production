import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { attachBpk, bpkInput, bpkInvoice, bpkNet, bpkPayments, bpkRecord, checkBpkSubmission, getBpk } from "@/lib/bpk";
import { db, withTransaction } from "@/lib/db";
import { required, str } from "@/lib/http";
import { getAccessibleLetter } from "@/lib/letter-access";
import { discardUncommittedFiles, type StoredLetterFile } from "@/lib/letter-uploads";
import { checkedDate } from "@/lib/v11-data";
import { paymentInstructionExists } from "@/lib/v11-payment-documents";
import { jakartaDate } from "@/lib/v11-workflow";

export const runtime = "nodejs";

export async function GET(_: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  const row = await getBpk(db, user, { id: params.id });
  if (!row) return NextResponse.json({ ok: false, error: "BPK tidak ditemukan." }, { status: 404 });
  const payments = await bpkPayments(db, row.letter_id);
  return NextResponse.json({ ok: true, data: bpkRecord(row, user, payments) });
}

export async function PATCH(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  const staged: StoredLetterFile[] = [];
  try {
    const body = await request.json();
    if (!["SAVE", "SUBMIT", "NUMBER", "RETURN", "RECORD_PAYMENT"].includes(body.action)) throw new Error("Aksi BPK tidak dikenal.");
    const target = await getBpk(db, user, { id: params.id });
    if (!target) return NextResponse.json({ ok: false, error: "BPK tidak ditemukan." }, { status: 404 });
    const found = await withTransaction(async conn => {
      if (target.letter_id && !await getAccessibleLetter(user, target.letter_id, conn, true)) return false;
      await conn.query("SELECT id FROM siap_v11_bpk WHERE id=? FOR UPDATE", [params.id]);
      const visible = await getBpk(conn, user, { id: params.id });
      if (!visible) return false;
      const record = bpkRecord(visible, user);
      const action = String(body.action);
      let auditNote: string | undefined;
      if (action === "SAVE" || action === "SUBMIT") {
        if (!record.editable) throw new Error("Hanya pembuat yang dapat menyimpan atau mengajukan draf.");
        const invoice = record.letter_id ? await bpkInvoice(conn, user, record.letter_id) : null;
        if (record.letter_id && !invoice?.editable) throw new Error("BPK invoice terkunci selama instruksi Finance berjalan.");
        const data = bpkInput(body, invoice?.mode);
        if (action === "SUBMIT") checkBpkSubmission(data);
        const next = action === "SUBMIT" ? "SUBMITTED" : "DRAFT";
        await conn.execute(
          "UPDATE siap_v11_bpk SET submitted_on=?,mode=?,payee=?,expense_post=?,details=?,status=?,return_reason=? WHERE id=?",
          [data.submitted_on, data.mode, data.payee, data.expense_post, JSON.stringify(data.details), next,
            next === "DRAFT" ? record.return_reason : null, record.id]);
        if (action === "SUBMIT") {
          await attachBpk(conn, user, { ...record, ...data, status: next, net: bpkNet(data.details) }, staged);
        }
      } else {
        if (!record.manage) throw new Error("Aksi ini tersedia untuk petugas Finance / Accounting.");
        if (action === "NUMBER") {
          if (record.status !== "SUBMITTED" && record.status !== "NUMBERED") throw new Error("BPK harus diajukan sebelum diberi nomor.");
          const evidenceNumber = required(body.evidence_number, "Nomor bukti", 100);
          const bpkNumber = str(body.bpk_number, 100) || null;
          await conn.execute("UPDATE siap_v11_bpk SET evidence_number=?,bpk_number=?,status='NUMBERED' WHERE id=?",
            [evidenceNumber, bpkNumber, record.id]);
          if (record.letter_id && visible.checklist_attachment_id) {
            const [[current]] = await conn.query<RowDataPacket[]>(
              "SELECT attachment_id FROM siap_v11_payment_documents WHERE letter_id=? AND document_code='BPK'", [record.letter_id],
            );
            if (current?.attachment_id === visible.checklist_attachment_id) {
              await attachBpk(conn, user, { ...record, status: "NUMBERED", evidence_number: evidenceNumber, bpk_number: bpkNumber }, staged);
            }
          }
        } else if (action === "RETURN") {
          if (record.status !== "SUBMITTED") throw new Error("BPK yang menunggu nomor dapat dikembalikan ke pembuat.");
          auditNote = required(body.reason, "Alasan pengembalian", 1000);
          if (record.letter_id) {
            if (await paymentInstructionExists(conn, record.letter_id)) throw new Error("Instruksi pembayaran masih berlaku.");
            await conn.execute("DELETE FROM siap_v11_payment_documents WHERE letter_id=? AND document_code='BPK' AND attachment_id=?",
              [record.letter_id, visible.checklist_attachment_id]);
          }
          await conn.execute("UPDATE siap_v11_bpk SET status='DRAFT',checklist_attachment_id=NULL,return_reason=? WHERE id=?", [auditNote, record.id]);
        } else {
          if (record.letter_id || record.status !== "NUMBERED") throw new Error("Pembayaran invoice dicatat di menu Finance. BPK mandiri perlu nomor bukti.");
          const paidOn = checkedDate(body.paid_on, "Tanggal pembayaran");
          if (paidOn > jakartaDate()) throw new Error("Tanggal pembayaran tidak boleh di masa depan.");
          const details = { ...record.details, paid_on: paidOn, paid_via: required(body.paid_via, "Via Bank / Kas", 160),
            paid_reference: str(body.paid_reference, 255) };
          await conn.execute("UPDATE siap_v11_bpk SET details=?,status='PAID' WHERE id=?", [JSON.stringify(details), record.id]);
        }
      }
      await auditLog({ user, action: "BPK_" + action, entityType: "BPK", entityId: record.id,
        metadata: { invoiceId: record.letter_id, reason: auditNote, evidenceNumber: action === "NUMBER" ? body.evidence_number : undefined }, request }, conn);
      return true;
    });
    staged.length = 0;
    if (!found) return NextResponse.json({ ok: false, error: "BPK tidak ditemukan." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    await discardUncommittedFiles(staged);
    const duplicate = cause instanceof Error && "code" in cause && cause.code === "ER_DUP_ENTRY";
    const error = duplicate ? "Nomor bukti atau nomor BPK sudah dipakai pada tahun pengajuan yang sama."
      : cause instanceof Error && !("code" in cause) ? cause.message : "BPK belum dapat diperbarui.";
    return NextResponse.json({ ok: false, error }, { status: duplicate ? 409 : 400 });
  }
}
