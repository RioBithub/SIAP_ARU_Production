"use client";

import { useState, type FormEvent } from "react";
import AttachmentActions from "@/components/AttachmentActions";
import V11SigningPanel from "@/components/V11SigningPanel";
import type { DraftSignatureSlot } from "@/lib/correspondence-layout";

type Pdf = { id: string; original_name: string; attachment_kind: string; slots?: DraftSignatureSlot[] };
const methods: Record<string, string> = {
  DIGITAL: "Tanda tangan digital", BASAH: "Tanda tangan basah", MEKARI_MANUAL: "PDF bertanda tangan dari Mekari",
  MEKARI_SANDBOX: "Mekari Sandbox", MEKARI_MOCK: "Simulasi Mekari",
};

export default function OutgoingSignaturePanel({ id, signed, method, editable, source, sandbox, staging, onReady, refresh }: {
  id: string; signed?: Pdf; method: string; editable: boolean; source?: Pdf; sandbox: boolean; staging: boolean;
  onReady: (ready: boolean) => void; refresh: () => Promise<void>;
}) {
  const [upload, setUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/api/letters/${id}/signed-document`, {
        method: "POST", body: new FormData(event.currentTarget),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "PDF belum dapat disimpan.");
      await refresh();
      setUpload(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PDF belum dapat disimpan.");
    } finally {
      setBusy(false);
    }
  }

  if (!editable && !signed) return null;
  return <section className="card" style={{ marginTop: 12 }}>
    <div className="card-head"><h3>Tanda Tangan Surat Keluar</h3></div>
    <div className="card-body">
      {signed && <div className="kpi-row">
        <span><b>PDF final bertanda tangan</b><br/>{signed.original_name}<br/><small>{methods[method]}</small></span>
        <AttachmentActions id={signed.id} name={signed.original_name} downloadLabel="Unduh PDF Final"/>
      </div>}
      {editable && <>
        <button type="button" className="btn btn-primary" aria-expanded={upload} disabled={busy}
          onClick={() => setUpload(value => !value)}>{signed ? "Ganti PDF Bertanda Tangan" : "Unggah PDF Bertanda Tangan"}</button>
        {upload && <form className="form-grid workflow-form" onSubmit={submit}>
          <label className="field"><span>Metode tanda tangan</span>
            <select className="select" name="signature_method" required defaultValue="">
              <option value="">Pilih metode</option>
              <option value="MEKARI_MANUAL">PDF sudah ditandatangani di Mekari</option>
              <option value="DIGITAL">Digital</option>
              <option value="BASAH">Basah (hasil pindai PDF)</option>
            </select>
          </label>
          <label className="field"><span>PDF yang sudah bertanda tangan</span>
            <input type="file" className="input" name="signed_file" accept=".pdf,application/pdf" required/>
          </label>
          <div className="field full"><button className="btn btn-primary" disabled={busy}>Simpan PDF Final</button></div>
        </form>}
        {error && <p className="error" role="alert">{error}</p>}
        {!signed && source && (staging
          ? <V11SigningPanel id={id} files={[source]} onReady={onReady}/>
          : sandbox && <V11SigningPanel id={source.id} source={source}/>)}
        {!signed && !source && (staging || sandbox) &&
          <p className="hint">Mekari Sandbox memerlukan PDF utama. PDF bertanda tangan dari luar SIAP dapat langsung diunggah.</p>}
      </>}
    </div>
  </section>;
}
