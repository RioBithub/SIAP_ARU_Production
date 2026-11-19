import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { bpkInput, bpkInvoice, getBpk, listBpk } from "@/lib/bpk";
import { db, withTransaction } from "@/lib/db";
import { str } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  const search = new URL(request.url).searchParams;
  const invoiceId = str(search.get("invoice_id"), 36);
  if (!invoiceId) {
    const items = await listBpk(db, user, str(search.get("q"), 100));
    return NextResponse.json({ ok: true, data: items });
  }
  const invoice = await bpkInvoice(db, user, invoiceId);
  if (!invoice) return NextResponse.json({ ok: false, error: "Invoice tidak ditemukan atau belum tersedia untuk akun Anda." }, { status: 404 });
  const existing = await getBpk(db, user, { letterId: invoiceId });
  return NextResponse.json({ ok: true, data: { existingId: existing?.id, editable: invoice.editable,
    invoiceNumber: invoice.letter.external_number, invoiceTotal: invoice.invoice_total, prefill: invoice.prefill } });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  try {
    const body = await request.json();
    const invoiceId = str(body.invoice_id, 36) || null;
    const id = await withTransaction(async conn => {
      const invoice = invoiceId ? await bpkInvoice(conn, user, invoiceId, true) : null;
      if (invoiceId && !invoice) return null;
      if (invoiceId) {
        const existing = await getBpk(conn, user, { letterId: invoiceId });
        if (existing) return String(existing.id);
        if (!invoice?.editable) return null;
      }
      const draft = bpkInput(body, invoice?.mode);
      const id = randomUUID();
      await conn.execute(
        `INSERT INTO siap_v11_bpk (id,letter_id,created_by,submitted_on,mode,payee,expense_post,details)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id, invoiceId, user.id, draft.submitted_on, draft.mode, draft.payee, draft.expense_post, JSON.stringify(draft.details)],
      );
      await auditLog({ user, action: "BPK_CREATE", entityType: "BPK", entityId: id, metadata: { invoiceId }, request }, conn);
      return id;
    });
    if (!id) return NextResponse.json({ ok: false, error: "Akun Anda belum dapat membuat BPK dari invoice ini." }, { status: 403 });
    return NextResponse.json({ ok: true, data: { id } });
  } catch (cause) {
    return NextResponse.json({ ok: false, error: cause instanceof Error && !("code" in cause) ? cause.message : "Draf BPK belum dapat dibuat." }, { status: 400 });
  }
}
