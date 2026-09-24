"use client";
import { FormEvent,useEffect,useMemo,useState } from "react";
import type { SessionUser } from "@/lib/types";
import Modal from "@/components/Modal";
import StatusBadge from "@/components/StatusBadge";

const size=(n:number)=>n<1024*1024?`${Math.max(1,Math.round(n/1024))} KB`:`${(n/1024/1024).toFixed(2)} MB`;
const actionLabel=(a:string)=>({CREATE:"Disposisi dibuat",SEEN:"Dilihat",START:"Mulai ditindaklanjuti",COMPLETE:"Diselesaikan",RETURN:"Dikembalikan"}[a]||a);
const docClass=(t:any)=>({PERJANJIAN_KERJA_SAMA:"letter-pks",PURCHASE_ORDER:"letter-po",SURAT_DIREKSI:"letter-direksi",SURAT_OPERASIONAL:"letter-operasional",SURAT_UMUM:"letter-umum",SURAT_MASUK_UMUM:"letter-masuk",NOTA_DINAS:"letter-nota"} as Record<string,string>)[String(t||"")]||"letter-default";

type ProcessAction={id:string;action:string;label:string;requiredNote?:boolean;tone?:"primary"|"success"|"danger"};

export default function DispositionsClient({user}:{user:SessionUser}){
  const [rows,setRows]=useState<any[]>([]);const [users,setUsers]=useState<any[]>([]);const [letters,setLetters]=useState<any[]>([]);
  const [open,setOpen]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");
  const [createFiles,setCreateFiles]=useState<File[]>([]);const [createBusy,setCreateBusy]=useState(false);
  const [detail,setDetail]=useState<any>(null);const [detailOpen,setDetailOpen]=useState(false);
  const [process,setProcess]=useState<ProcessAction|null>(null);const [processFiles,setProcessFiles]=useState<File[]>([]);const [processBusy,setProcessBusy]=useState(false);
  const [q,setQ]=useState("");const [status,setStatus]=useState("");
  const canCreate=["ROOT_ADMIN","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR"].includes(user.role);

  async function load(){
    setError("");
    const [dr,ur,lr]=await Promise.all([fetch("/api/dispositions"),fetch("/api/users/lookup"),fetch("/api/letters?limit=500")]);
    const [d,u,l]=await Promise.all([dr.json(),ur.json(),lr.json()]);
    if(d.ok)setRows(d.data);else setError(d.error);if(u.ok)setUsers(u.data);if(l.ok)setLetters(l.data);
  }
  useEffect(()=>{load()},[]);

  const filtered=useMemo(()=>rows.filter(d=>{
    const hay=[d.subject,d.letter_number,d.external_number,d.instruction,d.from_name,d.to_name].join(" ").toLowerCase();
    return (!q||hay.includes(q.toLowerCase()))&&(!status||d.status===status);
  }),[rows,q,status]);

  async function create(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setCreateBusy(true);setError("");
    const form=new FormData(e.currentTarget);createFiles.slice(0,5).forEach(f=>form.append("files",f));
    const r=await fetch("/api/dispositions",{method:"POST",body:form});const j=await r.json();setCreateBusy(false);
    if(!r.ok){setError(j.error);return}setOpen(false);setCreateFiles([]);setMessage(`Disposisi berhasil dikirim${j.data.attachments?` dengan ${j.data.attachments} lampiran`:""} dan berstatus UNSEEN.`);await load();
  }

  async function openDetail(id:string){
    const r=await fetch(`/api/dispositions/${id}`);const j=await r.json();if(!r.ok){setError(j.error);return}setDetail(j.data);setDetailOpen(true);
  }

  function startProcess(d:any,action:string,label:string,requiredNote=false,tone:"primary"|"success"|"danger"="primary"){
    setProcessFiles([]);setProcess({id:d.id,action,label,requiredNote,tone});
  }

  async function quickSeen(d:any){
    const fd=new FormData();fd.set("action","SEEN");
    const r=await fetch(`/api/dispositions/${d.id}/actions`,{method:"POST",body:fd});const j=await r.json();
    if(!r.ok){setError(j.error);return}setMessage("Disposisi ditandai sudah dilihat.");await load();if(detailOpen)await openDetail(d.id);
  }

  async function submitProcess(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!process)return;setProcessBusy(true);setError("");
    const f=new FormData(e.currentTarget);const note=String(f.get("note")||"").trim();
    if(process.requiredNote&&!note){setError("Catatan wajib diisi untuk proses ini.");setProcessBusy(false);return;}
    const fd=new FormData();fd.set("action",process.action);fd.set("note",note);processFiles.slice(0,5).forEach(x=>fd.append("files",x));
    const r=await fetch(`/api/dispositions/${process.id}/actions`,{method:"POST",body:fd});const j=await r.json();setProcessBusy(false);
    if(!r.ok){setError(j.error);return}const id=process.id;setProcess(null);setProcessFiles([]);setMessage(`${process.label} berhasil${j.data?.attachments?` dengan ${j.data.attachments} lampiran proses`:""}.`);await load();if(detailOpen)await openDetail(id);
  }

  async function uploadGeneral(id:string,files:File[]){
    for(const file of files.slice(0,5)){
      const fd=new FormData();fd.set("file",file);const r=await fetch(`/api/dispositions/${id}/attachments`,{method:"POST",body:fd});const j=await r.json();
      if(!r.ok){setError(j.error);return;}setMessage(`Lampiran tambahan ${file.name} tersimpan${j.data.storedSize<j.data.originalSize?" dan dikompresi":""}.`);
    }
    await load();if(detailOpen)await openDetail(id);
  }

  const generalAttachments=detail?.attachments?.filter((a:any)=>!a.disposition_action_id)||[];
  const processAttachments=(id:string)=>detail?.attachments?.filter((a:any)=>a.disposition_action_id===id)||[];

  return <main className="page">
    <div className="page-head"><div><h2>Disposisi</h2><p>Instruksi pimpinan ke PIC dengan status, deadline, catatan, dan lampiran tambahan pada setiap tahap penting.</p></div>{canCreate&&<button className="btn btn-primary" onClick={()=>{setOpen(true);setCreateFiles([])}}>+ Buat Disposisi</button>}</div>
    <div className="notice" style={{marginBottom:13}}><b>Cara singkat:</b> pilih surat → pilih penerima → tulis instruksi → kirim. Penerima dapat <b>Mulai</b>, <b>Selesaikan</b>, atau <b>Kembalikan</b>. Lampiran tambahan maksimal 10 MB/file dikompresi bila hasilnya lebih kecil, dan seluruh proses tetap tercatat.</div>
    {message&&<div className="success" style={{marginBottom:12}}>{message}</div>}{error&&<div className="error" style={{marginBottom:12}}>{error}</div>}
    <div className="toolbar"><div className="search"><span>⌕</span><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Cari surat, instruksi, pengirim, atau penerima..."/></div><select className="select filter-select" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Semua status</option><option>UNSEEN</option><option>SEEN</option><option>IN_PROGRESS</option><option>COMPLETED</option><option>RETURNED</option></select>{(q||status)&&<button className="btn btn-secondary" onClick={()=>{setQ("");setStatus("")}}>Reset</button>}</div>
    <div className="card"><div className="table-wrap"><table className="table"><thead><tr><th>Surat</th><th>Dari</th><th>Kepada</th><th>Instruksi</th><th>Visibility</th><th>Status</th><th>Deadline</th><th>Lampiran</th><th>Aksi</th></tr></thead><tbody>
      {filtered.map(d=><tr key={d.id} className={`letter-row ${docClass(d.document_type)}`}><td><b>{d.subject}</b><span className="muted" style={{display:"block",fontSize:10}}>{d.letter_number||d.external_number||"-"}</span></td><td>{d.from_name}</td><td>{d.to_name}</td><td style={{maxWidth:260}}>{d.instruction}</td><td><span className={`badge ${d.visibility==="PUBLIC"?"green":d.visibility==="PRIVATE"?"red":"blue"}`}>{d.visibility}</span></td><td><StatusBadge status={d.status}/></td><td>{d.due_date?String(d.due_date).slice(0,10):"-"}</td><td>{Number(d.attachment_count||0)}</td><td><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
        <button className="btn btn-secondary" onClick={()=>openDetail(d.id)}>Detail</button>
        {(d.to_user_id===user.id||user.role==="ROOT_ADMIN")&&d.status==="UNSEEN"&&<button className="btn btn-secondary" onClick={()=>quickSeen(d)}>Seen</button>}
        {(d.to_user_id===user.id||user.role==="ROOT_ADMIN")&&["UNSEEN","SEEN"].includes(d.status)&&<button className="btn btn-primary" onClick={()=>startProcess(d,"START","Mulai Tindak Lanjut")}>Mulai</button>}
        {(d.to_user_id===user.id||user.role==="ROOT_ADMIN")&&d.status==="IN_PROGRESS"&&<button className="btn btn-success" onClick={()=>startProcess(d,"COMPLETE","Selesaikan Disposisi",false,"success")}>Selesai</button>}
        {(d.to_user_id===user.id||user.role==="ROOT_ADMIN")&&!["COMPLETED","RETURNED"].includes(d.status)&&<button className="btn btn-secondary" onClick={()=>startProcess(d,"RETURN","Kembalikan Disposisi",true,"danger")}>Return</button>}
      </div></td></tr>)}
      {!filtered.length&&<tr><td colSpan={9}><div className="empty">Tidak ada disposisi yang sesuai filter.</div></td></tr>}
    </tbody></table></div></div>

    {open&&<Modal title="Buat Disposisi" subtitle="Instruksi, penerima, deadline, dan lampiran akan tercatat sebagai awal riwayat disposisi." onClose={()=>!createBusy&&setOpen(false)}>
      <form onSubmit={create} className="form-grid">
        <div className="field full"><label>Surat</label><select className="select" name="letter_id" required><option value="">Pilih surat...</option>{letters.filter(l=>["APPROVED","ISSUED","DISPOSED","IN_PROGRESS","COMPLETED"].includes(l.status)).map(l=><option value={l.id} key={l.id}>{l.display_number||l.letter_number||l.external_number||"-"} — {l.subject}</option>)}</select></div>
        <div className="field"><label>Diteruskan Kepada</label><select className="select" name="to_user_id" required><option value="">Pilih user...</option>{users.filter(u=>u.id!==user.id).map(u=><option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}</select></div>
        <div className="field"><label>Visibility</label><select className="select" name="visibility" defaultValue="ROUTE"><option value="PUBLIC">PUBLIC — semua user persuratan</option><option value="ROUTE">ROUTE — orang dalam jalur</option><option value="PRIVATE">PRIVATE — pengirim & penerima</option></select></div>
        <div className="field"><label>Prioritas</label><select className="select" name="priority"><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></div>
        <div className="field"><label>Target Selesai</label><input className="input" type="date" name="due_date"/></div>
        <div className="field full"><label>Instruksi / Catatan Disposisi</label><textarea className="textarea" name="instruction" required placeholder="Contoh: Mohon ditelaah dan tindak lanjuti sesuai kewenangan."/></div>
        <div className="field full"><label>Lampiran Tambahan <span className="muted">(opsional, maksimal 5 file)</span></label><input className="input" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv" onChange={e=>setCreateFiles(Array.from(e.target.files||[]).slice(0,5))}/><span className="hint">Maks. 10 MB/file. Lampiran tambahan dikompresi otomatis bila efektif.</span>{createFiles.length>0&&<div className="notice" style={{marginTop:7}}>{createFiles.map(f=><div key={`${f.name}-${f.size}`}>{f.name} • {size(f.size)}</div>)}</div>}</div>
        <div className="field full modal-actions"><button type="button" className="btn btn-secondary" disabled={createBusy} onClick={()=>setOpen(false)}>Batal</button><button className="btn btn-primary" disabled={createBusy}>{createBusy?"Mengirim...":"Kirim Disposisi"}</button></div>
      </form>
    </Modal>}

    {detailOpen&&detail&&<Modal title={detail.disposition.subject} subtitle={`Dari ${detail.disposition.from_name} → ${detail.disposition.to_name}`} onClose={()=>setDetailOpen(false)}>
      <div className="grid-2">
        <div>
          <div className="kpi-list">
            <div className="kpi-row"><span>Status</span><StatusBadge status={detail.disposition.status}/></div>
            <div className="kpi-row"><span>Prioritas</span><b>{detail.disposition.priority}</b></div>
            <div className="kpi-row"><span>Visibility</span><b>{detail.disposition.visibility}</b></div>
            <div className="kpi-row"><span>Deadline</span><b>{detail.disposition.due_date?String(detail.disposition.due_date).slice(0,10):"-"}</b></div>
          </div>
          <div className="notice" style={{marginTop:12}}><b>Instruksi</b><br/>{detail.disposition.instruction}</div>
          <div className="card" style={{boxShadow:"none",marginTop:14}}><div className="card-head"><div><h3>Lampiran Tambahan</h3><p>Dapat ditambah kapan saja oleh pengirim, penerima, atau Root. File dikompresi bila efektif.</p></div></div><div className="card-body">
            {generalAttachments.map((a:any)=><div className="disposition-file" key={a.id}><div><b>{a.original_name}</b><span style={{display:"block"}}>{size(Number(a.original_size))}{a.is_compressed?" • compressed":""} • {a.uploaded_by_name}</span></div><a className="btn btn-secondary" href={`/api/attachments/${a.id}`} download>↓ Unduh</a></div>)}
            {!generalAttachments.length&&<div className="empty">Belum ada lampiran umum.</div>}
            {(detail.disposition.to_user_id===user.id||detail.disposition.from_user_id===user.id||user.role==="ROOT_ADMIN")&&<label className="btn btn-secondary" style={{marginTop:10}}>+ Tambah Lampiran<input hidden type="file" multiple onChange={async e=>{await uploadGeneral(detail.disposition.id,Array.from(e.target.files||[]));e.currentTarget.value=""}}/></label>}
          </div></div>
        </div>
        <div><h3 style={{fontSize:13}}>Riwayat Proses & Lampiran</h3><p className="muted" style={{fontSize:11}}>Lampiran yang ditambahkan saat pembuatan, Mulai, Selesai, atau Return menempel pada proses tersebut. Semua dokumen dapat diunduh kembali sesuai hak akses sehingga jejak tindak lanjut tetap mudah diperiksa.</p><div className="timeline">{detail.actions?.map((a:any,i:number)=>{const af=processAttachments(a.id);return <div className="timeline-row" key={a.id}><div className="timeline-dot">{i+1}</div><div style={{width:"100%"}}><b>{actionLabel(a.action)} • {a.actor_name}</b><p>{a.from_status?`${a.from_status} → ${a.to_status}`:a.to_status}{a.note?` • ${a.note}`:""}</p>{af.length>0&&<div className="disposition-files">{af.map((f:any)=><div className="disposition-file" key={f.id}><div><b>{f.original_name}</b><span style={{display:"block"}}>{size(Number(f.original_size))}{f.is_compressed?" • compressed":""}</span></div><a className="btn btn-secondary" href={`/api/attachments/${f.id}`} download>↓ Unduh</a></div>)}</div>}</div></div>})}</div></div>
      </div>
    </Modal>}

    {process&&<Modal title={process.label} subtitle="Catatan dan lampiran proses tersimpan permanen di riwayat serta Audit Log." onClose={()=>!processBusy&&setProcess(null)}>
      <form className="form-grid" onSubmit={submitProcess}>
        <div className="field full"><label>{process.requiredNote?"Catatan / Alasan (wajib)":"Catatan Proses (opsional)"}</label><textarea className="textarea" name="note" required={process.requiredNote} placeholder={process.action==="RETURN"?"Jelaskan apa yang perlu diperbaiki / dilengkapi...":"Tuliskan progres atau hasil singkat bila diperlukan."}/></div>
        <div className="field full"><label>Lampiran Proses <span className="muted">(opsional, maksimal 5 file)</span></label><input className="input" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv" onChange={e=>setProcessFiles(Array.from(e.target.files||[]).slice(0,5))}/><span className="hint">Maks. 10 MB/file dan otomatis dikompresi bila hasil kompresinya lebih kecil.</span>{processFiles.length>0&&<div className="notice" style={{marginTop:7}}>{processFiles.map(f=><div key={`${f.name}-${f.size}`}>{f.name} • {size(f.size)}</div>)}</div>}</div>
        <div className="field full modal-actions"><button type="button" className="btn btn-secondary" disabled={processBusy} onClick={()=>setProcess(null)}>Batal</button><button className={`btn ${process.tone==="danger"?"btn-danger":process.tone==="success"?"btn-success":"btn-primary"}`} disabled={processBusy}>{processBusy?"Memproses...":process.label}</button></div>
      </form>
    </Modal>}
  </main>
}
