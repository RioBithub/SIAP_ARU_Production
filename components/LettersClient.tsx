"use client";

import { FormEvent,useEffect,useMemo,useState } from "react";
import type { SessionUser } from "@/lib/types";
import Modal from "@/components/Modal";
import StatusBadge from "@/components/StatusBadge";
import { ROLE_LABELS } from "@/lib/types";
import { assertDocumentUploads, assertUploadSelection } from "@/lib/upload-policy";

type Direction="INCOMING"|"OUTGOING"|"INTERNAL";
type Props={direction:Direction;user:SessionUser};
type PendingAction={action:string;label:string;requiredComment?:boolean;issue?:boolean};

const today=()=>new Date().toISOString().slice(0,10);
const fmtDate=(v:any)=>v?new Date(String(v).slice(0,10)+"T00:00:00").toLocaleDateString("id-ID",{day:"2-digit",month:"short",year:"numeric"}):"-";
const size=(n:number)=>n<1024*1024?`${(n/1024).toFixed(0)} KB`:`${(n/1024/1024).toFixed(2)} MB`;
const DOC_LABELS:Record<string,string>={
  PERJANJIAN_KERJA_SAMA:"Perjanjian Kerja Sama",
  SURAT_DIREKSI:"Surat Keluar Direksi",
  SURAT_OPERASIONAL:"Bagian Operasional",
  PURCHASE_ORDER:"Purchase Order (PO)",
  SURAT_UMUM:"Surat Keluar Umum",
  SURAT_PERINTAH_KERJA:"Surat Perintah Kerja (SPK)",
  SURAT_MASUK_UMUM:"Surat Masuk Umum",
  NOTA_DINAS:"Nota Dinas",
  LEMBAR_PENGANTAR:"Lembar Pengantar"
};
const docLabel=(r:any)=>r.format_name||DOC_LABELS[r.document_type]||String(r.document_type||"-").replace(/_/g," ");
const DOC_TYPE_CLASS:Record<string,string>={
  PERJANJIAN_KERJA_SAMA:"letter-pks",
  PURCHASE_ORDER:"letter-po",
  SURAT_DIREKSI:"letter-direksi",
  SURAT_OPERASIONAL:"letter-operasional",
  SURAT_UMUM:"letter-umum",
  SURAT_PERINTAH_KERJA:"letter-umum",
  SURAT_MASUK_UMUM:"letter-masuk",
  NOTA_DINAS:"letter-nota",
  LEMBAR_PENGANTAR:"letter-nota"
};
const docTypeClass=(t:any)=>DOC_TYPE_CLASS[String(t||"")]||"letter-default";
const currentTargetLabel=(r:any)=>{
  if(r.current_owner_name){
    return `${r.current_owner_name}${r.current_owner_unit?` — ${r.current_owner_unit}`:""}`;
  }

  if(r.status==="DRAFT" && r.routing_target_name){
    return `Tujuan awal: ${r.routing_target_name}${r.routing_target_unit?` — ${r.routing_target_unit}`:""}`;
  }

  if(r.status==="FINANCE_REVIEW") return "Finance";
  if(r.status==="MANAGER_REVIEW") return "Manager";
  if(r.status==="DIRECTOR_OPS_REVIEW") return "Direktur Operasional";
  if(r.status==="PRESIDENT_DIRECTOR_REVIEW") return "Direktur Utama";
  if(r.status==="READY_TO_ISSUE") return "Staff Pembuat";
  if(r.status==="RETURNED_STAFF") return "Staff Pembuat";

  return "-";
};

const FALLBACK_LETTER_TYPE_OPTIONS=[
  ["PERJANJIAN_KERJA_SAMA","Perjanjian Kerja Sama"],
  ["PURCHASE_ORDER","Purchase Order (PO)"],
  ["SURAT_DIREKSI","Surat Keluar Direksi"],
  ["SURAT_OPERASIONAL","Bagian Operasional"],
  ["SURAT_UMUM","Surat Keluar Umum"],
  ["SURAT_PERINTAH_KERJA","Surat Perintah Kerja (SPK)"]
] as const;
const humanAction=(a:string)=>({SUBMIT:"Diajukan",APPROVE:"Disetujui & Diteruskan",APPROVE_FINAL:"Disetujui / Selesai",RETURN:"Dikembalikan",ISSUE:"Diterbitkan",CANCEL:"Dibatalkan",COMPLETE:"Diselesaikan",ADD_NOTE:"Catatan / Lampiran",RESPONSE:"Tanggapan",CREATE_OUTGOING:"Draft Dibuat",CREATE_INTERNAL:"Nota Dinas Dibuat",REGISTER_INCOMING:"Surat Diregistrasi",IMPORT_LEGACY_EXCEL:"Diimpor dari Excel Lama"}[a]||a.replace(/_/g," "));

function titleFor(direction:Direction){
  if(direction==="INCOMING") return "Surat Masuk";
  if(direction==="OUTGOING") return "Surat Keluar";
  return "Nota Dinas";
}

export default function LettersClient({direction,user}:Props){
  const [rows,setRows]=useState<any[]>([]);
  const [formats,setFormats]=useState<any[]>([]);
  const [documentTypes,setDocumentTypes]=useState<any[]>([]);
  const [reviewers,setReviewers]=useState<any[]>([]);
  const [financeReviewers,setFinanceReviewers]=useState<any[]>([]);
  const [reviewPath,setReviewPath]=useState("manager");
  const [view,setView]=useState("all");
  const [createBusy,setCreateBusy]=useState(false);
  const [readBusy,setReadBusy]=useState(false);
  const [q,setQ]=useState("");
  const [status,setStatus]=useState("");
  const [docType,setDocType]=useState("");
  const [year,setYear]=useState("");
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [createOpen,setCreateOpen]=useState(false);
  const [detail,setDetail]=useState<any>(null);
  const [detailOpen,setDetailOpen]=useState(false);
  const [editOpen,setEditOpen]=useState(false);
  const [outType,setOutType]=useState("SURAT_UMUM");
  const [pendingAction,setPendingAction]=useState<PendingAction|null>(null);
  const [actionFiles,setActionFiles]=useState<File[]>([]);
  const [actionBusy,setActionBusy]=useState(false);
  const [importOpen,setImportOpen]=useState(false);
  const [importFile,setImportFile]=useState<File|null>(null);
  const [importBusy,setImportBusy]=useState(false);
  const [importResult,setImportResult]=useState<any>(null);

  async function load(filters?:{q?:string;status?:string;docType?:string;year?:string;view?:string}){
    setLoading(true);setError("");
    const fq=filters?.q??q, fs=filters?.status??status, ft=filters?.docType??docType, fy=filters?.year??year;
    const p=new URLSearchParams({direction,limit:direction==="OUTGOING"?"2000":"500"});
    p.set("view",filters?.view??view);
    if(fq)p.set("q",fq);if(fs)p.set("status",fs);if(ft)p.set("document_type",ft);if(fy)p.set("year",fy);
    const res=await fetch(`/api/letters?${p}`);const j=await res.json();
    if(j.ok)setRows(j.data);else setError(j.error);
    setLoading(false);
  }
  async function loadFormats(){
    if(direction!=="OUTGOING")return;
    const [formatR,typeR]=await Promise.all([
      fetch("/api/admin/number-formats"),
      fetch("/api/admin/document-types?direction=OUTGOING&active=1")
    ]);
    const [formatJ,typeJ]=await Promise.all([formatR.json(),typeR.json()]);
    if(formatR.ok&&formatJ.ok)setFormats(formatJ.data.filter((x:any)=>x.is_active));
    if(typeR.ok&&typeJ.ok){
      setDocumentTypes(typeJ.data);
      if(typeJ.data.length && !typeJ.data.some((x:any)=>x.code===outType)) setOutType(typeJ.data[0].code);
    }
  }

  async function loadReviewers(){
    const r=await fetch("/api/users/lookup");
    const j=await r.json();

    if(j.ok){
      setReviewers(j.data.filter((x:any)=>x.role==="MANAGER"));
      setFinanceReviewers(j.data.filter((x:any)=>x.role==="FINANCE"&&x.id!==user.id));
    }
  }

  useEffect(()=>{
    const query=new URLSearchParams(window.location.search);
    const requested=query.get("view")||"all";
    const initialView=["all","attention","awareness"].includes(requested)?requested:"all";
    setView(initialView);void load({view:initialView});void loadFormats();void loadReviewers();
    if(query.get("letter_id"))void openDetail(query.get("letter_id")!);
  },[direction]);

  const canCreate=direction==="INTERNAL"
    ? ["ROOT_ADMIN","STAFF","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR","FINANCE"].includes(user.role)
    : ["ROOT_ADMIN","STAFF"].includes(user.role);
  const outgoingTypeOptions=(documentTypes.length
    ? documentTypes.map((x:any)=>[x.code,x.name] as [string,string])
    : [...FALLBACK_LETTER_TYPE_OPTIONS]);

  function formObject(fd:FormData){
    const out:any={};
    fd.forEach((value,key)=>{ out[key]=value; });
    return out;
  }

  async function create(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setError("");setMessage("");
    const fd=new FormData(e.currentTarget);
    fd.set("direction",direction);
    const original=fd.get("original_file");
    const main=original instanceof File&&original.size>0?original:null;
    const extras=fd.getAll("additional_files").filter((f):f is File=>f instanceof File&&f.size>0);
    try{
      assertDocumentUploads(main,extras);
      setCreateBusy(true);
      const res=await fetch("/api/letters",{method:"POST",body:fd});
      const j=await res.json();
      if(!res.ok)throw new Error(j.error||"Gagal menyimpan dokumen.");
      setCreateOpen(false);
      setMessage(direction==="INCOMING"?`Surat masuk diregistrasi dan dikirim ke ${reviewPath==="finance"?"Finance":"Manager"}. Dokumen dan lampiran tersimpan.`:direction==="INTERNAL"?"Nota Dinas tersimpan sebagai draft beserta dokumen dan lampiran. Buka detail untuk mengajukan review.":"Draft dan nomor surat berhasil dibuat beserta lampirannya.");
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Gagal menyimpan dokumen.");}
    finally{setCreateBusy(false);}
  }

  function selectProcessFiles(files:File[]){
    try{assertUploadSelection(files);setActionFiles(files);setError("");}
    catch(e){setActionFiles(files);setError(e instanceof Error?e.message:"Lampiran tidak valid.");}
  }

  async function markRead(){
    if(!detail||readBusy)return;
    setReadBusy(true);
    try{
      const r=await fetch(`/api/letters/${detail.letter.id}/read`,{method:"POST"});const j=await r.json();
      if(!r.ok)throw new Error(j.error||"Gagal menandai sudah dibaca.");
      await openDetail(detail.letter.id);await load();
    }catch(e){setError(e instanceof Error?e.message:"Proses gagal.");}
    finally{setReadBusy(false);}
  }


  async function importExcel(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!importFile){setError("Pilih file .xlsx terlebih dahulu.");return;}
    setImportBusy(true);setError("");setImportResult(null);
    const fd=new FormData();fd.set("file",importFile);
    const r=await fetch("/api/letters/outgoing-excel",{method:"POST",body:fd});
    const j=await r.json();setImportBusy(false);
    if(!r.ok){setError(j.error||"Import Excel gagal.");return;}
    setImportResult(j.data);
    setMessage(`Import Excel selesai: ${j.data.inserted} data baru, ${j.data.updated} data diperbarui, ${j.data.conflicts} nomor legacy ditandai untuk pengecekan.`);
    await load();await loadFormats();
  }

  async function openDetail(id:string){
    const r=await fetch(`/api/letters/${id}`);const j=await r.json();if(!r.ok){setError(j.error);return}
    setDetail(j.data);setDetailOpen(true);
  }

  function startAction(action:string,label:string,requiredComment=false,issue=false){
    setActionFiles([]);
    setPendingAction({action,label,requiredComment,issue});
  }

  async function submitAction(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!detail||!pendingAction)return;
    const form=new FormData(e.currentTarget);
    const comment=String(form.get("comment")||"").trim();
    try{
      assertUploadSelection(actionFiles);
      if(pendingAction.requiredComment&&!comment)throw new Error("Catatan/alasan wajib diisi.");
      setActionBusy(true);setError("");
      const fd=new FormData();fd.set("action",pendingAction.action);fd.set("comment",comment);
      if(pendingAction.issue)fd.set("issued_date",String(form.get("issued_date")||today()));
      actionFiles.forEach(f=>fd.append("files",f));
      const r=await fetch(`/api/letters/${detail.letter.id}/actions`,{method:"POST",body:fd});const j=await r.json();
      if(!r.ok)throw new Error(j.error||"Proses dokumen gagal.");
      const label=pendingAction.label;
      setPendingAction(null);setMessage(`${label} berhasil${actionFiles.length?` dengan ${actionFiles.length} lampiran proses`:""}.`);
      await openDetail(detail.letter.id);await load();
    }catch(e){setError(e instanceof Error?e.message:"Proses dokumen gagal.");}
    finally{setActionBusy(false);}
  }

  async function editLetter(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!detail)return;
    const fd=new FormData(e.currentTarget);
    const body=formObject(fd);
    body.is_public=body.is_public==="on";
    const r=await fetch(`/api/letters/${detail.letter.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const j=await r.json();
    if(!r.ok){setError(j.error);return}
    setEditOpen(false);setMessage("Data dokumen berhasil diperbarui.");await openDetail(detail.letter.id);await load();
  }

  function canEditDetail(){
    if(!detail)return false;
    return user.role==="ROOT_ADMIN"
      || (detail.letter.created_by===user.id && ["DRAFT","RETURNED_STAFF"].includes(detail.letter.status))
;
  }

  function canDispositionFromDetail(){
    if(!detail)return false;

    const allowedRole=[
      "ROOT_ADMIN",
      "MANAGER",
      "FINANCE",
      "DIRECTOR_OPS",
      "PRESIDENT_DIRECTOR"
    ].includes(user.role);

    if(!allowedRole)return false;

    if(detail.letter.direction==="OUTGOING"){
      return detail.letter.status==="ISSUED";
    }

    return ["APPROVED","DISPOSED","IN_PROGRESS","COMPLETED"].includes(detail.letter.status);
  }

  function actionButtons(){
    if(!detail)return null;
    const s=detail.letter.status;const d=detail.letter.direction as Direction;
    const buttons:Array<[string,string,string,boolean?,boolean?]>=[];

    if(["DRAFT","RETURNED_STAFF"].includes(s) && (user.role==="ROOT_ADMIN"||detail.letter.created_by===user.id)) {
      buttons.push(["SUBMIT",detail.letter.finance_reviewer_user_id?"Ajukan ke Finance":"Ajukan ke Manager","btn-primary",false,false]);
    }
    const expected=s==="FINANCE_REVIEW"?"FINANCE":s==="MANAGER_REVIEW"?"MANAGER":s==="DIRECTOR_OPS_REVIEW"?"DIRECTOR_OPS":s==="PRESIDENT_DIRECTOR_REVIEW"?"PRESIDENT_DIRECTOR":null;
    const isAssignedReviewer=
      user.role==="ROOT_ADMIN" ||
      (
        user.role===expected &&
        (!detail.letter.current_owner_user_id || detail.letter.current_owner_user_id===user.id)
      );

    if(expected&&isAssignedReviewer){
      if(s==="FINANCE_REVIEW"){
        buttons.push(["APPROVE","Selesai Review & Teruskan ke Manager","btn-success"],["RETURN","Kembalikan ke Penyusun","btn-secondary",true]);
      }else if(d==="INTERNAL" && s==="MANAGER_REVIEW"){
        buttons.push(["APPROVE_FINAL","Setujui / Selesai di Manager","btn-success"],["APPROVE","Teruskan ke Dir. Operasional","btn-primary"],["RETURN",detail.letter.finance_reviewer_user_id?"Kembalikan ke Finance":"Kembalikan ke Penyusun","btn-secondary",true]);
      }else if(d==="INTERNAL" && s==="DIRECTOR_OPS_REVIEW"){
        buttons.push(["APPROVE_FINAL","Setujui / Selesai di Dirops","btn-success"],["APPROVE","Teruskan ke Dirut","btn-primary"],["RETURN","Kembalikan ke Manager","btn-secondary",true]);
      }else if(d==="OUTGOING"){
        buttons.push(["APPROVE",s==="PRESIDENT_DIRECTOR_REVIEW"?"ACC Final Dirut":"Approve & Teruskan","btn-success"],["RETURN","Kembalikan ke Staff","btn-secondary",true]);
      }else{
        buttons.push(["APPROVE",s==="PRESIDENT_DIRECTOR_REVIEW"?"Approve Final":"Approve & Teruskan","btn-success"],["RETURN","Kembalikan","btn-secondary",true]);
      }
    }

    if(detail.can_contribute){
      buttons.push(["ADD_NOTE","Tambah Catatan / Lampiran","btn-secondary",false,false]);
    }

    if(d==="OUTGOING" && s==="READY_TO_ISSUE" && (user.role==="ROOT_ADMIN"||detail.letter.created_by===user.id)) {
      buttons.push(["ISSUE","Terbitkan Surat","btn-success",false,true]);
    }
    if(!["CANCELLED","COMPLETED","ISSUED"].includes(s)&&(user.role==="ROOT_ADMIN"||detail.letter.created_by===user.id)) {
      buttons.push(["CANCEL","Batalkan","btn-danger",true]);
    }
    return buttons.map(b=><button key={b[0]} className={`btn ${b[2]}`} onClick={()=>startAction(b[0],b[1],Boolean(b[3]),Boolean(b[4]))}>{b[1]}</button>);
  }

  const generalAttachments=useMemo(()=>detail?.attachments?.filter((a:any)=>!a.letter_action_id)||[],[detail]);
  const processAttachmentsFor=(actionId:string)=>detail?.attachments?.filter((a:any)=>a.letter_action_id===actionId)||[];

  const pageDescription=direction==="INCOMING"
    ?"Staff meregistrasi surat, memilih review langsung ke Manager atau melalui Finance. Tanda baca terpisah dari persetujuan."
    :direction==="OUTGOING"
      ?"Staff menyusun draft, Manager review, Dirops review, Dirut ACC final, lalu Staff menerbitkan surat. Setiap tahap dapat menyertakan lampiran."
      :"Nota Dinas mendukung dokumen Word/PDF, review Finance opsional untuk Staff, lalu Manager dan direksi sesuai kebutuhan.";

  const currentYear=new Date().getFullYear();
  const yearOptions=Array.from({length:7},(_,i)=>String(currentYear-i));
  function resetFilters(){setQ("");setStatus("");setDocType("");setYear("");void load({q:"",status:"",docType:"",year:""})}

  return <main className="page">
    <div className="page-head"><div><h2>{titleFor(direction)}</h2><p>{pageDescription}</p></div><div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>{direction==="OUTGOING"&&<a className="btn btn-secondary" href="/api/letters/outgoing-excel">↓ Export Excel</a>}{direction==="OUTGOING"&&user.role==="ROOT_ADMIN"&&<button className="btn btn-secondary" onClick={()=>{setImportOpen(true);setImportResult(null);setImportFile(null)}}>↑ Import Excel Lama</button>}{canCreate&&<button className="btn btn-primary" onClick={()=>{setReviewPath("manager");setError("");setCreateOpen(true)}}>+ {direction==="INCOMING"?"Registrasi Surat":direction==="INTERNAL"?"Buat Nota Dinas":"Buat Draft Surat"}</button>}</div></div>

    {direction==="OUTGOING"&&<div className="notice" style={{marginBottom:13}}>
      <b>Alur ringkas:</b> Staff pilih Manager reviewer → Manager → Dirops → Dirut → Staff terbitkan. Jika dikembalikan, Staff revisi lalu ajukan lagi. <b>Database SIAP menjadi daftar utama</b>; tombol Export Excel membuat workbook dengan 5 sheet dan susunan yang mengikuti Form Persuratan ARU lama. Root dapat mengimpor workbook lama tanpa menghapus histori nomor.
    </div>}
    {direction==="INTERNAL"&&<div className="notice" style={{marginBottom:13}}><b>Nota Dinas dapat dibuat oleh seluruh role SIAP.</b><br/>Pembuat memilih Manager tujuan, mengisi perihal/ringkasan, dan dapat melampirkan Word/PDF. Staff dapat memilih review Finance terlebih dahulu. Manager dapat memberi tanggapan, menyelesaikan di levelnya, meneruskan ke Dirops, atau mengembalikan ke pembuat untuk revisi. Setiap tahap dapat membawa catatan dan lampiran tambahan. <b>Semua dokumen yang tersimpan dapat diunduh kembali dari Detail Nota Dinas.</b> Disposisi tetap digunakan untuk instruksi/tindak lanjut pimpinan kepada PIC, bukan sebagai pengganti Nota Dinas.</div>}

    {message&&<div className="success" style={{marginBottom:12}}>{message}</div>}{error&&<div className="error" style={{marginBottom:12}}>{error}</div>}
    <div className="workflow-tabs" aria-label="Pilihan daftar surat">
      {[["all","Semua Surat"],["attention","Perlu Review Anda"],...(direction==="INCOMING"?[["awareness","Untuk Diketahui • Belum Dibaca"]]:[])].map(([key,label])=><button key={key} className={`btn ${view===key?"btn-primary":"btn-secondary"}`} onClick={()=>{setView(key);void load({view:key})}}>{label}</button>)}
    </div>
    <div className="toolbar letter-filter-bar">
      <div className="search"><span>⌕</span><input value={q} onChange={e=>setQ(e.target.value)} placeholder={direction==="INTERNAL"?"Cari perihal, tujuan, pembuat...":"Cari nomor, perihal, pengirim/tujuan..."} onKeyDown={e=>e.key==="Enter"&&load()}/></div>
      {direction==="OUTGOING"&&<select className="select filter-select" value={docType} onChange={e=>setDocType(e.target.value)}><option value="">Semua jenis surat</option>{outgoingTypeOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}
      <select className="select filter-select" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Semua status</option><option>DRAFT</option><option>FINANCE_REVIEW</option><option>MANAGER_REVIEW</option><option>DIRECTOR_OPS_REVIEW</option><option>PRESIDENT_DIRECTOR_REVIEW</option><option>READY_TO_ISSUE</option><option>APPROVED</option><option>ISSUED</option><option>DISPOSED</option><option>IN_PROGRESS</option><option>COMPLETED</option><option>RETURNED_STAFF</option><option>CANCELLED</option></select>
      <select className="select filter-select filter-year" value={year} onChange={e=>setYear(e.target.value)}><option value="">Semua tahun</option>{yearOptions.map(y=><option key={y} value={y}>{y}</option>)}</select>
      <button className="btn btn-primary" onClick={() => load()}>Terapkan</button>
      {(q||status||docType||year)&&<button className="btn btn-secondary" onClick={resetFilters}>Reset</button>}
    </div>
    <div className="card"><div className="table-wrap"><table className="table"><thead><tr>{direction!=="INTERNAL"&&<th>{direction==="INCOMING"?"Nomor Surat":"No."}</th>}<th>Jenis Dokumen</th><th>Perihal</th><th>{direction==="INCOMING"?"Pengirim":"Tujuan"}</th><th>Tanggal</th><th>Status</th><th>Tujuan Saat Ini</th><th>Sifat</th><th>Lampiran</th><th></th></tr></thead><tbody>
      {!loading&&rows.map(r=><tr key={r.id} className={`letter-row ${docTypeClass(r.document_type)}`}>{direction!=="INTERNAL"&&<td className="mono"><b>{direction==="OUTGOING"?(r.display_number||"-"):(r.external_number||"-")}</b></td>}<td><span className={`badge letter-type-badge ${docTypeClass(r.document_type)}`}>{docLabel(r)}</span></td><td><b>{r.subject}</b>{direction==="INCOMING"&&<span className={`badge ${r.is_read_by_me?"green":"orange"}`} style={{display:"inline-flex",marginTop:5}}>{r.is_read_by_me?"Sudah Anda baca":"Belum Anda tandai dibaca"}</span>}{r.legacy_import_key&&<span className="muted" style={{display:"block",fontSize:9.5,marginTop:3}}>Data Excel lama{r.legacy_number_conflict?" • cek nomor historis":""}</span>}</td><td>{direction==="INCOMING"?r.sender:r.recipient}</td><td>{fmtDate(r.letter_date)}</td><td><StatusBadge status={r.status}/></td><td><b style={{fontSize:11}}>{currentTargetLabel(r)}</b></td><td><span className={`badge ${r.confidentiality==="RAHASIA"?"red":r.confidentiality==="PENTING"?"orange":"gray"}`}>{r.confidentiality}</span></td><td>{r.attachment_count}</td><td><button className="btn btn-secondary" onClick={()=>openDetail(r.id)}>Detail</button></td></tr>)}
      {!loading&&rows.length===0&&<tr><td colSpan={direction==="INTERNAL"?9:10}><div className="empty">Belum ada data.</div></td></tr>}
      {loading&&<tr><td colSpan={direction==="INTERNAL"?9:10}><div className="empty">Memuat...</div></td></tr>}
    </tbody></table></div></div>

    {importOpen&&direction==="OUTGOING"&&user.role==="ROOT_ADMIN"&&<Modal title="Import Form Persuratan ARU" subtitle="Pindahkan daftar Excel lama ke database SIAP tanpa mengubah nomor historisnya." onClose={()=>!importBusy&&setImportOpen(false)}>
      <form className="form-grid" onSubmit={importExcel}>
        <div className="field full"><div className="notice"><b>Langkahnya ringkas:</b><br/>1. Pilih <b>Form Persuratan ARU.xlsx</b>.<br/>2. Klik <b>Import ke Database</b>.<br/>3. Cek ringkasan hasil. Import ulang file yang sama aman: baris yang sudah pernah masuk akan diperbarui, bukan diduplikasi.</div></div>
        <div className="field full"><label>File Excel</label><input className="input" type="file" accept=".xlsx" onChange={e=>setImportFile(e.target.files?.[0]||null)} required/><span className="hint">Dibaca: Perjanjian Kerjasama, Surat Keluar- Direksi, Surat Keluar - Bag. Operasional, Purchase Order, dan Surat keluar- Bag. umum. Sheet Kwitansi tidak diimport.</span></div>
        <div className="field full"><div className="format-preview"><span>Nomor historis</span><b>Tetap seperti Excel (termasuk .1, .2)</b><span>Data tidak standar / duplikat</span><b>Tetap disimpan dan diberi penanda untuk pengecekan</b><span>Sumber utama setelah import</span><b>Database SIAP ARU</b></div></div>
        {importResult&&<div className="field full"><div className="success"><b>Import selesai.</b><br/>{importResult.processed} baris diproses • {importResult.inserted} baru • {importResult.updated} diperbarui • {importResult.ledgerLinked} nomor terhubung ledger • {importResult.conflicts} perlu pengecekan • {importResult.skipped} dilewati.</div>{importResult.issues?.length>0&&<details style={{marginTop:10}}><summary style={{cursor:"pointer",fontWeight:700}}>Lihat catatan import ({importResult.issues.length}{importResult.moreIssues?` + ${importResult.moreIssues} lainnya`:""})</summary><div className="notice" style={{marginTop:8,maxHeight:220,overflow:"auto"}}>{importResult.issues.map((x:string,i:number)=><div key={i}>• {x}</div>)}</div></details>}</div>}
        <div className="field full modal-actions"><button type="button" className="btn btn-secondary" disabled={importBusy} onClick={()=>setImportOpen(false)}>Tutup</button><button className="btn btn-primary" disabled={importBusy||!importFile}>{importBusy?"Mengimpor...":"Import ke Database"}</button></div>
      </form>
    </Modal>}

    {createOpen&&<Modal title={direction==="INCOMING"?"Registrasi Surat Masuk":direction==="INTERNAL"?"Buat Nota Dinas":"Buat Draft Surat Keluar"} subtitle={direction==="INTERNAL"?"Nota Dinas dapat memuat Word/PDF dan diajukan melalui Finance opsional atau langsung ke Manager.":direction==="OUTGOING"?"Draft disusun Staff. Nomor direservasi per jenis surat dan seluruh proses tercatat di audit log.":"Semua perubahan tercatat di audit log."} onClose={()=>!createBusy&&setCreateOpen(false)}>
      <form onSubmit={create} className="form-grid">
        {error&&<div className="error field full">{error}</div>}
        <div className="field"><label>Jenis Dokumen</label>{direction==="OUTGOING"?<select className="select" name="document_type" required value={outType} onChange={e=>setOutType(e.target.value)}>{outgoingTypeOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>:direction==="INTERNAL"?<><input type="hidden" name="document_type" value="NOTA_DINAS"/><div className="input" style={{display:"flex",alignItems:"center",background:"var(--surface-2)"}}>Nota Dinas</div></>:<input className="input" name="document_type" defaultValue="SURAT_MASUK_UMUM" required/>}</div>
        {direction==="OUTGOING"&&<div className="field"><label>Format Nomor</label><select className="select" name="number_format_id" required><option value="">Pilih format...</option>{formats.filter((f:any)=>f.document_type===outType).map((f:any)=><option value={f.id} key={f.id}>{f.name}</option>)}</select></div>}
        {direction==="OUTGOING"&&<div className="field"><label>Nomor Dasar Custom <span className="muted">(opsional)</span></label><input className="input" type="number" min="1" step="1" name="custom_number_base" placeholder="Otomatis"/><span className="hint">Contoh 135. Jika 135 sudah terpakai pada jenis/tahun yang sama, sistem memakai 135.1, 135.2, dst.</span></div>}
        {direction==="INCOMING"&&<>
          <div className="field"><label>Nomor Surat Asal</label><input className="input" name="external_number" required/></div>
          <div className="field"><label>Asal / Pengirim</label><input className="input" name="sender" required/></div>
          <div className="field full">
            <label>Manager Tujuan</label>
            <select className="select" name="routing_target_user_id" required>
              <option value="">Pilih penerima pertama...</option>
              {reviewers.map((r:any)=>
                <option key={r.id} value={r.id}>
                  {r.name}{r.unit_name?` — ${r.unit_name}`:""}
                </option>
              )}
            </select>
            <span className="hint">
              Manager ini tetap menjadi reviewer setelah pemeriksaan Finance jika jalur Finance dipilih.
            </span>
          </div>
        </>}
        {direction==="OUTGOING"&&<>
          <div className="field"><label>Tujuan Surat</label><input className="input" name="recipient" required/></div>
          <div className="field">
            <label>Manager Reviewer</label>
            <select className="select" name="routing_target_user_id" required>
              <option value="">Pilih Manager...</option>
              {reviewers.map((r:any)=>
                <option key={r.id} value={r.id}>
                  {r.name}{r.unit_name?` — ${r.unit_name}`:""}
                </option>
              )}
            </select>
            <span className="hint">Draft diajukan ke Manager ini, lalu Dirops → Dirut.</span>
          </div>
        </>}
        {direction==="INTERNAL"&&
          <div className="field">
            <label>Manager Tujuan</label>
            <select className="select" name="routing_target_user_id" required>
              <option value="">Pilih penerima...</option>
              {reviewers.map((r:any)=>
                <option key={r.id} value={r.id}>
                  {r.name}{r.unit_name?` — ${r.unit_name}`:""}
                </option>
              )}
            </select>
            <span className="hint">
              Manager tujuan dapat menyelesaikan Nota Dinas pada levelnya atau meneruskan ke Dirops.
            </span>
          </div>}
        {direction!=="OUTGOING"&&["ROOT_ADMIN","STAFF"].includes(user.role)&&<>
          <div className="field"><label>Jalur Review</label><select className="select" value={reviewPath} onChange={e=>setReviewPath(e.target.value)}><option value="manager">Langsung ke Manager</option><option value="finance" disabled={!financeReviewers.length}>Melalui Finance terlebih dahulu</option></select><span className="hint">Review Finance opsional. Pendaftaran Surat Masuk tetap dilakukan Staff.</span></div>
          {reviewPath==="finance"&&<div className="field"><label>Finance Reviewer</label><select className="select" name="finance_reviewer_user_id" required><option value="">Pilih Finance...</option>{financeReviewers.map(f=><option key={f.id} value={f.id}>{f.name}{f.unit_name?` — ${f.unit_name}`:""}</option>)}</select></div>}
        </>}
        <div className="field"><label>{direction==="INTERNAL"?"Tanggal Nota Dinas":"Tanggal Surat"}</label><input className="input" type="date" name="letter_date" defaultValue={today()} required/>{direction==="OUTGOING"&&<span className="hint">Backdate diperbolehkan. Nomor existing tidak digeser; collision menghasilkan .1, .2, dst.</span>}</div>
        {direction==="INCOMING"&&<div className="field"><label>Tanggal Diterima</label><input className="input" type="date" name="received_date" defaultValue={today()} required/></div>}
        <div className="field full"><label>Perihal</label><input className="input" name="subject" required/></div>
        <div className="field"><label>Sifat Dokumen</label><select className="select" name="confidentiality" defaultValue="BIASA"><option>BIASA</option><option>PENTING</option><option>RAHASIA</option></select></div>
        <div className="field"><label>Visibilitas</label><label style={{display:"flex",alignItems:"center",gap:8,fontWeight:500}}><input type="checkbox" name="is_public" defaultChecked={direction==="OUTGOING"}/> {direction==="INTERNAL"?"Dapat dilihat lebih luas oleh user persuratan":"Public untuk user yang punya akses persuratan"}</label></div>
        <div className="field full"><label>{direction==="INTERNAL"?"Isi / Ringkasan Nota Dinas":"Ringkasan / Isi Ringkas"}</label><textarea className="textarea" name="summary"/></div>
        <div className="field full"><label>Catatan</label><textarea className="textarea" name="notes" placeholder={direction==="INTERNAL"?"Keterangan tambahan untuk Manager":"Catatan awal proses"}/></div>
        <div className="field full"><label>{direction==="OUTGOING"?"File Draft / Dokumen Utama (opsional)":direction==="INTERNAL"?"Dokumen Utama / Pengantar (opsional)":"Surat Asli (opsional)"}</label><input className="input" type="file" name="original_file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"/><span className="hint">Maksimal 10 MB, disimpan utuh tanpa kompresi. Total dokumen utama dan tambahan maksimal 50 MB.</span></div>
        <div className="field full"><label>Lampiran Tambahan <span className="muted">(opsional, maksimal 5 file)</span></label><input className="input" type="file" name="additional_files" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv"/><span className="hint">Lampiran tambahan maksimal 10 MB per file dan dikompresi otomatis bila hasilnya lebih kecil. Cocok untuk data pendukung, hasil telaah, atau bukti proses.</span></div>
        <div className="field full" style={{display:"flex",justifyContent:"flex-end",gap:8,flexDirection:"row"}}><button type="button" className="btn btn-secondary" disabled={createBusy} onClick={()=>setCreateOpen(false)}>Batal</button><button className="btn btn-primary" disabled={createBusy}>{createBusy?"Menyimpan...":direction==="INCOMING"?`Registrasi & Kirim ke ${reviewPath==="finance"?"Finance":"Manager"}`:"Simpan Draft"}</button></div>
      </form>
    </Modal>}

    {detailOpen&&detail&&<Modal title={detail.letter.subject} subtitle={direction==="OUTGOING"?`No. ${detail.letter.display_number||"-"} • ${docLabel(detail.letter)}`:direction==="INTERNAL"?`${docLabel(detail.letter)} • kepada ${detail.letter.recipient||"Manager"}`:(detail.letter.external_number||"Detail surat")} onClose={()=>setDetailOpen(false)}>
      {error&&<div className="error" style={{marginBottom:12}}>{error}</div>}
      <section className="read-receipts"><div className="read-receipts-head"><div><b>Status Baca</b><p>Membaca dokumen tidak mengubah persetujuan atau reviewer saat ini.</p></div><button className="btn btn-secondary" disabled={readBusy||detail.readers?.some((r:any)=>r.user_id===user.id)} onClick={()=>void markRead()}>{detail.readers?.some((r:any)=>r.user_id===user.id)?"Sudah Anda Baca":readBusy?"Menyimpan...":"Tandai Sudah Dibaca"}</button></div><div className="read-receipts-list">{detail.readers?.length?detail.readers.map((r:any)=><div key={r.user_id}><b>{r.name}</b><span>{ROLE_LABELS[r.role as keyof typeof ROLE_LABELS]} • {new Date(r.first_read_at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta",dateStyle:"medium",timeStyle:"short"})} WIB</span></div>):<p className="muted">Belum ada pengguna yang menandai sudah dibaca.</p>}</div></section>
      <div className="grid-2">
        <div>
          <div className="kpi-list">
            <div className="kpi-row"><span>Status</span><StatusBadge status={detail.letter.status}/></div>
            <div className="kpi-row"><span>Tujuan Saat Ini</span><b>{detail.letter.owner_name?`${detail.letter.owner_name}${detail.letter.owner_unit?` — ${detail.letter.owner_unit}`:""}`:currentTargetLabel(detail.letter)}</b></div>
            {detail.letter.finance_reviewer_user_id&&<div className="kpi-row"><span>Jalur Review</span><b>Finance → Manager → Direksi sesuai kebutuhan</b></div>}
            {detail.letter.routing_target_name&&<div className="kpi-row"><span>Tujuan Awal</span><b>{detail.letter.routing_target_name}{detail.letter.routing_target_unit?` — ${detail.letter.routing_target_unit}`:""}</b></div>}
            <div className="kpi-row"><span>Jenis Dokumen</span><b>{docLabel(detail.letter)}</b></div>
            {direction==="OUTGOING"&&<div className="kpi-row"><span>Nomor Urut</span><b className="mono">{detail.letter.display_number||"-"}</b></div>}
            {direction==="INTERNAL"&&<div className="kpi-row"><span>Tujuan</span><b>{detail.letter.recipient||"-"}</b></div>}
            <div className="kpi-row"><span>Tanggal</span><b>{fmtDate(detail.letter.letter_date)}</b></div>
            {direction==="OUTGOING"&&detail.letter.issued_date&&<div className="kpi-row"><span>Tanggal Terbit</span><b>{fmtDate(detail.letter.issued_date)}</b></div>}
            <div className="kpi-row"><span>Sifat</span><b>{detail.letter.confidentiality}</b></div>
            {direction!=="INTERNAL"&&<div className="kpi-row"><span>Backdate</span><b>{detail.letter.is_backdated?"Ya":"Tidak"}</b></div>}
            <div className="kpi-row"><span>Dibuat oleh</span><b>{detail.letter.creator_name}</b></div>
            {direction==="OUTGOING"&&detail.letter.legacy_sheet_name&&<div className="kpi-row"><span>Sumber Historis</span><b>{detail.letter.legacy_sheet_name} • baris {detail.letter.legacy_row_no}</b></div>}
          </div>
          {direction==="OUTGOING"&&detail.letter.legacy_number_conflict===1&&<div className="notice" style={{marginTop:13}}><b>Nomor historis dipertahankan apa adanya.</b> Slot ini terdeteksi duplikat/tidak standar pada workbook lama, sehingga tidak dipakai untuk menggeser penomoran otomatis baru.</div>}
          {direction==="OUTGOING"&&detail.letter.legacy_file_url&&<div className="card" style={{boxShadow:"none",marginTop:13}}><div className="card-body"><b>Referensi File Lama</b><p className="muted" style={{marginTop:4}}>Nilai dari kolom Link File pada workbook lama.</p>{/^https?:\/\//i.test(String(detail.letter.legacy_file_url))?<a className="btn btn-secondary" href={String(detail.letter.legacy_file_url)} target="_blank" rel="noreferrer">Buka Link Lama ↗</a>:<div className="notice" style={{marginTop:8}}>{String(detail.letter.legacy_file_url)}</div>}</div></div>}
          {direction==="OUTGOING"&&detail.letter.status==="READY_TO_ISSUE"&&<div className="success" style={{marginTop:13}}><b>ACC final selesai.</b> Surat sudah disetujui Direktur Utama dan menunggu Staff menerbitkan. Staff dapat melampirkan file final saat menekan <b>Terbitkan Surat</b>.</div>}
          {direction==="OUTGOING"&&detail.letter.status==="RETURNED_STAFF"&&<div className="error" style={{marginTop:13}}><b>Dikembalikan ke Staff.</b> Baca catatan reviewer pada riwayat, revisi draft, lalu ajukan kembali mulai dari Manager.</div>}
          <div style={{marginTop:13}} className="notice">{detail.letter.summary||"Belum ada ringkasan."}</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:13}}>
            {canEditDetail()&&<button className="btn btn-secondary" onClick={()=>setEditOpen(true)}>Edit Metadata</button>}
            {canDispositionFromDetail()&&<a className="btn btn-primary" href={`/dispositions?letter_id=${detail.letter.id}`}>+ Buat Disposisi</a>}
            {actionButtons()}
          </div>

          <div className="card" style={{boxShadow:"none",marginTop:14}}>
            <div className="card-head"><div><h3>Dokumen & Lampiran Umum</h3><p>Dokumen utama disimpan apa adanya. Lampiran tambahan dikompresi hanya bila hasilnya lebih kecil. Semua file di bagian ini dapat diunduh kembali sesuai hak akses.</p></div></div>
            <div className="card-body">
              {generalAttachments.map((a:any)=><div className="kpi-row" key={a.id}><div><b>{a.original_name}</b><span style={{display:"block"}}>{a.attachment_kind} • {size(Number(a.original_size))}{a.is_compressed?" • dikompresi":""} • {a.uploaded_by_name}</span></div><a className="btn btn-secondary" href={`/api/attachments/${a.id}`} download>↓ Unduh</a></div>)}
              {!generalAttachments.length&&<div className="empty">Belum ada lampiran umum.</div>}
              {detail.can_contribute&&<button className="btn btn-secondary" style={{marginTop:10}} onClick={()=>startAction("ADD_NOTE","Tambah Catatan / Lampiran")}>+ Tambah Catatan / Lampiran</button>}
            </div>
          </div>
        </div>

        <div>
          <h3 style={{fontSize:13}}>Riwayat Proses & Lampiran</h3>
          <p className="muted" style={{fontSize:11}}>Setiap submit, approval, return, penerbitan, atau pembatalan dapat membawa catatan dan maksimal 5 lampiran proses.</p>
          <div className="timeline">{detail.actions?.map((a:any,i:number)=>{
            const af=processAttachmentsFor(a.id);
            return <div className="timeline-row" key={a.id}><div className="timeline-dot">{i+1}</div><div style={{width:"100%"}}><b>{humanAction(a.action)} • {a.actor_name}</b><p>{a.from_status?`${a.from_status} → ${a.to_status}`:a.to_status}{a.comment?` • ${a.comment}`:""}</p>{af.length>0&&<div style={{display:"grid",gap:6,marginTop:7}}>{af.map((f:any)=><div key={f.id} style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",padding:"7px 9px",border:"1px solid var(--line)",borderRadius:9}}><span style={{fontSize:10.5}}><b>{f.original_name}</b><br/><span className="muted">{size(Number(f.original_size))}{f.is_compressed?" • dikompresi":""}</span></span><a className="btn btn-secondary" href={`/api/attachments/${f.id}`} download>↓ Unduh</a></div>)}</div>}</div></div>
          })}</div>
        </div>
      </div>
    </Modal>}

    {editOpen&&detail&&<Modal title="Edit Data Dokumen" subtitle="Draft/return dapat diperbaiki Staff. Root Admin selalu dapat melakukan override." onClose={()=>setEditOpen(false)}>
      <form className="form-grid" onSubmit={editLetter}>
        <div className="field full"><label>Perihal</label><input className="input" name="subject" defaultValue={detail.letter.subject} required/></div>
        {direction==="INCOMING"?<div className="field"><label>Asal / Pengirim</label><input className="input" name="sender" defaultValue={detail.letter.sender||""}/></div>:<div className="field"><label>Tujuan</label><input className="input" name="recipient" defaultValue={detail.letter.recipient||""}/></div>}
        <div className="field"><label>Sifat</label><select className="select" name="confidentiality" defaultValue={detail.letter.confidentiality}><option>BIASA</option><option>PENTING</option><option>RAHASIA</option></select></div>
        <div className="field full"><label>Ringkasan</label><textarea className="textarea" name="summary" defaultValue={detail.letter.summary||""}/></div>
        <div className="field full"><label>Catatan</label><textarea className="textarea" name="notes" defaultValue={detail.letter.notes||""}/></div>
        <div className="field full"><label style={{display:"flex",alignItems:"center",gap:8,fontWeight:500}}><input type="checkbox" name="is_public" defaultChecked={Boolean(detail.letter.is_public)}/> Public</label><span className="hint">Dokumen RAHASIA tidak dapat dibuat public. Root Admin tetap dapat melihat seluruh data.</span></div>
        <div className="field full" style={{display:"flex",flexDirection:"row",justifyContent:"flex-end",gap:8}}><button type="button" className="btn btn-secondary" onClick={()=>setEditOpen(false)}>Batal</button><button className="btn btn-primary">Simpan Perubahan</button></div>
      </form>
    </Modal>}

    {pendingAction&&detail&&<Modal title={pendingAction.label} subtitle="Catatan dan lampiran pada aksi ini akan tersimpan permanen pada riwayat proses dan Audit Log." onClose={()=>!actionBusy&&setPendingAction(null)}>
      <form className="form-grid" onSubmit={submitAction}>
        {error&&<div className="error field full">{error}</div>}
        {pendingAction.issue&&<div className="field"><label>Tanggal Terbit</label><input className="input" type="date" name="issued_date" defaultValue={today()} required/><span className="hint">Setelah diterbitkan, status surat menjadi ISSUED dan nomor ledger dikunci sebagai terbit.</span></div>}
        <div className="field full"><label>{pendingAction.requiredComment?"Catatan / Alasan (wajib)":"Catatan Proses (opsional)"}</label><textarea className="textarea" name="comment" required={pendingAction.requiredComment} placeholder={pendingAction.action==="RETURN"?"Jelaskan apa yang harus direvisi oleh Staff...":pendingAction.action==="ISSUE"?"Contoh: Surat final telah ditandatangani dan siap dikirim.":"Catatan keputusan / arahan tambahan..."}/></div>
        <div className="field full"><label>Lampiran Proses <span className="muted">(opsional, maksimal 5 file)</span></label><input className="input" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv" onChange={e=>selectProcessFiles(Array.from(e.target.files||[]))}/><span className="hint">Maksimal 5 file, 10 MB per file dan total 50 MB per aksi. Lampiran proses dikompresi bila hasil kompresi lebih kecil dan tetap dapat di-download dari riwayat.</span>{actionFiles.length>0&&<div className="notice" style={{marginTop:7}}>{actionFiles.map(f=><div key={`${f.name}-${f.size}`}>{f.name} • {size(f.size)}</div>)}</div>}</div>
        <div className="field full" style={{display:"flex",flexDirection:"row",justifyContent:"flex-end",gap:8}}><button type="button" className="btn btn-secondary" disabled={actionBusy} onClick={()=>setPendingAction(null)}>Batal</button><button className={`btn ${pendingAction.action==="RETURN"||pendingAction.action==="CANCEL"?"btn-danger":"btn-primary"}`} disabled={actionBusy}>{actionBusy?"Memproses...":pendingAction.label}</button></div>
      </form>
    </Modal>}
  </main>;
}
