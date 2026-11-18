"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Modal from "@/components/Modal";
import PdfPreview from "@/components/PdfPreview";

export default function AttachmentActions({ id, name, downloadLabel = "↓ Unduh" }: {
  id: string;
  name: string;
  downloadLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const pdf = /\.pdf$/i.test(name);
  const image = /\.(png|jpe?g)$/i.test(name);
  const path = "/api/attachments/" + encodeURIComponent(id);
  return <span className="attachment-actions">
    {(pdf || image) && <button className="btn btn-secondary" type="button"
      onClick={() => { setImageError(false); setOpen(true); }}>Pratinjau</button>}
    <a href={path} className="btn btn-secondary" download>{downloadLabel}</a>
    {open && createPortal(<Modal title={name} onClose={() => setOpen(false)}>
      {pdf ? <PdfPreview id={id} title={name}/> : imageError
        ? <div className="error" role="alert">Gambar belum dapat ditampilkan.</div>
        : <img className="attachment-image-preview" src={path + "?preview=1"} alt={name} onError={() => setImageError(true)}/>}
      <div className="modal-actions"><a href={path} className="btn btn-secondary" download>{downloadLabel}</a></div>
    </Modal>, document.body)}
  </span>;
}
