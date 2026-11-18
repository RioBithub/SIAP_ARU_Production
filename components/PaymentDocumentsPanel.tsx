"use client";

import { useState, type FormEvent } from "react";
import type { PaymentDocuments } from "@/lib/v11-payment-documents";
import AttachmentActions from "@/components/AttachmentActions";
import { PERSEKOT_DOCUMENTS } from "@/lib/v11-workflow";

export default function PaymentDocumentsPanel({ id, data, onSaved }: {
  id: string;
  data: PaymentDocuments & { editable: boolean };
  onSaved?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [recipient, setRecipient] = useState(data.recipient ?? "");
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch("/api/letters/" + id + "/payment-documents", { method: "POST", body: fields });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Persyaratan gagal disimpan.");
      if (fields.has("document_code")) {
        form.reset();
        setCode("");
      }
      await onSaved?.();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menyimpan persyaratan.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="card" style={{ marginTop: 12 }}>
    <div className="card-head"><h3>Persyaratan sebelum Finance</h3></div>
    <div className="card-body">
      <p className={data.missing.length ? "notice" : "success"}>
        {data.missing.length ? "Belum lengkap. Instruksi pembayaran belum bisa dibuat." : "Berkas persyaratan lengkap."}
      </p>
      {data.editable ? <form onSubmit={submit} className="form-grid workflow-form">
        <label className="field"><span>Tujuan pembayaran</span>
          <select className="select" name="recipient_type" value={recipient} onChange={event =>
            setRecipient(event.target.value as typeof recipient)} required disabled={busy}>
            <option value="">Pilih tujuan pembayaran</option>
            <option value="VENDOR">Vendor</option>
            <option value="NON_VENDOR">Selain vendor</option>
          </select>
        </label>
        <div className="field"><button className="btn btn-secondary" disabled={busy || !recipient || recipient === data.recipient}>
          Simpan tujuan pembayaran
        </button></div>
      </form> : <p>Tujuan pembayaran {data.recipient === "VENDOR" ? "vendor" : data.recipient === "NON_VENDOR" ? "selain vendor" : "belum ditentukan"}</p>}
      <div className="kpi-list">
        {data.documents.map(doc => <div className="kpi-row" key={doc.code}>
          <span>{PERSEKOT_DOCUMENTS[doc.code]}</span>
          <div>
            {doc.attachment ? <AttachmentActions id={doc.attachment.id} name={doc.attachment.name} downloadLabel="Unduh bukti"/>
              : doc.linked ? <b>Sudah tertaut ke SPK invoice</b>
              : doc.required ? <b>Wajib · Berkas belum ada</b> : <span>{data.recipient ? "Tidak wajib untuk tujuan ini" : "Wajib jika dibayar ke vendor"}</span>}
          </div>
        </div>)}
      </div>
      {data.editable && <form onSubmit={submit} className="form-grid workflow-form" style={{ marginTop: 12 }}>
        <label className="field"><span>Jenis dokumen persyaratan</span>
          <select className="select" name="document_code" value={code} required
            onChange={event => setCode(event.target.value)} disabled={busy}>
            <option value="">Pilih dokumen</option>
            {data.documents.map(doc => <option key={doc.code} value={doc.code}>{PERSEKOT_DOCUMENTS[doc.code]}</option>)}
          </select>
        </label>
        <label className="field"><span>Berkas persyaratan</span>
          <input className="input" name="file" type="file" accept={code === "SPB" ? ".pdf" : ".pdf,.png,.jpg,.jpeg"} required disabled={busy}/>
        </label>
        <div className="field"><button className="btn btn-primary" disabled={busy || !code}>Unggah dokumen</button></div>
      </form>}
      {error && <p className="error" role="alert">{error}</p>}
      {saved && <p className="success" role="status">Persyaratan diperbarui.</p>}
    </div>
  </section>;
}
