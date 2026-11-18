"use client";
import { useId } from "react";
export default function Modal({title,subtitle,children,onClose}:{title:string;subtitle?:string;children:React.ReactNode;onClose:()=>void}) {
  const titleId = useId();
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target) onClose()}}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal-head"><div><h3 id={titleId}>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div><button type="button" className="close-btn" aria-label="Tutup dialog" onClick={onClose}>×</button></div>
      <div className="modal-body">{children}</div>
    </div>
  </div>
}
