"use client";
import { FormEvent,useEffect,useMemo,useState } from "react";
import type { SessionUser } from "@/lib/types";
import Modal from "@/components/Modal";
import StatusBadge from "@/components/StatusBadge";
import { useAppDialog } from "@/components/AppDialogProvider";

const rupiah=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);
export default function FinanceEntriesClient({type,user}:{type:"INCOME"|"EXPENSE";user:SessionUser}){
  const dialog=useAppDialog();
  const [rows,setRows]=useState<any[]>([]);const [open,setOpen]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");
  const canEdit=["ROOT_ADMIN","FINANCE"].includes(user.role);
  async function load(){const r=await fetch(`/api/finance/entries?type=${type}`);const j=await r.json();if(j.ok)setRows(j.data);else setError(j.error)}
  useEffect(()=>{load()},[type]);
  const total=useMemo(()=>rows.reduce((a,r)=>a+Number(r.amount||0),0),[rows]);
  async function create(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);const body=Object.fromEntries(fd.entries());body.entry_type=type;const r=await fetch("/api/finance/entries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const j=await r.json();if(!r.ok){setError(j.error);return}setOpen(false);setMessage("Data berhasil disimpan.");await load()}
  return <main className="page">
    <div className="page-head"><div><h2>{type==="INCOME"?"Pendapatan":"Biaya"}</h2><p>Pencatatan dikelola oleh Finance / Root Admin.</p></div>{canEdit&&<button className="btn btn-primary" onClick={()=>setOpen(true)}>+ Input {type==="INCOME"?"Pendapatan":"Biaya"}</button>}</div>
    {message&&<div className="success" style={{marginBottom:12}}>{message}</div>}{error&&<div className="error" style={{marginBottom:12}}>{error}</div>}
    <div className="stats"><div className="stat"><div className="stat-label">Total Data Tampil</div><div className="stat-value">{rupiah(total)}</div><div className="stat-sub">{rows.length} transaksi</div></div></div>
    <div className="card"><div className="table-wrap"><table className="table"><thead><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th>Referensi</th><th>Nominal</th><th>Status</th><th>Input Oleh</th><th>Aksi</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.id}><td>{String(r.entry_date).slice(0,10)}</td><td>{r.category}</td><td>{r.description}</td><td>{r.reference_no||"-"}</td><td><b>{rupiah(Number(r.amount))}</b></td><td><StatusBadge status={r.status}/></td><td>{r.creator_name}</td><td><div style={{display:"flex",gap:6}}>
        {canEdit&&<button className="btn btn-secondary" onClick={async()=>{const amount=await dialog.prompt({title:`Edit ${type==="INCOME"?"Pendapatan":"Biaya"}`,message:r.description,label:"Nominal baru",initialValue:String(r.amount),inputType:"number",required:true,confirmLabel:"Lanjut"});if(amount===null)return;const status=await dialog.select({title:"Status Data",message:"Pilih status setelah perubahan nominal.",label:"Status",options:["POSTED","PENDING","VERIFIED"].map(x=>({value:x,label:x})),initialValue:String(r.status),required:true,confirmLabel:"Simpan"});if(!status)return;const rr=await fetch(`/api/finance/entries/${r.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount,status})});const jj=await rr.json();if(!rr.ok){setError(jj.error);return}setMessage("Data diperbarui.");await load()}}>Edit</button>}
        {user.role==="ROOT_ADMIN"&&<button className="btn btn-danger" onClick={async()=>{const ok=await dialog.confirm({title:"Hapus Data Keuangan",message:`Hapus ${r.description}?`,detail:"Audit Log penghapusan tetap disimpan.",confirmLabel:"Hapus",tone:"danger"});if(!ok)return;const rr=await fetch(`/api/finance/entries/${r.id}`,{method:"DELETE"});const jj=await rr.json();if(!rr.ok){setError(jj.error);return}setMessage("Entry dihapus.");await load()}}>Hapus</button>}
      </div></td></tr>)}
      {!rows.length&&<tr><td colSpan={8}><div className="empty">Belum ada data.</div></td></tr>}
    </tbody></table></div></div>
    {open&&<Modal title={`Input ${type==="INCOME"?"Pendapatan":"Biaya"}`} subtitle="Manual entry; seluruh input tercatat di audit log." onClose={()=>setOpen(false)}>
      <form className="form-grid" onSubmit={create}>
        <div className="field"><label>Tanggal</label><input className="input" type="date" name="entry_date" defaultValue={new Date().toISOString().slice(0,10)} required/></div>
        <div className="field"><label>Kategori</label><input className="input" name="category" required placeholder={type==="INCOME"?"Jasa / Pendapatan Operasional":"Operasional / SDM / IT"}/></div>
        <div className="field full"><label>Deskripsi</label><input className="input" name="description" required/></div>
        <div className="field"><label>Nominal</label><input className="input" type="number" min="0" step="0.01" name="amount" required/></div>
        <div className="field"><label>Status</label><select className="select" name="status"><option value="POSTED">POSTED</option><option value="PENDING">PENDING</option><option value="VERIFIED">VERIFIED</option></select></div>
        <div className="field full"><label>No. Referensi</label><input className="input" name="reference_no"/></div>
        <div className="field full" style={{display:"flex",flexDirection:"row",justifyContent:"flex-end",gap:8}}><button type="button" className="btn btn-secondary" onClick={()=>setOpen(false)}>Batal</button><button className="btn btn-primary">Simpan</button></div>
      </form>
    </Modal>}
  </main>
}
