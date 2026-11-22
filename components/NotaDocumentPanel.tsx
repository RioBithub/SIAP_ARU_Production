"use client";

import { useCallback, useState, type FormEvent } from "react";
import AttachmentActions from "@/components/AttachmentActions";
import V11SigningPanel from "@/components/V11SigningPanel";
import type { notaDocument } from "@/lib/nota-document";

export default function NotaDocumentPanel({ id, data, assistants, refresh }: {
  id: string;
  data: NonNullable<Awaited<ReturnType<typeof notaDocument>>> & {
    editable: boolean; sandbox: boolean; uploadable: boolean; requiresProof: boolean;
    canAssignAssistant: boolean; assistant: { id: string; name: string } | null;
  };
  assistants: Array<{ id: string; name: string }>;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSigning, setShowSigning] = useState(false);
  const [showDeclaration, setShowDeclaration] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const current = data.signed ?? data.source;
  const onSignature = useCallback((ready: boolean) => {
    if (ready) void refresh().catch(() => setError("Hasil tanda tangan tersimpan. Buka kembali detail untuk melihat PDF."));
  }, [refresh]);

  async function save(body: { action: string; source_id?: string; reason?: string; assistant_id?: string } | FormData, endpoint = "nota-document") {
    setBusy(true);
    setError("");
    try {
      const request = body instanceof FormData
        ? { method: "POST", body }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
      const url = `/api/letters/${id}/` + endpoint;
      const response = await fetch(url, request);
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Dokumen belum dapat disimpan.");
      setShowDeclaration(false);
      setShowSigning(false);
      setShowUpload(false);
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

  function uploadSignature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("action", "UPLOAD_SIGNATURE");
    form.set("source_id", data.source?.id || "");
    void save(form);
  }

  return <section className="card workflow-document-panel">
    <div className="card-head"><h3>PDF & Tanda Tangan Nota Dinas</h3></div>
    <div className="card-body">
      <div className="kpi-list">
        <div className="kpi-row"><span>Status tanda tangan</span><b>
          {data.method === "MEKARI_SANDBOX" ? "Ditandatangani di Mekari Sandbox"
            : data.method === "DIGITAL" ? "PDF bertanda tangan digital diunggah"
            : data.method === "BASAH" ? "Hasil pindai tanda tangan basah diunggah"
            : data.manualReason ? "Pernyataan pengirim" : "Belum ditandatangani"}
        </b></div>
        {!data.signed && data.manualReason && <div className="kpi-row"><span>Keterangan pengirim</span><b>{data.manualReason}</b></div>}
        {current && <div className="kpi-row"><span>{data.signed ? "PDF hasil tanda tangan" : "PDF utama"}</span>
          <AttachmentActions id={current.id} name={current.original_name} downloadLabel="Unduh PDF Nota Dinas"/>
        </div>}
        {data.signed && data.source && <div className="kpi-row"><span>PDF sebelum tanda tangan</span>
          <AttachmentActions id={data.source.id} name={data.source.original_name} downloadLabel="Unduh PDF draf"/>
        </div>}
        {data.assistant && <div className="kpi-row"><span>Bantuan tanda tangan</span><b>{data.assistant.name}</b></div>}
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
                void save(form, "attachments");
              }}/>
          </label>
        </div>
      </>}
      {data.canAssignAssistant && (assistants.length > 0 || data.assistant) && <form
        className="form-grid workflow-form" key={data.assistant?.id || "unassigned"} onSubmit={event => {
          event.preventDefault();
          const selected = String(new FormData(event.currentTarget).get("assistant_id") || "");
          void save({ action: "ASSIGN_ASSISTANT", assistant_id: selected });
        }}>
        <label className="field"><span>Minta bantuan Sekretariat</span>
          <select className="select" name="assistant_id" defaultValue={data.assistant?.id || ""} disabled={busy}>
            <option value="">Tanpa bantuan</option>
            {assistants.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
        <div className="field"><button type="submit" className="btn btn-secondary" disabled={busy}>Simpan Penugasan</button></div>
      </form>}
      {data.uploadable && data.source && <div className="attachment-actions" style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-primary" disabled={busy} aria-expanded={showUpload}
          onClick={() => { setShowUpload(!showUpload); setShowSigning(false); setShowDeclaration(false); }}>
          {data.method === "BASAH" || data.method === "DIGITAL" ? "Ganti PDF Bertanda Tangan" : "Unggah PDF Bertanda Tangan"}
        </button>
      </div>}
      {showUpload && data.source && data.uploadable && <form className="form-grid workflow-form" onSubmit={uploadSignature}>
        <label className="field"><span>Metode tanda tangan</span>
          <select className="select" name="signature_method" defaultValue="" required>
            <option value="">Pilih metode</option>
            <option value="DIGITAL">Digital</option>
            <option value="BASAH">Basah (hasil pindai PDF)</option>
          </select>
        </label>
        <label className="field"><span>PDF yang sudah bertanda tangan</span>
          <input className="input" type="file" name="signed_file" accept=".pdf,application/pdf" required/>
        </label>
        <div className="field full"><button type="submit" className="btn btn-primary" disabled={busy}>Simpan PDF Bertanda Tangan</button></div>
      </form>}
      {data.editable && data.source && !data.signed && <div className="attachment-actions" style={{ marginTop: 8 }}>
          {data.sandbox && !data.manualReason && <button type="button" className="btn btn-primary" disabled={busy}
            aria-expanded={showSigning} onClick={() => { setShowSigning(!showSigning); setShowDeclaration(false); setShowUpload(false); }}>Tanda Tangan Mekari Sandbox</button>}
          {data.manualReason
            ? <button type="button" className="btn btn-secondary" disabled={busy}
              onClick={() => void save({ action: "RESET", source_id: data.source?.id })}>Tandai Belum Ditandatangani</button>
            : !data.requiresProof && <button type="button" className="btn btn-secondary" disabled={busy} aria-expanded={showDeclaration}
              onClick={() => { setShowDeclaration(!showDeclaration); setShowSigning(false); setShowUpload(false); }}>Catat Sudah Ditandatangani</button>}
      </div>}
      {data.editable && showDeclaration && data.source && !data.signed && !data.requiresProof && <form className="form-grid workflow-form" onSubmit={declare}>
          <p className="field full notice">Keterangan ini tercatat sebagai pernyataan pengirim. Untuk dokumen operasional, unggah PDF yang sudah ditandatangani.</p>
          <label className="field full"><span>Keterangan tanda tangan</span>
            <textarea className="textarea" name="reason" required maxLength={1000}
              placeholder="Contoh: PDF sudah ditandatangani di luar SIAP ARU."/>
          </label>
          <div className="field full"><button className="btn btn-primary" disabled={busy}>Simpan Status Tanda Tangan</button></div>
        </form>}
      {data.editable && showSigning && data.source && !data.signed && data.sandbox && !data.manualReason &&
          <V11SigningPanel key={data.source.id} id={data.source.id}
            source={{ ...data.source, attachment_kind: "ORIGINAL" }} onReady={onSignature}/>}
      {busy && <p role="status">Menyimpan PDF atau status tanda tangan…</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </section>;
}
