"use client";
export default function Modal({title,subtitle,children,onClose}:{title:string;subtitle?:string;children:React.ReactNode;onClose:()=>void}) {
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target) onClose()}}>
    <div className="modal">
      <div className="modal-head"><div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div><button className="close-btn" onClick={onClose}>×</button></div>
      <div className="modal-body">{children}</div>
    </div>
  </div>
}
