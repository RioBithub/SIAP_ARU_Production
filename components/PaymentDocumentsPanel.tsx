"use client";

import { useState, type FormEvent } from "react";
import type { PaymentDocuments } from "@/lib/v11-payment-documents";
import AttachmentActions from "@/components/AttachmentActions";
import { PERSEKOT_DOCUMENTS } from "@/lib/v11-workflow";

type SourceAttachment = {
  id: string;
  original_name: string;
  source_kind: string;
  letter_action_id: string | null;
};

export default function PaymentDocumentsPanel({ id, data, attachments, onSaved }: {
  id: string;
  data: PaymentDocuments & { editable: boolean };
  attachments: SourceAttachment[];
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [useExisting, setUseExisting] = useState(false);
  const [recipient, setRecipient] = useState(data.recipient ?? "");
  const [saved, setSaved] = useState(false);
  const acceptedNames = code === "SPB" ? /\.pdf$/i : /\.(pdf|png|jpe?g)$/i;
  const available = attachments.filter(file =>
    file.source_kind === "ADDITIONAL" && !file.letter_action_id && acceptedNames.test(file.original_name));
  const reusing = useExisting && available.length > 0;
  const replacing = data.documents.some(doc => doc.code === code && doc.attachment);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setError("");
    setSaved(false);
    let persisted = false;
    try {
      const response = await fetch("/api/letters/" + id + "/payment-documents", { method: "POST", body: fields });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Persyaratan gagal disimpan.");
      persisted = true;
      if (fields.has("document_code")) {
        form.reset();
        setCode("");
        setUseExisting(false);
      }
      await onSaved();
      setSaved(true);
    } catch (cause) {
      setError(persisted ? "Persyaratan sudah disimpan. Buka kembali detail untuk melihat perubahannya." :
        cause instanceof Error ? cause.message : "Gagal menyimpan persyaratan.");
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
            {doc.attachment ? <div>
              <b style={{ display: "block", overflowWrap: "anywhere" }}>{doc.attachment.name}</b>
              <AttachmentActions id={doc.attachment.id} name={doc.attachment.name} downloadLabel="Unduh berkas"/>
            </div>
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
          {replacing && <small className="hint">Berkas ini akan menggantikan versi aktif untuk jenis yang dipilih.</small>}
        </label>
        {reusing ? <label className="field"><span>Lampiran surat</span>
          <select className="select" name="attachment_id" required disabled={busy}>
            <option value="">Pilih lampiran surat</option>
            {available.map(file => <option key={file.id} value={file.id}>{file.original_name}</option>)}
          </select>
        </label> : <label className="field"><span>Berkas persyaratan</span>
          <input className="input" name="file" type="file" accept={code === "SPB" ? ".pdf" : ".pdf,.png,.jpg,.jpeg"} required disabled={busy}/>
        </label>}
        {available.length > 0 && <label className="field full"><span>
          <input type="checkbox" checked={useExisting} onChange={event => setUseExisting(event.target.checked)} disabled={busy}/>
          {" Gunakan lampiran surat yang sudah ada"}
        </span></label>}
        <div className="field"><button className="btn btn-primary" disabled={busy || !code}>
          {reusing ? "Simpan lampiran sebagai persyaratan" : "Unggah dokumen"}
        </button></div>
      </form>}
      {error && <p className="error" role="alert">{error}</p>}
      {saved && <p className="success" role="status">Persyaratan diperbarui.</p>}
    </div>
  </section>;
}
