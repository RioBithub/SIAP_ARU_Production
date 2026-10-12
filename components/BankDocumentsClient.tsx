"use client";

import { useEffect,useMemo,useState } from "react";
import type { FormEvent } from "react";
import type { SessionUser } from "@/lib/types";

type Account={id:string;bank_name:string;account_number:string;account_name:string};
type BankDocument={
  id:string;bank_account_id:string;bank_name:string;account_number:string;account_name:string;
  document_date:string;period_from:string|null;period_to:string|null;document_kind:string;description:string|null;
  original_name:string;mime_type:string;original_size:number;stored_size:number;is_compressed:number;created_at:string;uploader_name:string;
};

const pad=(n:number)=>String(n).padStart(2,"0");
function localDate(){const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function dateLabel(v?:string|null){if(!v)return "-";const d=new Date(`${String(v).slice(0,10)}T00:00:00`);return Number.isNaN(d.getTime())?String(v):new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"short",year:"numeric"}).format(d)}
function bytes(v:number){const n=Number(v||0);if(n<1024)return `${n} B`;if(n<1024*1024)return `${(n/1024).toFixed(1)} KB`;return `${(n/1024/1024).toFixed(1)} MB`}
function kindLabel(v:string){return ({REKENING_KORAN:"Rekening Koran Bank",REKENING_KORAN_BRI:"Rekening Koran BRI",BUKTI_TRANSFER:"Bukti Transfer",BUKTI_PEMBAYARAN:"Bukti Pembayaran",KONFIRMASI_BANK:"Konfirmasi Bank",LAINNYA:"Lainnya"} as Record<string,string>)[v]||v.replaceAll("_"," ")}

export default function BankDocumentsClient({user}:{user:SessionUser}){
  const canEdit=user.role==="ROOT_ADMIN"||user.role==="FINANCE";
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [accountId,setAccountId]=useState("");
  const [rows,setRows]=useState<BankDocument[]>([]);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [deletingId,setDeletingId]=useState("");
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [documentDate,setDocumentDate]=useState(localDate());
  const [periodFrom,setPeriodFrom]=useState("");
  const [periodTo,setPeriodTo]=useState("");
  const [kind,setKind]=useState("REKENING_KORAN");
  const [description,setDescription]=useState("");
  const [file,setFile]=useState<File|null>(null);

  async function loadDocuments(id=accountId){
    setLoading(true);setError("");
    try{
      const q=id?`?account_id=${encodeURIComponent(id)}`:"";
      const r=await fetch(`/api/finance/bank-documents${q}`,{cache:"no-store"});const j=await r.json();
      if(!j.ok)throw new Error(j.error||"Gagal memuat dokumen bank.");
      setRows(j.data||[]);
    }catch(e){setError(e instanceof Error?e.message:"Gagal memuat dokumen bank.")}
    finally{setLoading(false)}
  }

  async function loadAccounts(){
    try{
      const r=await fetch("/api/finance/bank-accounts",{cache:"no-store"});const j=await r.json();
      if(!j.ok)throw new Error(j.error||"Gagal memuat rekening.");
      const list=(j.data||[]) as Account[];setAccounts(list);
      const first=list[0]?.id||"";setAccountId(first);await loadDocuments(first);
    }catch(e){setError(e instanceof Error?e.message:"Gagal memuat rekening.")}
  }

  useEffect(()=>{void loadAccounts()},[]);

  async function upload(e:FormEvent){
    e.preventDefault();if(!accountId||!file)return;setSaving(true);setError("");setMessage("");
    try{
      const fd=new FormData();
      fd.set("bank_account_id",accountId);fd.set("document_date",documentDate);fd.set("period_from",periodFrom);fd.set("period_to",periodTo);fd.set("document_kind",kind);fd.set("description",description);fd.set("file",file);
      const r=await fetch("/api/finance/bank-documents",{method:"POST",body:fd});const j=await r.json();
      if(!j.ok)throw new Error(j.error||"Upload dokumen gagal.");
      setMessage("Dokumen bank berhasil dilampirkan.");setPeriodFrom("");setPeriodTo("");setDescription("");setFile(null);
      const input=document.getElementById("bank-document-file") as HTMLInputElement|null;if(input)input.value="";
      await loadDocuments();
    }catch(e){setError(e instanceof Error?e.message:"Upload dokumen gagal.")}
    finally{setSaving(false)}
  }

  async function removeDocument(row:BankDocument){
    const ok=window.confirm(`Hapus permanen dokumen \"${row.original_name}\"?\n\nFile fisik dan record dokumen akan dihapus. Tindakan ini tidak dapat di-undo.`);
    if(!ok)return;
    setDeletingId(row.id);setError("");setMessage("");
    try{
      const r=await fetch(`/api/finance/bank-documents/${row.id}`,{method:"DELETE"});const j=await r.json();
      if(!j.ok)throw new Error(j.error||"Gagal menghapus dokumen.");
      setMessage(j.data?.file_warning?`Dokumen dihapus dari SIAP. ${j.data.file_warning}`:"Dokumen berhasil dihapus permanen.");
      await loadDocuments();
    }catch(e){setError(e instanceof Error?e.message:"Gagal menghapus dokumen.")}
    finally{setDeletingId("")}
  }

  const selected=useMemo(()=>accounts.find(a=>a.id===accountId)||null,[accounts,accountId]);

  return <main className="page">
    <div className="page-head"><div><h2>Dokumen Bank</h2><p>Lampiran pendukung per rekening, lengkap dengan tanggal dokumen dan periode dokumen tersebut berlaku.</p></div><a className="btn btn-secondary" href="/finance/bank-statement">← Rekening Koran</a></div>
    <div className="notice" style={{marginBottom:14}}><b>Penanda waktu dokumen:</b> “Tanggal Dokumen” adalah tanggal yang tertera pada dokumen. “Periode Untuk” dipakai bila dokumen mewakili rentang tertentu, misalnya rekening koran 1–31 Oktober 2026. Finance/Root dapat upload dan hapus permanen; Manager, Dirops, dan Dirut view-only.</div>
    {message&&<div className="success" style={{marginBottom:12}}>{message}</div>}{error&&<div className="error" style={{marginBottom:12}}>{error}</div>}

    <section className="card" style={{marginBottom:16}}><div className="card-body"><div className="field"><label>Rekening yang ditampilkan</label><select className="select" value={accountId} onChange={e=>{setAccountId(e.target.value);void loadDocuments(e.target.value)}}><option value="">Semua rekening</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.bank_name} • {a.account_number} • {a.account_name}</option>)}</select></div></div></section>

    {canEdit&&<section className="card" style={{marginBottom:16}}><div className="card-head"><div><h3>Lampirkan Dokumen</h3><p>File maksimal 10 MB. PDF, Word, Excel, gambar, TXT, atau CSV.</p></div></div><div className="card-body"><form className="form-grid" onSubmit={upload}>
      <div className="field full"><label>Rekening</label><select className="select" value={accountId} onChange={e=>setAccountId(e.target.value)} required><option value="">Pilih rekening...</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.bank_name} • {a.account_number}</option>)}</select></div>
      <div className="field"><label>Tanggal Dokumen</label><input className="input" type="date" value={documentDate} onChange={e=>setDocumentDate(e.target.value)} required/></div>
      <div className="field"><label>Jenis Dokumen</label><select className="select" value={kind} onChange={e=>setKind(e.target.value)}><option value="REKENING_KORAN">Rekening Koran Bank</option><option value="BUKTI_TRANSFER">Bukti Transfer</option><option value="BUKTI_PEMBAYARAN">Bukti Pembayaran</option><option value="KONFIRMASI_BANK">Konfirmasi Bank</option><option value="LAINNYA">Lainnya</option></select></div>
      <div className="field"><label>Periode Untuk — Dari</label><input className="input" type="date" value={periodFrom} onChange={e=>setPeriodFrom(e.target.value)}/><span className="hint">Opsional. Contoh: awal minggu/bulan yang dicakup dokumen.</span></div>
      <div className="field"><label>Periode Untuk — Sampai</label><input className="input" type="date" value={periodTo} onChange={e=>setPeriodTo(e.target.value)}/><span className="hint">Opsional. Isi bersama tanggal awal bila dokumen untuk suatu periode.</span></div>
      <div className="field full"><label>Keterangan</label><input className="input" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Contoh: Rekening koran BRI untuk rekonsiliasi minggu ke-2 Oktober 2026"/></div>
      <div className="field full"><label>File Dokumen</label><input id="bank-document-file" className="input" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv" onChange={e=>setFile(e.target.files?.[0]||null)} required/></div>
      <div className="field full" style={{display:"flex",justifyContent:"flex-end",flexDirection:"row"}}><button className="btn btn-primary" disabled={saving||!accountId||!file}>{saving?"Mengunggah...":"Upload Dokumen"}</button></div>
    </form></div></section>}

    <section className="card"><div className="card-head"><div><h3>Dokumen Tersimpan</h3><p>{selected?`${selected.bank_name} • ${selected.account_number}`:"Semua rekening"}</p></div><span className="badge blue">{rows.length} dokumen</span></div><div className="table-wrap"><table className="table"><thead><tr><th>Tanggal Dokumen</th><th>Periode Untuk</th><th>Jenis</th><th>Keterangan</th><th>File</th><th>Upload Oleh</th><th>Aksi</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td className="nowrap"><b>{dateLabel(r.document_date)}</b><div className="muted">{r.bank_name} • {r.account_number}</div></td><td>{r.period_from||r.period_to?<>{dateLabel(r.period_from)} — {dateLabel(r.period_to)}</>:<span className="muted">Tidak ditentukan</span>}</td><td><span className="badge gray">{kindLabel(r.document_kind)}</span></td><td>{r.description||<span className="muted">-</span>}</td><td><b>{r.original_name}</b><div className="muted">{bytes(r.original_size)}{r.is_compressed?" • tersimpan terkompresi":""}</div></td><td>{r.uploader_name}<div className="muted">{r.created_at}</div></td><td><div style={{display:"flex",gap:6,flexWrap:"wrap"}}><a className="btn btn-secondary" href={`/api/finance/bank-documents/${r.id}/download`}>Download</a>{canEdit&&<button type="button" className="btn btn-danger" disabled={deletingId===r.id} onClick={()=>void removeDocument(r)}>{deletingId===r.id?"Menghapus...":"Hapus"}</button>}</div></td></tr>)}{!rows.length&&!loading&&<tr><td colSpan={7} className="empty">Belum ada dokumen bank untuk filter ini.</td></tr>}{loading&&<tr><td colSpan={7} className="empty">Memuat dokumen...</td></tr>}</tbody></table></div></section>
  </main>;
}
