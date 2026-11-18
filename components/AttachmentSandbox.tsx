"use client";

import { useState } from "react";
import V11SigningPanel, { type SandboxSource } from "@/components/V11SigningPanel";

export default function AttachmentSandbox({ files }: { files: (SandboxSource & { original_size: number })[] }) {
  const [sourceId, setSourceId] = useState("");
  const pdfs = files.filter(file => /\.pdf$/i.test(file.original_name) && Number(file.original_size) <= 10 * 1024 * 1024);
  const source = pdfs.find(file => file.id === sourceId);
  if (!pdfs.length) return null;
  return <section className="card" style={{ marginTop: 12 }}>
    <div className="card-body">
      <label className="field"><span>PDF untuk tanda tangan Sandbox</span>
        <select className="select" value={sourceId} onChange={event => setSourceId(event.target.value)}>
          <option value="">Pilih lampiran PDF</option>
          {pdfs.map(file => <option key={file.id} value={file.id}>{file.original_name}</option>)}
        </select>
      </label>
      {source && <V11SigningPanel key={source.id} id={source.id} source={source}/>}
    </div>
  </section>;
}
