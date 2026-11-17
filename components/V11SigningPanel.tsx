"use client";

import { useEffect, useState, type FormEvent } from "react";

type Job = { id: string; status: string; mode: string; final_attachment_id: string | null };
type Source = { id: string; original_name: string; attachment_kind: string };
const fieldLabels = {
  page: "Halaman", position_x: "Posisi X", position_y: "Posisi Y", element_width: "Lebar tanda tangan",
  element_height: "Tinggi tanda tangan", canvas_width: "Lebar halaman PDF", canvas_height: "Tinggi halaman PDF",
};

export default function V11SigningPanel({ id, files, onReady }: { id: string; files: Source[]; onReady: (ready: boolean) => void }) {
  const [mode, setMode] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const path = "/api/letters/" + id + "/signing";
  useEffect(() => {
    const controller = new AbortController();
    onReady(false);
    setMode(null);
    setJob(null);
    void fetch(path, { signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const json = await response.json();
      setMode(json.mode);
      setJob(json.data);
      onReady(json.data?.status === "COMPLETED");
    }).catch(() => {});
    return () => controller.abort();
  }, [path, onReady]);

  async function action(kind: "START" | "REFRESH", event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const fields = event ? Object.fromEntries(new FormData(event.currentTarget)) : {};
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, action: kind }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Mekari belum dapat diproses.");
      setJob(json.data);
      onReady(json.data?.status === "COMPLETED");
      if (json.retry_after) setMessage("PDF belum siap. Segarkan setelah " + json.retry_after + " detik.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proses Mekari gagal.");
    } finally {
      setBusy(false);
    }
  }

  if (!mode) return null;
  const pdfs = files.filter(file => file.attachment_kind === "ORIGINAL" && /\.pdf$/i.test(file.original_name));
  return <details className="card" style={{ marginTop: 12 }}>
    <summary className="card-head"><b>{mode === "mock" ? "Simulasi Mekari Sign" : "Mekari Sign Sandbox"}</b></summary>
    <div className="card-body">
      {message && <p className="notice" role="status">{message}</p>}
      {job ? <>
        <p>Status {job.status}</p>
        {job.status === "IN_PROGRESS" && <button className="btn btn-secondary" disabled={busy} onClick={() => void action("REFRESH")}>Segarkan Status Mekari</button>}
        {job.final_attachment_id && <a href={"/api/attachments/" + job.final_attachment_id} download>Unduh PDF final</a>}
      </> : <form className="form-grid" onSubmit={event => void action("START", event)}>
        <label className="field full"><span>PDF Draf yang Disetujui</span><select className="select" name="attachment_id" required>
          <option value="">Pilih PDF</option>
          {pdfs.map(file => <option key={file.id} value={file.id}>{file.original_name}</option>)}
        </select></label>
        {mode === "sandbox" && <>
          <label className="field"><span>Nama Signer Uji</span><input className="input" name="signer_name" required/></label>
          <label className="field"><span>Email Signer Uji</span><input className="input" type="email" name="signer_email" required/></label>
          {Object.entries(fieldLabels).map(([key, value]) => <label key={key} className="field">
            <span>{value}</span><input className="input" type="number" name={key} step="0.01" min="0" required/>
          </label>)}
        </>}
        <button className="btn btn-secondary" disabled={busy || !pdfs.length}>{mode === "mock" ? "Mulai Simulasi" : "Ajukan Tanda Tangan Sandbox"}</button>
      </form>}
    </div>
  </details>;
}
