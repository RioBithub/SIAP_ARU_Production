"use client";

import { useCallback, useState, type FormEvent } from "react";
import AttachmentActions from "@/components/AttachmentActions";
import V11SigningPanel from "@/components/V11SigningPanel";
import LocalSignature from "@/components/LocalSignature";
import type { notaDocument } from "@/lib/nota-document";

export default function NotaDocumentPanel({ id, data, refresh }: {
  id: string;
  data: NonNullable<Awaited<ReturnType<typeof notaDocument>>> & { editable: boolean; sandbox: boolean; local: boolean };
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSigning, setShowSigning] = useState(false);
  const [showDeclaration, setShowDeclaration] = useState(false);
  const current = data.signed ?? data.source;
  const onSignature = useCallback((ready: boolean) => {
    if (ready) void refresh().catch(() => setError("Hasil tanda tangan tersimpan. Buka kembali detail untuk melihat PDF."));
  }, [refresh]);

  async function save(body: { action: string; source_id?: string; reason?: string } | FormData) {
    setBusy(true);
    setError("");
    try {
      const request = body instanceof FormData
        ? { method: "POST", body }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
      const url = `/api/letters/${id}/` + (body instanceof FormData ? "attachments" : "nota-document");
      const response = await fetch(url, request);
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Dokumen belum dapat disimpan.");
      setShowDeclaration(false);
      setShowSigning(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dokumen belum dapat disimpan.");
    } finally {
      setBusy(false);
    }
  }

  function declare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") || "").trim();
    void save({ action: "DECLARE", source_id: data.source?.id, reason });
  }

  return <section className="card workflow-document-panel">
    <div className="card-head"><h3>PDF & Tanda Tangan Nota Dinas</h3></div>
    <div className="card-body">
      <div className="kpi-list">
        <div className="kpi-row"><span>Status tanda tangan</span><b>
          {data.signed ? (data.local ? "Tanda tangan simulasi tersedia" : "Ditandatangani di Mekari Sandbox")
            : data.manualReason ? "Sudah ditandatangani menurut pengirim" : "Belum ditandatangani"}
        </b></div>
        {!data.signed && data.manualReason && <div className="kpi-row"><span>Keterangan pengirim</span><b>{data.manualReason}</b></div>}
        {current && <div className="kpi-row"><span>{data.signed ? "PDF hasil tanda tangan" : "PDF utama"}</span>
          <AttachmentActions id={current.id} name={current.original_name} downloadLabel="Unduh PDF Nota Dinas"/>
        </div>}
      </div>
      {data.editable && <>
        <p className="muted">{data.needsSource ? "Siapkan ulang PDF utama sesuai isi Nota Dinas yang terbaru."
          : "Siapkan dan tandatangani PDF utama sebelum mengajukan Nota Dinas."}</p>
        <div className="attachment-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void save({ action: "GENERATE" })}>Buat PDF dari Isi Nota</button>
          <label className="btn btn-secondary" aria-disabled={busy}>Unggah PDF Nota Dinas
            <input hidden aria-label="Unggah PDF Nota Dinas" type="file" accept=".pdf,application/pdf" disabled={busy}
              onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                const form = new FormData();
                form.set("file", file);
                form.set("kind", "ORIGINAL");
                void save(form);
              }}/>
          </label>
        </div>
        {data.source && !data.signed && <div className="attachment-actions" style={{ marginTop: 8 }}>
          {(data.sandbox || data.local) && !data.manualReason && <button type="button" className="btn btn-primary" disabled={busy}
            aria-expanded={showSigning} onClick={() => { setShowSigning(!showSigning); setShowDeclaration(false); }}>
            {data.local ? "Tanda Tangan Simulasi" : "Tanda Tangan Mekari Sandbox"}
          </button>}
          {data.manualReason
            ? <button type="button" className="btn btn-secondary" disabled={busy}
              onClick={() => void save({ action: "RESET", source_id: data.source?.id })}>Tandai Belum Ditandatangani</button>
            : <button type="button" className="btn btn-secondary" disabled={busy} aria-expanded={showDeclaration}
              onClick={() => { setShowDeclaration(!showDeclaration); setShowSigning(false); }}>Catat Sudah Ditandatangani</button>}
        </div>}
        {showDeclaration && data.source && !data.signed && <form className="form-grid workflow-form" onSubmit={declare}>
          <p className="field full notice">Keterangan ini tercatat sebagai pernyataan pengirim. Untuk dokumen operasional, unggah PDF yang sudah ditandatangani.</p>
          <label className="field full"><span>Keterangan tanda tangan</span>
            <textarea className="textarea" name="reason" required maxLength={1000}
              placeholder="Contoh: PDF sudah ditandatangani di luar SIAP ARU."/>
          </label>
          <div className="field full"><button className="btn btn-primary" disabled={busy}>Simpan Status Tanda Tangan</button></div>
        </form>}
        {showSigning && data.source && !data.signed && !data.manualReason && (data.local
          ? <LocalSignature key={data.source.id} id={data.source.id} onSaved={() => onSignature(true)}/>
          : data.sandbox && <V11SigningPanel key={data.source.id} id={data.source.id}
            source={{ ...data.source, attachment_kind: "ORIGINAL" }} onReady={onSignature}/>)}
      </>}
      {busy && <p role="status">Menyimpan PDF atau status tanda tangan…</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </section>;
}
