"use client";
import { FormEvent,useEffect,useMemo,useState } from "react";
import { useAppDialog } from "@/components/AppDialogProvider";

type EntityType="SUMMARY"|"RECEIVABLE"|"PAYABLE"|"LEDGER_SUMMARY"|"ADJUSTMENT"|"POSITION_ADJUSTMENT";
type Props={
  entityType:EntityType;
  entityId?:string|null;
  periodMonth?:string;
  canEdit:boolean;
  title?:string;
  reportMode?:boolean;
  ledgerKind?:"receivables"|"payables";
};

const size=(n:number)=>n<1024*1024?`${Math.max(1,Math.round(n/1024))} KB`:`${(n/1024/1024).toFixed(2)} MB`;
function reportDeadline(periodMonth:string){
  const [y,m]=periodMonth.split("-").map(Number);
  const d=new Date(y,m,10,23,59,59); // JS month is zero-based: m = next month relative to YYYY-MM
  return d;
}
function formatDate(v:string|Date){return new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v));}
function monthLabel(periodMonth:string){
  const [y,m]=periodMonth.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID",{month:"long",year:"numeric"}).format(new Date(y,m-1,1));
}

export default function FinanceAttachmentsPanel({entityType,entityId,periodMonth,canEdit,title="Lampiran",reportMode=false,ledgerKind}:Props){
  const dialog=useAppDialog();
  const [rows,setRows]=useState<any[]>([]);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [deletingId,setDeletingId]=useState<string|null>(null);

  const query=useMemo(()=>{
    const p=new URLSearchParams({entity_type:entityType});
    if(entityId)p.set("entity_id",entityId);
    if(periodMonth)p.set("period_month",periodMonth);
    if(ledgerKind)p.set("ledger_kind",ledgerKind);
    return p.toString();
  },[entityType,entityId,periodMonth,ledgerKind]);

  async function load(){
    setError("");
    const r=await fetch(`/api/finance/attachments?${query}`,{cache:"no-store"});
    const j=await r.json(); if(j.ok)setRows(j.data||[]);else setError(j.error||"Gagal memuat lampiran.");
  }
  useEffect(()=>{load()},[query]);

  async function upload(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const form=e.currentTarget;
    setBusy(true);setError("");setMessage("");
    try{
      const fd=new FormData(form);
      fd.set("entity_type",entityType);
      if(entityId)fd.set("entity_id",entityId);
      if(periodMonth)fd.set("period_month",periodMonth);
      if(ledgerKind)fd.set("ledger_kind",ledgerKind);
      fd.set("attachment_kind",reportMode?"MONTHLY_REPORT":"SUPPORTING");
      const r=await fetch("/api/finance/attachments",{method:"POST",body:fd});
      const j=await r.json(); if(!r.ok)throw new Error(j.error||"Upload gagal.");
      form.reset();
      setMessage("Lampiran berhasil diunggah. Riwayat upload tetap tersimpan di Audit Log.");
      await load();
    }catch(err){setError(err instanceof Error?err.message:"Upload gagal.");}finally{setBusy(false)}
  }

  async function removeAttachment(a:any){
    if(!canEdit||deletingId)return;
    const ok=await dialog.confirm({title:"Hapus Lampiran",message:`Hapus “${a.original_name}”?`,detail:"File akan dihapus dari storage, tetapi aktivitas penghapusan tetap tercatat di Audit Log.",confirmLabel:"Hapus Lampiran",tone:"danger"});if(!ok)return;
    setDeletingId(String(a.id));setError("");setMessage("");
    try{
      const r=await fetch(`/api/finance/attachments/${a.id}`,{method:"DELETE"});
      const j=await r.json();if(!r.ok)throw new Error(j.error||"Gagal menghapus lampiran.");
      setMessage("Lampiran berhasil dihapus. Aktivitas penghapusan tetap tersimpan di Audit Log.");
      await load();
    }catch(err){setError(err instanceof Error?err.message:"Gagal menghapus lampiran.");}finally{setDeletingId(null)}
  }

  const deadline=reportMode&&periodMonth?reportDeadline(periodMonth):null;
  const now=new Date();
  return <div>
    <div className="card-head" style={{paddingLeft:0,paddingRight:0,paddingTop:0}}>
      <div><h3>{title}</h3>{reportMode&&periodMonth&&<p>Dokumen {monthLabel(periodMonth)} dapat dilengkapi kapan saja. Gunakan bagian ini untuk laporan bulanan, rekap, rekonsiliasi, atau bukti pendukung agar pembaca dapat menelusuri dasar angkanya. Semua file yang tersimpan dapat diunduh kembali. Panduan administrasi 1–10 bulan berikutnya tetap ditampilkan tanpa mengunci periode.</p>}</div>
      {deadline&&<span className={`badge ${now>deadline?"orange":"blue"}`}>Panduan 1–10 {new Intl.DateTimeFormat("id-ID",{month:"short",year:"numeric"}).format(deadline)}</span>}
    </div>
    {message&&<div className="success" style={{marginBottom:10}}>{message}</div>}
    {error&&<div className="error" style={{marginBottom:10}}>{error}</div>}
    {canEdit&&<form onSubmit={upload} className="finance-upload-row">
      <input className="input" type="file" name="file" required accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv"/>
      <button className="btn btn-primary" disabled={busy}>{busy?"Mengunggah...":"+ Unggah Lampiran"}</button>
      <span className="hint">Maks. 10 MB. Finance/Root dapat menghapus lampiran; upload dan penghapusan tetap tercatat di Audit Log.</span>
    </form>}
    <div className="attachment-list">
      {rows.map((a:any)=>{
        const onTime=deadline ? new Date(a.created_at)<=deadline : true;
        const saved=Math.max(0,Number(a.original_size||0)-Number(a.stored_size||0));
        return <div className="attachment-item" key={a.id}>
          <div className="file-icon">DOC</div>
          <div style={{minWidth:0}}><b className="file-name">{a.original_name}</b><p>{size(Number(a.original_size||0))}{canEdit?` • ${a.is_compressed?`compressed, hemat ${size(saved)}`:"disimpan optimal"}`:""} • {a.uploader_name||"-"} • {formatDate(a.created_at)}</p></div>
          <div className="attachment-actions">
            {reportMode&&<span className={`badge ${onTime?"green":"orange"}`}>{onTime?"Dalam panduan":"Setelah panduan"}</span>}
            <a className="btn btn-secondary" href={`/api/finance/attachments/${a.id}`} download>↓ Unduh</a>
            {canEdit&&<button type="button" className="btn btn-danger" disabled={deletingId===String(a.id)} onClick={()=>removeAttachment(a)}>{deletingId===String(a.id)?"Menghapus...":"Hapus"}</button>}
          </div>
        </div>;
      })}
      {!rows.length&&<div className="empty">Belum ada lampiran untuk data ini.</div>}
    </div>
  </div>;
}
