"use client";

import { useState } from "react";
import V11SigningPanel, { type SandboxSource } from "@/components/V11SigningPanel";
import LocalSignature from "@/components/LocalSignature";

export default function AttachmentSandbox({ files, local = false, onSaved }: {
  files: (SandboxSource & { original_size: number })[]; local?: boolean; onSaved?: () => void | Promise<void>;
}) {
  const [sourceId, setSourceId] = useState("");
  const pdfs = files.filter(file => /\.pdf$/i.test(file.original_name) && Number(file.original_size) <= 10 * 1024 * 1024);
  const source = pdfs.find(file => file.id === sourceId);
  if (!pdfs.length) return null;
  return <section className="card" style={{ marginTop: 12 }}>
    <div className="card-body">
      <label className="field"><span>{local ? "PDF untuk tanda tangan simulasi" : "PDF untuk tanda tangan Sandbox"}</span>
        <select className="select" value={sourceId} onChange={event => setSourceId(event.target.value)}>
          <option value="">Pilih lampiran PDF</option>
          {pdfs.map(file => <option key={file.id} value={file.id}>{file.original_name}</option>)}
        </select>
      </label>
      {source && (local ? <LocalSignature key={source.id} id={source.id} onSaved={onSaved}/>
        : <V11SigningPanel key={source.id} id={source.id} source={source}/>)}
    </div>
  </section>;
}
