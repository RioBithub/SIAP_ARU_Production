"use client";
import { FormEvent,useEffect,useMemo,useState } from "react";
import Modal from "@/components/Modal";
import { useAppDialog } from "@/components/AppDialogProvider";

const TYPES=[
 ["PERJANJIAN_KERJA_SAMA","Perjanjian Kerja Sama"],
 ["SURAT_DIREKSI","Surat Keluar Direksi"],
 ["SURAT_OPERASIONAL","Surat Bagian Operasional"],
 ["PURCHASE_ORDER","Purchase Order (PO)"],
 ["SURAT_UMUM","Surat Keluar Umum"]
] as const;
const PRESETS:Record<string,{pattern:string;source:string;examplePrefix:string}>={
  PERJANJIAN_KERJA_SAMA:{pattern:"P/{seq}/AR/{year}",source:"Excel ARU: P/ Nomor Surat / AR / tahun",examplePrefix:"P"},
  SURAT_DIREKSI:{pattern:"Dir/{seq}/AR/{year}",source:"Excel ARU: Dir/ Nomor Surat / AR / tahun",examplePrefix:"Dir"},
  SURAT_OPERASIONAL:{pattern:"Oprsl/{seq}/AR/{year}",source:"Excel ARU: Oprsl/ No. Surat / AR / tahun",examplePrefix:"Oprsl"},
  PURCHASE_ORDER:{pattern:"PO/{seq}/AR/{year}",source:"Excel ARU: PO/ No. Surat / AR / tahun",examplePrefix:"PO"},
  SURAT_UMUM:{pattern:"UM/{seq}/AR/{year}",source:"Excel ARU: UM/ Nomor Surat / AR / tahun",examplePrefix:"UM"}
};
const typeLabel=(v:string)=>TYPES.find(x=>x[0]===v)?.[1]||v;
const year=new Date().getFullYear();
function renderPreview(pattern:string,seq:number){return pattern.replaceAll("{seq}",String(seq||1)).replaceAll("{year}",String(year)).replaceAll("{short_year}",String(year).slice(-2)).replaceAll("{month}","09").replaceAll("{roman_month}","IX").replaceAll("{type}","SURAT");}

export default function NumberFormatsClient(){
  const dialog=useAppDialog();
  const [rows,setRows]=useState<any[]>([]);
  const [open,setOpen]=useState(false);
  const [editTarget,setEditTarget]=useState<any|null>(null);
  const [editForm,setEditForm]=useState({name:"",pattern:"",sequence_start:"1",description:""});
  const [newType,setNewType]=useState("SURAT_UMUM");
  const [error,setError]=useState("");const [message,setMessage]=useState("");

  async function load(){const r=await fetch("/api/admin/number-formats");const j=await r.json();if(j.ok)setRows(j.data);else setError(j.error)}
  useEffect(()=>{load()},[]);

  async function create(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setError("");
    const fd=new FormData(e.currentTarget);const body=Object.fromEntries(fd.entries());
    const r=await fetch("/api/admin/number-formats",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const j=await r.json();
    if(!r.ok){setError(j.error);return}setOpen(false);setMessage("Format berhasil dibuat.");await load();
  }
  function openEdit(f:any){
    setEditTarget(f);setEditForm({name:String(f.name||""),pattern:String(f.pattern||""),sequence_start:String(f.sequence_start||1),description:String(f.description||"")});
  }
  async function saveEdit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!editTarget)return;setError("");
    const sequence_start=Number(editForm.sequence_start);
    if(!Number.isInteger(sequence_start)||sequence_start<1){setError("Nomor awal/minimum harus angka bulat minimal 1.");return}
    const r=await fetch(`/api/admin/number-formats/${editTarget.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({...editForm,sequence_start})});const j=await r.json();
    if(!r.ok){setError(j.error);return}setEditTarget(null);setMessage("Format dan nomor awal/minimum berhasil diperbarui.");await load();
  }
  async function toggle(f:any){
    const ok=await dialog.confirm({title:f.is_active?"Nonaktifkan Format":"Aktifkan Format",message:`${f.name} akan ${f.is_active?"tidak tersedia":"tersedia kembali"} saat membuat surat keluar.`,detail:"Data dan nomor yang sudah pernah diterbitkan tidak berubah.",confirmLabel:f.is_active?"Nonaktifkan":"Aktifkan",tone:f.is_active?"danger":"success"});
    if(!ok)return;
    const r=await fetch(`/api/admin/number-formats/${f.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({is_active:!f.is_active})});const j=await r.json();if(!r.ok){setError(j.error);return}await load();
  }
  function applyPreset(){if(!editTarget)return;const p=PRESETS[editTarget.document_type];if(p)setEditForm(f=>({...f,pattern:p.pattern}));}
  const editPreset=editTarget?PRESETS[editTarget.document_type]:null;
  const newPreset=PRESETS[newType];
  const preview=useMemo(()=>renderPreview(editForm.pattern,Number(editForm.sequence_start||1)),[editForm]);

  return <main className="page">
    <div className="page-head"><div><h2>Format & Seri Nomor Surat</h2><p>Seri dipisahkan per jenis surat. Root Admin dapat mengubah format resmi dan nomor awal/minimum kapan saja.</p></div><button className="btn btn-primary" onClick={()=>setOpen(true)}>+ Format Baru</button></div>
    {message&&<div className="success" style={{marginBottom:12}}>{message}</div>}{error&&<div className="error" style={{marginBottom:12}}>{error}</div>}
    <div className="notice" style={{marginBottom:13}}><b>Referensi ARU:</b> format utama diselaraskan dengan workbook persuratan saat ini: <b>P</b>, <b>Dir</b>, <b>Oprsl</b>, <b>PO</b>, dan <b>UM</b>. Daftar web cukup menampilkan angka nomor; format lengkap tetap disimpan untuk dokumen dan ekspor Excel. Nomor custom/backdate yang bertabrakan menggunakan <b>.1, .2, ...</b> tanpa menggeser nomor lama.</div>
    <div className="card"><div className="table-wrap"><table className="table"><thead><tr><th>Kode</th><th>Jenis Surat</th><th>Nomor Awal / Minimum</th><th>Nomor Berikutnya</th><th>Format Resmi</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
      {rows.map(f=><tr key={f.id}><td><b>{f.code}</b></td><td><b>{f.name}</b><span className="muted" style={{display:"block",fontSize:10}}>{typeLabel(f.document_type)}</span></td><td className="mono"><b>{f.sequence_start||1}</b><span className="muted" style={{display:"block",fontSize:10}}>dapat diedit Root</span></td><td className="mono"><b>{f.next_auto_base||f.sequence_start||1}</b><span className="muted" style={{display:"block",fontSize:10}}>otomatis dari ledger {year}</span></td><td><span className="mono">{f.pattern}</span>{PRESETS[f.document_type]&&<span className="muted" style={{display:"block",fontSize:9.5,marginTop:4}}>{PRESETS[f.document_type].source}</span>}</td><td><span className={`badge ${f.is_active?"green":"gray"}`}>{f.is_active?"ACTIVE":"INACTIVE"}</span></td><td><div style={{display:"flex",gap:6,flexWrap:"wrap"}}><button className="btn btn-secondary" onClick={()=>openEdit(f)}>Edit</button><button className="btn btn-secondary" onClick={()=>toggle(f)}>{f.is_active?"Nonaktifkan":"Aktifkan"}</button></div></td></tr>)}
    </tbody></table></div></div>

    {editTarget&&<Modal title={`Edit ${editTarget.name}`} subtitle="Nomor awal/minimum dan format resmi dapat diubah tanpa menghapus histori nomor yang sudah ada." onClose={()=>setEditTarget(null)}>
      <form className="form-grid" onSubmit={saveEdit}>
        <div className="field"><label>Jenis Dokumen</label><div className="input" style={{background:"#f8fafc"}}>{typeLabel(editTarget.document_type)}</div></div>
        <div className="field"><label>Kode Seri</label><div className="input mono" style={{background:"#f8fafc"}}>{editTarget.code}</div></div>
        <div className="field"><label>Nama</label><input className="input" value={editForm.name} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))} required/></div>
        <div className="field"><label>Nomor Awal / Minimum</label><input className="input" type="number" min="1" step="1" value={editForm.sequence_start} onChange={e=>setEditForm(f=>({...f,sequence_start:e.target.value}))} required/><span className="hint">Contoh: 124. Jika ledger tahun ini sudah memiliki nomor lebih tinggi, nomor berikutnya tetap melanjutkan nomor terbesar agar tidak bentrok.</span></div>
        <div className="field full"><label>Format Resmi</label><div style={{display:"flex",gap:8}}><input className="input mono" value={editForm.pattern} onChange={e=>setEditForm(f=>({...f,pattern:e.target.value}))} required/>{editPreset&&<button type="button" className="btn btn-secondary" onClick={applyPreset}>Pakai Format Excel ARU</button>}</div><span className="hint">Wajib mengandung {'{seq}'}. Placeholder yang tersedia: {'{seq}'}, {'{year}'}, {'{short_year}'}, {'{month}'}, {'{roman_month}'}.</span></div>
        {editPreset&&<div className="field full"><div className="format-preview"><span>Referensi workbook</span><b>{editPreset.source}</b><span>Preview</span><b className="mono">{preview}</b></div></div>}
        <div className="field full"><label>Deskripsi</label><textarea className="textarea" value={editForm.description} onChange={e=>setEditForm(f=>({...f,description:e.target.value}))}/></div>
        <div className="field full modal-actions"><button type="button" className="btn btn-secondary" onClick={()=>setEditTarget(null)}>Batal</button><button className="btn btn-primary">Simpan Perubahan</button></div>
      </form>
    </Modal>}

    {open&&<Modal title="Tambah Format & Seri Nomor" subtitle="Gunakan hanya bila ARU menambah jenis seri surat baru." onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={create}>
      <div className="field"><label>Kode</label><input className="input" name="code" placeholder="LEGAL" required/></div>
      <div className="field"><label>Nama</label><input className="input" name="name" placeholder="Surat Legal" required/></div>
      <div className="field full"><label>Jenis Dokumen</label><select className="select" name="document_type" value={newType} onChange={e=>setNewType(e.target.value)}>{TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
      <div className="field"><label>Nomor Awal / Minimum</label><input className="input" type="number" min="1" step="1" name="sequence_start" defaultValue="1" required/></div>
      <div className="field"><label>Format Resmi</label><input className="input mono" name="pattern" key={newType} defaultValue={newPreset?.pattern||"{seq}/AR/{year}"} required/><span className="hint">{newPreset?.source}</span></div>
      <div className="field full"><label>Deskripsi</label><textarea className="textarea" name="description"/></div>
      <div className="field full modal-actions"><button type="button" className="btn btn-secondary" onClick={()=>setOpen(false)}>Batal</button><button className="btn btn-primary">Simpan</button></div>
    </form></Modal>}
  </main>
}
