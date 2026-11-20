"use client";

import { useEffect, useState } from "react";
import AttachmentActions from "@/components/AttachmentActions";

export default function LocalSignature({ id, onSaved }: { id: string; onSaved?: () => void | Promise<void> }) {
  const endpoint = "/api/attachments/" + id + "/signing";
  const [finalId, setFinalId] = useState("");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (active) setFinalId(result.data?.final_attachment_id ?? "");
    }).catch(() => {
      if (active) setError("Status tanda tangan simulasi belum dapat dimuat.");
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, [endpoint]);

  async function simulate() {
    setError("");
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SIMULATE", mark_count: count }),
      });
      const result = await response.json();
      if (!response.ok || !result.data?.final_attachment_id) throw new Error(result.error || "PDF simulasi gagal dibuat.");
      setFinalId(result.data.final_attachment_id);
      await onSaved?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PDF simulasi gagal dibuat.");
    } finally {
      setBusy(false);
    }
  }

  return <div style={{ marginTop: 10 }}>
    {finalId ? <AttachmentActions id={finalId} name="Bukti-Tanda-Tangan-SIMULASI.pdf" downloadLabel="Unduh PDF tanda tangan simulasi"/>
      : <div className="attachment-actions">
        <label className="field"><span>Jumlah paraf contoh</span>
          <select className="select" value={count} onChange={event => setCount(Number(event.target.value))} disabled={busy}>
            <option value={1}>1 paraf</option><option value={2}>2 paraf</option>
          </select>
        </label>
        <button className="btn btn-primary" type="button" onClick={() => void simulate()} disabled={busy}>
          {busy ? "Memproses…" : "Buat Tanda Tangan Simulasi"}
        </button>
      </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
