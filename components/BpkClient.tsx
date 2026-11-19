"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Modal from "@/components/Modal";
import { BPK_MONEY_FIELDS, BPK_STATUS, BPK_TEXT_FIELDS, rupiah, type BpkFields, type BpkInput, type BpkRecord } from "@/lib/bpk-fields";
import type { SessionUser } from "@/lib/types";
import { INVOICE_PAYMENT_MODES, jakartaDate, type InvoicePaymentMode } from "@/lib/v11-workflow";
import { formatWorkflowTime } from "@/lib/workflow-time";

type Editor = { input: BpkInput; source: string | null; invoiceNumber?: string | null; invoiceTotal?: string; record?: BpkRecord };
type Prefill = { existingId?: string; editable: boolean; invoiceNumber?: string; invoiceTotal: string; prefill: BpkInput };
const textGroups = [
  ["description", "notes", "received_by", "account_code", "ppn_description", "pph_description"],
  ["bank_name", "account_number", "account_name", "basis", "manager", "director"],
] as const;

async function jsonRequest<T>(url: string, method?: "POST" | "PATCH", body?: Record<string, unknown>) {
  const response = await fetch(url, method ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) throw new Error(json?.error || "BPK belum dapat diproses.");
  return json.data as T;
}

function label(record: BpkRecord) {
  if (record.ledger_status === "PAID") return "Terbayar";
  if (record.ledger_status === "PARTIAL") return "Dibayar sebagian";
  return BPK_STATUS[record.status];
}

export default function BpkClient({ user, invoiceId }: { user: SessionUser; invoiceId: string | null }) {
  const [rows, setRows] = useState<BpkRecord[]>([]);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (term = "") => {
    const records = await jsonRequest<BpkRecord[]>("/api/bpk?q=" + encodeURIComponent(term));
    setRows(records);
  }, []);

  const open = useCallback(async (id: string) => {
    const record = await jsonRequest<BpkRecord>("/api/bpk/" + id);
    setEditor({ record, input: record, source: record.letter_id,
      invoiceNumber: record.invoice_number, invoiceTotal: record.invoice_total });
  }, []);

  useEffect(() => {
    void load().catch(cause => setError(cause.message));
    if (!invoiceId) return;
    void jsonRequest<Prefill>("/api/bpk?invoice_id=" + encodeURIComponent(invoiceId)).then(async data => {
      if (data.existingId) return open(data.existingId);
      if (!data.editable) throw new Error("BPK baru belum dapat dibuat dari invoice ini.");
      setEditor({ input: data.prefill, source: invoiceId, invoiceNumber: data.invoiceNumber, invoiceTotal: data.invoiceTotal });
    }).catch(cause => setError(cause.message));
  }, [invoiceId, load, open]);

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !editor) return;
    const fields = new FormData(event.currentTarget);
    const details = Object.fromEntries(
      [...Object.keys(BPK_TEXT_FIELDS), ...Object.keys(BPK_MONEY_FIELDS), "due_date"]
        .map(key => [key, String(fields.get(key) || "")]),
    ) as BpkFields;
    const input = {
      submitted_on: String(fields.get("submitted_on")), mode: fields.get("mode") as InvoicePaymentMode,
      payee: String(fields.get("payee")), expense_post: String(fields.get("expense_post")), details,
    };
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const action = submitter instanceof HTMLButtonElement && submitter.value === "SUBMIT" ? "SUBMIT" : "SAVE";
    setBusy(true);
    setError("");
    try {
      if (editor.record) {
        await jsonRequest("/api/bpk/" + editor.record.id, "PATCH", { ...input, action });
        await open(editor.record.id);
      } else {
        const created = await jsonRequest<{ id: string }>("/api/bpk", "POST", { ...input, invoice_id: editor.source });
        await open(created.id);
      }
      await load(query);
      setNotice(action === "SUBMIT" ? "BPK diajukan." : "Draf BPK disimpan.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "BPK belum dapat disimpan."); }
    finally { setBusy(false); }
  }

  async function manage(event: FormEvent<HTMLFormElement>, action: "NUMBER" | "RETURN" | "RECORD_PAYMENT") {
    event.preventDefault();
    if (!editor?.record || busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      await jsonRequest("/api/bpk/" + editor.record.id, "PATCH", { ...values, action });
      await open(editor.record.id);
      await load(query);
      setNotice(action === "NUMBER" ? "Nomor bukti disimpan." : action === "RETURN" ? "BPK dikembalikan." : "Pembayaran dicatat.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "BPK belum dapat diperbarui."); }
    finally { setBusy(false); }
  }

  const record = editor?.record;
  const input = editor?.input;
  const pdfUrl = record ? `/api/bpk/${record.id}/pdf` : "";
  return <main className="page">
    <header className="page-head">
      <div><h2>Bukti Pengeluaran Keuangan</h2><p>Buat BPK mandiri atau lanjutkan BPK yang ditautkan dari invoice.</p></div>
      <button className="btn btn-primary" onClick={() => {
        setError("");
        setEditor({ source: null, input: { submitted_on: jakartaDate(), mode: "REGULAR", payee: "", expense_post: user.unit_name || "", details: {} } });
      }}>+ Buat BPK</button>
    </header>
    {error && !editor && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
    <form className="toolbar" onSubmit={event => { event.preventDefault(); setError(""); void load(query).catch(cause => setError(cause.message)); }}>
      <input className="input" aria-label="Cari BPK" placeholder="Cari nomor bukti, invoice, penerima, atau pos" value={query} onChange={e => setQuery(e.target.value)}/>
      <button className="btn btn-secondary">Cari</button>
    </form>
    <div className="card table-wrap"><table className="table">
      <thead><tr><th>Tgl Pengajuan</th><th>Nomor Bukti / Invoice</th><th>Penerima / Pos</th><th>Pembuat</th><th>Jumlah Neto</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>
        {rows.map(row => <tr key={row.id}>
          <td>{row.submitted_on.split("-").reverse().join("/")}</td>
          <td>{row.evidence_number || "-"}{row.invoice_number && <div className="muted">{row.invoice_number}</div>}</td>
          <td>{row.payee || "-"}<div className="muted">{row.expense_post}</div></td>
          <td>{row.creator_name}</td><td>{rupiah(row.net)}</td><td><span className="badge blue">{label(row)}</span></td>
          <td><button className="btn btn-secondary" onClick={() => { setError(""); void open(row.id).catch(cause => setError(cause.message)); }}>Detail</button></td>
        </tr>)}
        {!rows.length && <tr><td colSpan={7}><div className="empty">Belum ada BPK yang tersedia.</div></td></tr>}
      </tbody>
    </table></div>

    {editor && input && <Modal title={record ? "Detail BPK" : "Buat BPK"} onClose={() => { if (!busy) { setEditor(null); setError(""); } }}>
      {error && <p className="error" role="alert">{error}</p>}
      {record?.return_reason && <p className="notice"><b>Alasan pengembalian</b> · {record.return_reason}</p>}
      {editor.source && <p className="notice">Invoice {editor.invoiceNumber} · Nilai tagihan {rupiah(editor.invoiceTotal)}.
        {(!record || record.editable) && " Isi DPP dan komponen pajak sesuai rincian tagihan."}</p>}
      {record && <div className="attachment-actions bpk-detail-actions">
        <a className="btn btn-secondary" href={pdfUrl} download>Unduh BPK (PDF)</a>
        {record.mode === "PERSEKOT" && <a className="btn btn-secondary" href={pdfUrl + "?type=spb"} download>Unduh SPB (PDF)</a>}
        {record.letter_id && <a className="btn btn-secondary" href={"/letters/incoming?letter_id=" + record.letter_id}>Buka Invoice</a>}
      </div>}
      {(!record || record.editable) ? <form key={record?.id || "new"} className="form-grid workflow-form" onSubmit={saveDraft}>
        <label className="field"><span>Tanggal Pengajuan</span><input className="input" name="submitted_on" type="date" defaultValue={input.submitted_on} max={jakartaDate()} required/></label>
        <label className="field" data-need={editor.source ? "Mengikuti invoice" : undefined}><span>Jenis Pengeluaran</span>
          <select className="select" name="mode" defaultValue={input.mode} required disabled={Boolean(editor.source)}>
          {Object.entries(INVOICE_PAYMENT_MODES).map(([mode, title]) => <option value={mode} key={mode}>{title}</option>)}
        </select></label>
        <label className="field" data-need="Wajib saat diajukan"><span>Dibayarkan Kepada</span><input className="input" name="payee" maxLength={255} defaultValue={input.payee}/></label>
        <label className="field" data-need="Wajib saat diajukan"><span>Pos Pengeluaran</span><input className="input" name="expense_post" maxLength={160} defaultValue={input.expense_post}/></label>
        {textGroups[0].map(key => <label className={"field" + (key === "description" || key === "notes" ? " full" : "")}
          data-need={key === "description" ? "Wajib saat diajukan" : undefined} key={key}>
          <span>{BPK_TEXT_FIELDS[key][0]}</span>
          {key === "description" || key === "notes"
            ? <textarea className="textarea" name={key} maxLength={BPK_TEXT_FIELDS[key][1]} defaultValue={input.details[key]}/>
            : <input className="input" name={key} maxLength={BPK_TEXT_FIELDS[key][1]} defaultValue={input.details[key]}/>}
        </label>)}
        <h3 className="field full">Nominal dan Pajak</h3>
        {Object.entries(BPK_MONEY_FIELDS).map(([key, title]) => <label className="field" key={key}><span>{title}</span>
          <input className="input" name={key} type="number" min="0" step="0.01" defaultValue={input.details[key as keyof BpkFields]}/></label>)}
        <label className="field"><span>Jatuh Tempo Tagihan</span><input className="input" name="due_date" type="date" defaultValue={input.details.due_date}/></label>
        <h3 className="field full">Rekening dan Rujukan</h3>
        {textGroups[1].map(key => <label className="field" key={key}><span>{BPK_TEXT_FIELDS[key][0]}</span>
          <input className="input" name={key} maxLength={BPK_TEXT_FIELDS[key][1]} defaultValue={input.details[key]}/></label>)}
        {record && <p className="field full muted">Jumlah neto tersimpan {rupiah(record.net)}. Sistem menghitung ulang dari DPP, PPN, dan potongan PPh saat disimpan.</p>}
        <div className="field full attachment-actions">
          <button className="btn btn-primary" disabled={busy}>Simpan Draf</button>
          {record && <button className="btn btn-secondary" value="SUBMIT" disabled={busy}>
            {editor.source ? "Ajukan & Tautkan ke Checklist Invoice" : "Ajukan BPK"}
          </button>}
        </div>
      </form> : <div className="kpi-list">
        <div className="kpi-row"><span>Status</span><b>{label(record)}</b></div>
        <div className="kpi-row"><span>Pembuat</span><b>{record.creator_name}</b></div>
        <div className="kpi-row"><span>Dibayarkan kepada</span><b>{record.payee}</b></div>
        <div className="kpi-row"><span>Pos / Jenis</span><b>{record.expense_post} · {INVOICE_PAYMENT_MODES[record.mode]}</b></div>
        <div className="kpi-row"><span>Jumlah neto</span><b>{rupiah(record.net)}</b></div>
        <div className="kpi-row"><span>Nomor bukti</span><b>{record.evidence_number || "-"}</b></div>
        {record.bpk_number && <div className="kpi-row"><span>Nomor BPK</span><b>{record.bpk_number}</b></div>}
        {record.details.paid_on && <div className="kpi-row"><span>Pembayaran</span><b>{record.details.paid_on} · {record.details.paid_via}</b></div>}
        {record.payments.map(payment => <div className="kpi-row" key={payment.reference}><span>{payment.date} · {payment.reference}</span><b>{rupiah(payment.amount)}</b></div>)}
        <div className="kpi-row"><span>Pembaruan</span><b>{formatWorkflowTime(record.updated_at)}</b></div>
      </div>}
      {record?.manage && (record.status === "SUBMITTED" || record.status === "NUMBERED") &&
        <form className="form-grid workflow-form bpk-action-form" onSubmit={event => void manage(event, "NUMBER")}>
          <label className="field"><span>Nomor Bukti (Accounting)</span><input className="input" name="evidence_number" defaultValue={record.evidence_number || ""} required maxLength={100}/></label>
          <label className="field"><span>Nomor BPK</span><input className="input" name="bpk_number" defaultValue={record.bpk_number || ""} maxLength={100}/></label>
          <div className="field full"><button className="btn btn-primary" disabled={busy}>Simpan Nomor Bukti</button></div>
        </form>}
      {record?.manage && record.status === "SUBMITTED" &&
        <form className="form-grid workflow-form bpk-action-form" onSubmit={event => void manage(event, "RETURN")}>
          <label className="field full"><span>Alasan Pengembalian</span><textarea className="textarea" name="reason" maxLength={1000} required/></label>
          <div className="field full"><button className="btn btn-secondary" disabled={busy}>Kembalikan ke Draf</button></div>
        </form>}
      {record?.manage && record.status === "NUMBERED" && !record.letter_id &&
        <form className="form-grid workflow-form bpk-action-form" onSubmit={event => void manage(event, "RECORD_PAYMENT")}>
          <label className="field"><span>Tanggal Telah Dibayar</span><input className="input" name="paid_on" type="date" max={jakartaDate()} required/></label>
          <label className="field"><span>Via Bank / Kas</span><input className="input" name="paid_via" required maxLength={160}/></label>
          <label className="field"><span>Referensi Pembayaran</span><input className="input" name="paid_reference" maxLength={255}/></label>
          <div className="field full"><button className="btn btn-primary" disabled={busy}>Catat Sebagai Terbayar</button></div>
        </form>}
    </Modal>}
  </main>;
}
