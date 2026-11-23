"use client";

import { useState, type FormEvent } from "react";
import AttachmentActions from "@/components/AttachmentActions";
import CorrespondenceLayoutFields from "@/components/CorrespondenceLayoutFields";
import { emptyCorrespondenceLayout, type CorrespondenceLayout } from "@/lib/correspondence-layout";

export default function OutgoingDocumentPanel({ id, data, refresh }: {
  id: string;
  data: {
    editable: boolean;
    source: { id: string; original_name: string } | null;
    initialLayout: CorrespondenceLayout | null;
    needsSource: boolean;
  };
  refresh: () => Promise<void>;
}) {
  const [layout, setLayout] = useState(() => data.initialLayout ?? emptyCorrespondenceLayout());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/api/letters/${id}/draft-document`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document_layout: layout }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "PDF Surat Keluar belum dibuat.");
      setOpen(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PDF Surat Keluar belum dibuat.");
    } finally {
      setBusy(false);
    }
  }

  if (!data.editable && !data.source) return null;
  return <section className="card workflow-document-panel">
    <div className="card-head"><h3>Dokumen utama Surat Keluar</h3></div>
    <div className="card-body">
      {data.source && <div className="kpi-row">
        <b>{data.source.original_name}</b><AttachmentActions id={data.source.id} name={data.source.original_name}/>
      </div>}
      {data.needsSource && <p className="hint">Isi surat berubah. Buat ulang PDF atau unggah versi terbaru di bagian Lampiran.</p>}
      {data.editable && <div className="attachment-actions">
        <button type="button" className="btn btn-secondary" disabled={busy} aria-expanded={open} onClick={() => setOpen(!open)}>
          {data.initialLayout ? "Ubah Format / Buat Ulang PDF" : "Buat PDF dari Sistem"}
        </button>
      </div>}
      {open && <form className="form-grid workflow-form" onSubmit={generate}>
        <p className="hint field full">PDF memakai isi, perihal, tujuan, tanggal, dan nomor dari draf tersimpan.</p>
        <CorrespondenceLayoutFields layout={layout} onChange={setLayout} outgoing disabled={busy}/>
        <div className="field full"><button className="btn btn-primary" disabled={busy}>{busy ? "Membuat PDF…" : "Simpan PDF"}</button></div>
      </form>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </section>;
}
