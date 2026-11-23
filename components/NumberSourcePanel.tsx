"use client";

import { useState, type FormEvent } from "react";
import type { NumberSourceSettings } from "@/lib/correspondence-number-source";

const path = "/api/admin/correspondence-settings";
type Tab = { tab: string; count: number; incompleteDates: number };

export default function NumberSourcePanel({ initial }: { initial: NumberSourceSettings }) {
  const [source, setSource] = useState(initial.source);
  const [sheetUrl, setSheetUrl] = useState(initial.sheetUrl);
  const [checked, setChecked] = useState<Tab[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function request(test: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    setChecked([]);
    try {
      const response = await fetch(path, {
        method: test ? "POST" : "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "numbering", source, sheetUrl: sheetUrl.trim() }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Sumber nomor belum dapat diproses.");
      setSheetUrl(result.data.sheetUrl);
      if (test) setChecked(result.data.tabs);
      setMessage(test ? "Google Sheets berhasil dibaca." : "Sumber nomor tersimpan.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sumber nomor belum dapat diproses.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy) void request(false);
  }

  return <section className="card">
    <div className="card-head"><h3>Sumber Nomor Surat</h3></div>
    <div className="card-body">
      <form className="form-grid workflow-form" onSubmit={submit}>
        <label className="field full"><span>Sumber</span>
          <select className="select" value={source} disabled={busy} onChange={event => {
            setSource(event.target.value as NumberSourceSettings["source"]); setMessage(""); setError(""); setChecked([]);
          }}>
            <option value="SIAP">Data impor / register SIAP</option>
            <option value="SHEETS">Google Sheets langsung</option>
          </select>
        </label>
        <p className="hint field full">
          Register SIAP memakai nomor dari draf, surat, Nota Dinas, dan data Excel yang diimpor. Google Sheets dibaca saat memperkirakan dan mengambil nomor untuk seri ARU pada workbook.
        </p>
        <label className="field full"><span>Tautan Google Sheets</span>
          <input className="input" type="url" maxLength={2048} placeholder="https://docs.google.com/spreadsheets/d/…" value={sheetUrl}
            required={source === "SHEETS"} disabled={busy} onChange={event => {
              setSheetUrl(event.target.value); setMessage(""); setError(""); setChecked([]);
            }}/>
        </label>
        <small className="hint field full">Gunakan workbook Form Persuratan ARU. Beri service account SIAP akses Viewer pada workbook yang dipakai.</small>
        <div className="attachment-actions field full">
          <button type="button" className="btn btn-secondary" disabled={busy || !sheetUrl.trim()} onClick={() => void request(true)}>Uji koneksi Sheets</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Memproses…" : "Simpan sumber nomor"}</button>
          <a href="/api/letters/outgoing-excel" className="btn btn-secondary">Unduh register Excel</a>
        </div>
        {message && <p className="field full success" role="status">{message}</p>}
        {checked.length > 0 && <ul className="field full">
          {checked.map(item => <li key={item.tab}>{item.tab} · {item.count} nomor
            {item.incompleteDates > 0 && ` · ${item.incompleteDates} tanggal kosong atau tidak terbaca`}</li>)}
        </ul>}
        {error && <p className="field full error" role="alert">{error}</p>}
      </form>
    </div>
  </section>;
}
