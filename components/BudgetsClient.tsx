"use client";
import { FormEvent,useEffect,useState } from "react";
import type { SessionUser } from "@/lib/types";
import Modal from "@/components/Modal";
import { useAppDialog } from "@/components/AppDialogProvider";
const rupiah=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);

export default function BudgetsClient({user}:{user:SessionUser}){
  const dialog=useAppDialog();
  const [rows,setRows]=useState<any[]>([]);const [open,setOpen]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");
  const canEdit=["ROOT_ADMIN","FINANCE"].includes(user.role);
  async function load(){const r=await fetch("/api/finance/budgets");const j=await r.json();if(j.ok)setRows(j.data);else setError(j.error)}
  useEffect(()=>{load()},[]);
  async function create(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);const r=await fetch("/api/finance/budgets",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(fd.entries()))});const j=await r.json();if(!r.ok){setError(j.error);return}setOpen(false);setMessage("Anggaran berhasil disimpan / diperbarui.");await load()}
  return <main className="page">
    <div className="page-head"><div><h2>Anggaran</h2><p>Pagu per kategori dan tahun. Kategori yang sama pada tahun yang sama akan di-update.</p></div>{canEdit&&<button className="btn btn-primary" onClick={()=>setOpen(true)}>+ Tambah / Update Anggaran</button>}</div>
    {message&&<div className="success" style={{marginBottom:12}}>{message}</div>}{error&&<div className="error" style={{marginBottom:12}}>{error}</div>}
    <div className="card"><div className="table-wrap"><table className="table"><thead><tr><th>Tahun</th><th>Kategori</th><th>Pagu</th><th>Catatan</th><th>Updated</th><th>Aksi</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.id}><td>{r.budget_year}</td><td><b>{r.category}</b></td><td>{rupiah(Number(r.amount))}</td><td>{r.notes||"-"}</td><td>{new Date(r.updated_at).toLocaleString("id-ID")}</td><td>{user.role==="ROOT_ADMIN"&&<button className="btn btn-danger" onClick={async()=>{const ok=await dialog.confirm({title:"Hapus Anggaran",message:`Hapus anggaran ${r.category} tahun ${r.budget_year}?`,detail:"Aktivitas penghapusan tetap dapat ditelusuri melalui Audit Log.",confirmLabel:"Hapus",tone:"danger"});if(!ok)return;const rr=await fetch(`/api/finance/budgets/${r.id}`,{method:"DELETE"});const jj=await rr.json();if(!rr.ok){setError(jj.error);return}setMessage("Anggaran dihapus.");await load()}}>Hapus</button>}</td></tr>)}
      {!rows.length&&<tr><td colSpan={6}><div className="empty">Belum ada anggaran.</div></td></tr>}
    </tbody></table></div></div>
    {open&&<Modal title="Tambah / Update Anggaran" onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={create}>
      <div className="field"><label>Tahun</label><input className="input" type="number" min="2000" max="2100" name="budget_year" defaultValue={new Date().getFullYear()} required/></div>
      <div className="field"><label>Kategori</label><input className="input" name="category" required/></div>
      <div className="field"><label>Pagu</label><input className="input" type="number" min="0" step="0.01" name="amount" required/></div>
      <div className="field full"><label>Catatan</label><textarea className="textarea" name="notes"/></div>
      <div className="field full" style={{display:"flex",flexDirection:"row",justifyContent:"flex-end",gap:8}}><button type="button" className="btn btn-secondary" onClick={()=>setOpen(false)}>Batal</button><button className="btn btn-primary">Simpan</button></div>
    </form></Modal>}
  </main>
}
