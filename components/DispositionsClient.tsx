"use client";

import { FormEvent,useEffect,useMemo,useState } from "react";
import type { SessionUser } from "@/lib/types";
import ConfidentialityBadge from "@/components/ConfidentialityBadge";
import AttachmentActions from "@/components/AttachmentActions";
import PaymentDocumentsPanel from "@/components/PaymentDocumentsPanel";
import SearchableSelect from "@/components/SearchableSelect";
import { dispositionDeadline, formatWorkflowTime } from "@/lib/workflow-time";
import AttachmentSandbox from "@/components/AttachmentSandbox";
import Modal from "@/components/Modal";
import StatusBadge from "@/components/StatusBadge";
import { dispositionActionLabel, RESULT_REQUIREMENTS, reviewRole, type ResultRequirement } from "@/lib/correspondence-workflow";
import { INVOICE_INCOMING, formatInvoiceAmount, type DocumentReference } from "@/lib/business-documents";
import { dispositionTargetRoles, jakartaDate, staffCanVerify, staffUnit, TASK_PURPOSES, TERMINAL_TASK_STATES,
  unitManagerScope, type TaskPurpose } from "@/lib/v11-workflow";

const size=(n:number)=>
  n<1024*1024
    ? `${Math.max(1,Math.round(n/1024))} KB`
    : `${(n/1024/1024).toFixed(2)} MB`;

const docClass=(t:any)=>({
  PERJANJIAN_KERJA_SAMA:"letter-pks",
  PURCHASE_ORDER:"letter-po",
  SURAT_DIREKSI:"letter-direksi",
  SURAT_OPERASIONAL:"letter-operasional",
  SURAT_UMUM:"letter-umum",
  SURAT_MASUK_UMUM:"letter-masuk",
  NOTA_DINAS:"letter-nota"
} as Record<string,string>)[String(t||"")]||"letter-default";

type ProcessAction={
  id:string;
  action:string;
  label:string;
  requiredNote?:boolean;
  resultRequirement?:ResultRequirement;
  purpose?:TaskPurpose;
  tone?:"primary"|"success"|"danger";
};

function reviewButtonLabel(d:any){
  if(d.status==="REVIEW_MANAGER") return "Setujui & Selesaikan";
  if(d.status==="REVIEW_DIROPS"){
    return d.from_role==="PRESIDENT_DIRECTOR"
      ? "Setujui & Teruskan ke Dirut"
      : "Setujui & Selesaikan";
  }
  if(d.status==="REVIEW_DIRUT") return "Konfirmasi & Selesaikan";
  return "Setujui Hasil";
}

function ResultLetterField({dispositionId,required}:{dispositionId:string;required:boolean}){
  const [query,setQuery]=useState("");
  const [letters,setLetters]=useState<DocumentReference[]>([]);
  const [selected,setSelected]=useState<DocumentReference|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);
    setError("");
    const timer=window.setTimeout(()=>{
      const url="/api/dispositions/"+encodeURIComponent(dispositionId)+"/result-letters?q="+encodeURIComponent(query);
      void fetch(url,{signal:controller.signal})
        .then(async response=>{
          const result=await response.json();
          if(!response.ok) throw new Error(result.error||"Gagal memuat surat hasil.");
          setLetters(result.data);
        })
        .catch(error=>{if(!controller.signal.aborted){setLetters([]);setError(error.message);}})
        .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    },180);
    return ()=>{window.clearTimeout(timer);controller.abort();};
  },[dispositionId,query]);
  const choices=selected&&!letters.some(letter=>letter.id===selected.id)?[selected,...letters]:letters;
  return <div className="field full">
    <label>Cari Surat Keluar terbit
      <input className="input" placeholder="Nomor atau perihal" maxLength={100} value={query} onChange={e=>setQuery(e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter")e.preventDefault();}}/>
    </label>
    <select aria-label="Surat Keluar hasil" className="select" name="result_letter_id" required={required}
      value={selected?.id||""} onChange={e=>setSelected(choices.find(letter=>letter.id===e.target.value)||null)}>
      <option value="">{loading?"Memuat surat...":choices.length?"Pilih surat hasil":"Belum ada surat hasil yang terbit"}</option>
      {choices.map(letter=><option key={letter.id} value={letter.id}>
        {[letter.number,letter.subject].filter(Boolean).join(" · ")}
      </option>)}
    </select>
    {error&&<span className="hint" role="alert">{error}</span>}
  </div>;
}

export default function DispositionsClient({user}:{user:SessionUser}){
  const [rows,setRows]=useState<any[]>([]);
  const [users,setUsers]=useState<any[]>([]);
  const [v11Enabled,setV11Enabled]=useState(false);
  const [purpose,setPurpose]=useState<TaskPurpose>("GENERAL");
  const [letters,setLetters]=useState<any[]>([]);
  const [selectedLetterId,setSelectedLetterId]=useState("");
  const [pinnedLetter,setPinnedLetter]=useState<any>(null);
  const [letterQuery,setLetterQuery]=useState("");
  const [letterLoading,setLetterLoading]=useState(false);
  const [letterError,setLetterError]=useState("");
  const [delegation,setDelegation]=useState<string[]|null>(null);
  const [parent,setParent]=useState<{id:string;subject:string;result_requirement:ResultRequirement}|null>(null);
  const [open,setOpen]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [createFiles,setCreateFiles]=useState<File[]>([]);
  const [createBusy,setCreateBusy]=useState(false);
  const [detail,setDetail]=useState<any>(null);
  const [detailOpen,setDetailOpen]=useState(false);
  const [process,setProcess]=useState<ProcessAction|null>(null);
  const [processFiles,setProcessFiles]=useState<File[]>([]);
  const [processBusy,setProcessBusy]=useState(false);
  const [q,setQ]=useState("");
  const [status,setStatus]=useState("");

  const canCreate=["ROOT_ADMIN","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR"].includes(user.role);

  async function load(){
    try{
      setError("");

      const [dr,ur,sr]=await Promise.all([
        fetch("/api/dispositions",{cache:"no-store"}),
        fetch("/api/users/lookup",{cache:"no-store"}),
        user.role==="MANAGER"?fetch("/api/admin/correspondence-settings",{cache:"no-store"}):Promise.resolve(null),
      ]);

      const [d,u,settings]=await Promise.all([dr.json(),ur.json(),sr?.json()]);

      if(d.ok) setRows(d.data); else setError(d.error||"Gagal memuat disposisi.");
      if(u.ok) { setUsers(u.data); setV11Enabled(Boolean(u.v11Enabled)); }
      if(settings?.ok) setDelegation(settings.data.delegation);

    }catch(e){
      setError(e instanceof Error?e.message:"Gagal memuat data disposisi.");
    }
  }

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const prefill=params.get("letter_id")||"";
    const detailId=params.get("disposition_id");
    if(detailId) void openDetail(detailId);
    if(prefill){
      setSelectedLetterId(prefill);
      const wanted=params.get("purpose");
      if(wanted==="INVOICE_VERIFY"||wanted==="INVOICE_PAYMENT"||wanted==="REQUEST_PAYMENT") setPurpose(wanted);
      setOpen(true);
    }
    void load();
  },[]);

  useEffect(()=>{
    if(!open) return;
    const controller=new AbortController();
    setLetterLoading(true);
    setLetterError("");
    const timer=window.setTimeout(()=>{
      const params=new URLSearchParams({for_disposition:"1",limit:"60",q:letterQuery});
      void fetch("/api/letters?"+params,{signal:controller.signal,cache:"no-store"})
        .then(async response=>{
          const result=await response.json();
          if(!response.ok) throw new Error(result.error||"Dokumen belum dapat dimuat.");
          if(!controller.signal.aborted) setLetters(result.data);
        }).catch(error=>{
          if(!controller.signal.aborted) { setLetters([]);setLetterError(error.message); }
        }).finally(()=>{if(!controller.signal.aborted)setLetterLoading(false);});
    },letterQuery?180:0);
    return ()=>{window.clearTimeout(timer);controller.abort();};
  },[open,letterQuery]);

  useEffect(()=>{
    if(!open||!selectedLetterId||pinnedLetter?.id===selectedLetterId) return;
    const controller=new AbortController();
    void fetch("/api/letters?limit=1&id="+encodeURIComponent(selectedLetterId),{signal:controller.signal})
      .then(response=>response.json()).then(result=>{
        if(!controller.signal.aborted&&result.ok&&result.data[0])setPinnedLetter(result.data[0]);
      }).catch(()=>{});
    return ()=>controller.abort();
  },[open,selectedLetterId,pinnedLetter?.id]);

  const filtered=useMemo(()=>rows.filter(d=>{
    const hay=[
      d.subject,d.letter_number,d.external_number,d.instruction,
      d.from_name,d.to_name,d.current_owner_name,d.confidentiality
    ].join(" ").toLowerCase();

    return (!q||hay.includes(q.toLowerCase()))&&(!status||d.status===status);
  }),[rows,q,status]);

  const selectedLetter=letters.find(letter=>letter.id===selectedLetterId) ||
    (pinnedLetter?.id===selectedLetterId?pinnedLetter:undefined);
  const letterChoices=selectedLetter&&!letters.some(letter=>letter.id===selectedLetterId)
    ?[selectedLetter,...letters]:letters;
  const strict=Boolean(v11Enabled||selectedLetter?.v11_kind);
  const scope=users.find(account=>account.id===user.id)?.v11_scope;
  const invoice=selectedLetter?.v11_kind&&selectedLetter.document_type===INVOICE_INCOMING;
  const notePayment=["PERSEKOT","PAYMENT_REQUEST"].includes(selectedLetter?.v11_kind);
  function canDisposeLetter(letter:any) {
    if(letter.direction==="OUTGOING") return letter.status==="ISSUED";
    if(letter.v11_kind) {
      return letter.status==="APPROVED" || (letter.direction==="INCOMING" && Boolean(reviewRole(letter.status)) &&
        (letter.current_owner_user_id===user.id||Boolean(parent&&letter.id===selectedLetterId)));
    }
    return ["APPROVED","DISPOSED","IN_PROGRESS","COMPLETED"].includes(letter.status);
  }
  const allowed=dispositionTargetRoles(user.role, strict);
  const targetUsers=users.filter(account=>{
    if(account.id===user.id||!allowed.includes(account.role)) return false;
    if(strict&&account.role==="MANAGER"&&!account.v11_scope) return false;
    const accountScope=account.role==="FINANCE"?"KSU":unitManagerScope(staffUnit(account.unit_name));
    if(user.role==="MANAGER"){
      if(purpose==="GENERAL"&&delegation!==null){
        if(!delegation.includes(account.id)) return false;
      } else if(strict&&accountScope&&accountScope!==scope) return false;
    }
    if(purpose==="INVOICE_VERIFY") return account.role==="STAFF"&&staffCanVerify(selectedLetter?.v11_unit,account.unit_name);
    if(purpose==="INVOICE_PAYMENT"||purpose==="REQUEST_PAYMENT") return account.role==="FINANCE";
    return !(invoice||notePayment)||account.role!=="FINANCE";
  });

  async function create(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setCreateBusy(true);
    setError("");

    try{
      const form=new FormData(e.currentTarget);
      const payload:Record<string,string>={};
      form.forEach((value,key)=>{
        if(typeof value==="string") payload[key]=value;
      });

      const r=await fetch("/api/dispositions",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload)
      });

      const j=await r.json();

      if(!r.ok){
        setError(j.error||"Gagal membuat disposisi.");
        return;
      }

      let uploaded=0;

      for(const file of createFiles.slice(0,5)){
        const fd=new FormData();
        fd.set("file",file);

        const ur=await fetch(`/api/dispositions/${j.data.id}/attachments`,{
          method:"POST",
          body:fd
        });

        if(ur.ok) uploaded++;
      }

      setOpen(false);
      setCreateFiles([]);
      setSelectedLetterId("");
      setParent(null);
      setPurpose("GENERAL");
      setMessage(`Disposisi berhasil dikirim${uploaded?` dengan ${uploaded} lampiran`:""}.`);
      await load();

    }catch(e){
      setError(e instanceof Error?e.message:"Gagal membuat disposisi.");
    }finally{
      setCreateBusy(false);
    }
  }

  async function openDetail(id:string){
    try{
      const r=await fetch(`/api/dispositions/${id}`,{cache:"no-store"});
      const j=await r.json();
      if(!r.ok){
        setError(j.error||"Gagal membuka detail.");
        return;
      }
      setDetail(j.data);
      setDetailOpen(true);
    }catch(e){
      setError(e instanceof Error?e.message:"Gagal membuka detail disposisi.");
    }
  }

  function startProcess(
    d:any,
    action:string,
    label:string,
    requiredNote=false,
    tone:"primary"|"success"|"danger"="primary"
  ){
    setProcessFiles([]);
    setProcess({id:d.id,action,label,requiredNote,tone,resultRequirement:d.result_requirement,purpose:d.purpose});
  }

  async function submitProcess(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!process) return;

    setProcessBusy(true);
    setError("");

    try{
      const form=new FormData(e.currentTarget);
      const note=String(form.get("note")||"").trim();

      if(process.requiredNote&&!note){
        setError("Catatan wajib diisi untuk proses ini.");
        return;
      }

      const fd=new FormData();
      fd.set("action",process.action);
      fd.set("note",note);
      if(process.action==="SUBMIT_RESULT") fd.set("result_letter_id",String(form.get("result_letter_id")||""));

      if(process.action==="SUBMIT_RESULT"&&process.purpose==="INVOICE_PAYMENT") {
        for(const key of ["payment_amount","payment_date","payment_payee","payment_account","payment_reference","bookkeeping_note"])
          fd.set(key,String(form.get(key)||""));
      }
      processFiles.slice(0,5).forEach(x=>fd.append("files",x));

      const r=await fetch(`/api/dispositions/${process.id}/actions`,{
        method:"POST",
        body:fd
      });

      const j=await r.json();

      if(!r.ok){
        setError(j.error||"Proses disposisi gagal.");
        return;
      }

      const id=process.id;
      const label=process.label;

      setProcess(null);
      setProcessFiles([]);
      setMessage(`${label} berhasil${j.data?.attachments?` dengan ${j.data.attachments} lampiran`:""}.`);

      await load();
      if(detailOpen) await openDetail(id);

    }catch(e){
      setError(e instanceof Error?e.message:"Proses disposisi gagal.");
    }finally{
      setProcessBusy(false);
    }
  }

  async function quickAction(d:any,action:string){
    const fd=new FormData();
    fd.set("action",action);

    const r=await fetch(`/api/dispositions/${d.id}/actions`,{
      method:"POST",
      body:fd
    });

    const j=await r.json();

    if(!r.ok){
      setError(j.error||"Proses gagal.");
      return;
    }

    setMessage(action==="SEEN"?"Disposisi ditandai sudah dilihat.":"Tindak lanjut dimulai.");
    await load();
    if(detailOpen) await openDetail(d.id);
  }

  async function uploadGeneral(id:string,files:File[]){
    for(const file of files.slice(0,5)){
      const fd=new FormData();
      fd.set("file",file);

      const r=await fetch(`/api/dispositions/${id}/attachments`,{
        method:"POST",
        body:fd
      });

      const j=await r.json();

      if(!r.ok){
        setError(j.error||"Upload gagal.");
        return;
      }
    }

    setMessage("Lampiran disposisi berhasil ditambahkan.");
    await load();
    if(detailOpen) await openDetail(id);
  }

  function actionButtons(d:any){
    const owns=
      user.role==="ROOT_ADMIN" ||
      String(d.current_owner_user_id||d.to_user_id)===String(user.id);

    const canCancel=Boolean(d.purpose)&&!TERMINAL_TASK_STATES.includes(d.status)&&(user.role==="ROOT_ADMIN"||d.from_user_id===user.id);
    const out:any[]=[];
    if(canCancel) out.push(<button key="cancel" className="btn btn-danger"
      onClick={()=>startProcess(d,"CANCEL_TASK","Batalkan Tugas",true,"danger")}>Batalkan Tugas</button>);
    if(!owns) return out;

    if(d.status==="UNSEEN"){
      out.push(
        <button key="seen" className="btn btn-secondary" onClick={()=>quickAction(d,"SEEN")}>Seen</button>,
        <button key="start" className="btn btn-primary" onClick={()=>quickAction(d,"START")}>Mulai</button>
      );
    }

    if(d.status==="SEEN"){
      out.push(
        <button key="start" className="btn btn-primary" onClick={()=>quickAction(d,"START")}>Mulai</button>
      );
    }

    if(d.status==="IN_PROGRESS"){
      out.push(
        <button key="result" className="btn btn-success" onClick={()=>startProcess(d,"SUBMIT_RESULT","Kirim Hasil",true,"success")}>
          Kirim Hasil
        </button>
      );
    }

    if(["REVIEW_MANAGER","REVIEW_DIROPS","REVIEW_DIRUT","REVIEW_ROOT"].includes(d.status)){
      out.push(
        <button key="approve" className="btn btn-success" onClick={()=>startProcess(d,"APPROVE_RESULT",reviewButtonLabel(d),false,"success")}>
          {reviewButtonLabel(d)}
        </button>,
        <button key="return-result" className="btn btn-secondary" onClick={()=>startProcess(d,"RETURN_RESULT","Kembalikan Hasil",true,"danger")}>
          Kembalikan Hasil
        </button>
      );
    }

    if(["UNSEEN","SEEN","IN_PROGRESS"].includes(d.status) &&
       (user.role==="ROOT_ADMIN" || String(d.to_user_id)===String(user.id))){
      out.push(
        <button key="return-task" className="btn btn-secondary" onClick={()=>startProcess(d,"RETURN_TASK","Kembalikan Disposisi",true,"danger")}>
          Kembalikan Disposisi
        </button>
      );
    }

    return out;
  }

  const generalAttachments=
    detail?.attachments?.filter((a:any)=>!a.disposition_action_id)||[];

  const processAttachments=(id:string)=>
    detail?.attachments?.filter((a:any)=>a.disposition_action_id===id)||[];

  return <main className="page">
    <div className="page-head">
      <div>
        <h2>Disposisi</h2>
        <p>Penugasan pimpinan ke PIC. Hasil kembali ke pemberi tugas melalui jalur review yang sesuai.</p>
      </div>

      {canCreate&&
        <button className="btn btn-primary" onClick={()=>{setParent(null);setSelectedLetterId("");setPurpose("GENERAL");setOpen(true);setCreateFiles([])}}>
          + Buat Disposisi
        </button>
      }
    </div>

    <div className="notice" style={{marginBottom:13}}>
      <b>Alur:</b> dokumen harus sudah disetujui terlebih dahulu.
      Dirut dapat memberi tugas langsung ke Dirops/Manager/Staff/Finance.
      Jika Dirut memberi tugas ke level di bawah Dirops, hasil otomatis naik ke <b>Dirops → Dirut</b>.
      Disposisi dari Dirops kembali ke Dirops untuk review; disposisi dari Manager kembali ke Manager.
    </div>

    {message&&<div className="success" style={{marginBottom:12}}>{message}</div>}
    {error&&<div className="error" style={{marginBottom:12}}>{error}</div>}

    <div className="toolbar">
      <div className="search">
        <span>⌕</span>
        <input
          value={q}
          onChange={e=>setQ(e.target.value)}
          placeholder="Cari dokumen, instruksi, pengirim, penerima..."
        />
      </div>

      <select className="select filter-select" value={status} onChange={e=>setStatus(e.target.value)}>
        <option value="">Semua status</option>
        <option>UNSEEN</option>
        <option>SEEN</option>
        <option>IN_PROGRESS</option>
        <option>REVIEW_MANAGER</option>
        <option>REVIEW_DIROPS</option>
        <option>REVIEW_DIRUT</option>
        <option value="REVIEW_ROOT">Review Root Admin</option>
        <option>COMPLETED</option>
        <option>RETURNED</option>
      </select>

      {(q||status)&&
        <button className="btn btn-secondary" onClick={()=>{setQ("");setStatus("")}}>
          Reset
        </button>
      }
    </div>

    <div className="card">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Dokumen</th>
              <th>Dari</th>
              <th>PIC Awal</th>
              <th>Posisi Saat Ini</th>
              <th>Instruksi</th>
              <th>Sifat Surat</th>
              <th>Status</th>
              <th>Deadline</th>
              <th>Aksi</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map(d=>
              <tr key={d.id} className={`letter-row ${docClass(d.document_type)}`}>
                <td>
                  <b>{d.subject}</b>
                  <span className="muted" style={{display:"block",fontSize:10}}>
                    {d.letter_number||d.external_number||"-"}
                  </span>
                </td>

                <td>{d.from_name}</td>
                <td>{d.to_name}</td>
                <td><b>{d.current_owner_name||d.to_name}</b></td>
                <td style={{maxWidth:260}}>{d.instruction}</td>
                <td><ConfidentialityBadge value={d.confidentiality}/></td>
                <td><StatusBadge status={d.status}/></td>
                <td>{dispositionDeadline(d.due_date,d.due_time)}</td>

                <td>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    <button className="btn btn-secondary" onClick={()=>openDetail(d.id)}>Detail</button>
                    {actionButtons(d)}
                  </div>
                </td>
              </tr>
            )}

            {!filtered.length&&
              <tr>
                <td colSpan={9}>
                  <div className="empty">Tidak ada disposisi yang sesuai filter.</div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    {open&&
      <Modal
        title="Buat Disposisi"
        subtitle="Pilih dokumen dan penanggung jawab sesuai tahap review."
        onClose={()=>!createBusy&&setOpen(false)}
      >
        <form onSubmit={create} className="form-grid workflow-form">
          {parent&&<div className="field full notice">
            <b>Delegasi dari</b> {parent.subject}
            <input type="hidden" name="parent_id" value={parent.id}/>
            <input type="hidden" name="letter_id" value={selectedLetterId}/>
          </div>}

          <div className="field full">
            <label htmlFor="disposition-letter">Dokumen</label>
            {!parent&&<input className="input" type="search" aria-label="Cari dokumen disposisi"
              placeholder="Cari nomor, perihal, pengirim, atau tujuan…" value={letterQuery}
              onChange={e=>setLetterQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")e.preventDefault();}}/>}
            {letterError&&<span className="hint" role="alert">{letterError}</span>}
            <select id="disposition-letter"
              className="select"
              name="letter_id"
              required
              value={selectedLetterId}
              disabled={Boolean(parent)}
              onChange={e=>{
                setSelectedLetterId(e.target.value);setPurpose("GENERAL");
                setPinnedLetter(letterChoices.find(letter=>letter.id===e.target.value)||null);
              }}
            >
              <option value="">{letterLoading?"Mencari dokumen…":letterChoices.length?"Pilih dokumen…":"Tidak ada dokumen yang cocok"}</option>

              {letterChoices.filter(canDisposeLetter).map(l=>
                <option value={l.id} key={l.id}>
                  {l.direction==="INCOMING"
                    ?"Surat Masuk"
                    :l.direction==="INTERNAL"
                      ?"Nota Dinas"
                      :"Surat Keluar"} — {l.display_number||l.letter_number||l.external_number||"-"} — {l.subject}
                </option>
              )}
            </select>

            {selectedLetter?.confidentiality&&<span className="hint">Sifat surat <ConfidentialityBadge value={selectedLetter.confidentiality}/></span>}
            <span className="hint">
              Reviewer aktif dapat memberi tugas saat Surat Masuk V11 masih diperiksa.
            </span>
          </div>

          {(invoice||notePayment)&&<label className="field">
            <span>Tujuan Tugas</span>
            <select className="select" name="purpose" required value={purpose} onChange={e=>setPurpose(e.target.value as TaskPurpose)}>
              <option value="GENERAL">{TASK_PURPOSES.GENERAL}</option>
              {invoice&&user.role==="MANAGER"&&selectedLetter.status==="MANAGER_REVIEW"&&selectedLetter.current_owner_user_id===user.id&&
                <option value="INVOICE_VERIFY">{TASK_PURPOSES.INVOICE_VERIFY}</option>}
              {!parent&&scope==="KSU"&&selectedLetter.status==="APPROVED"&&
                (invoice ? <option value="INVOICE_PAYMENT">{TASK_PURPOSES.INVOICE_PAYMENT}</option>
                  : <option value="REQUEST_PAYMENT">{TASK_PURPOSES.REQUEST_PAYMENT}</option>)}
            </select>
          </label>}
          <div className="field">
            <SearchableSelect key={purpose} label="Diteruskan Kepada" ariaLabel="Diteruskan kepada" name="to_user_id" required
              options={targetUsers.map(u=>({value:u.id,label:u.name+" — "+(u.unit_name||u.role),search:u.email}))}
              placeholder="Pilih PIC…" sizeThreshold={3}/>
          </div>

          <div className="field">
            <label>Visibilitas</label>
            <select key={selectedLetter?.confidentiality==="RAHASIA"?"restricted":"normal"} className="select" name="visibility" defaultValue="ROUTE" required>
              <option value="PUBLIC">PUBLIC — semua user persuratan</option>
              <option value="ROUTE">ROUTE — pihak dalam jalur</option>
              <option value="PRIVATE">PRIVATE — pihak terkait</option>
            </select>
          </div>

          <div className="field">
            <label>Prioritas</label>
            <select className="select" name="priority" defaultValue="NORMAL" required>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="disposition-due-date">Tanggal Target Selesai</label>
            <input id="disposition-due-date" className="input" type="date" name="due_date"/>
          </div>
          <div className="field">
            <label htmlFor="disposition-due-time">Jam Target Selesai (WIB)</label>
            <input id="disposition-due-time" className="input" type="time" name="due_time"/>
            <span className="hint">Isi tanggal jika menetapkan jam. Tanpa jam, tenggat berlaku sampai akhir hari.</span>
          </div>

          <div className="field">
            <label>Hasil yang Diminta</label>
            {purpose!=="GENERAL" ? <span className="input">Ringkasan dan bukti PDF atau gambar</span> :
            <select aria-label="Hasil yang diminta" className="select" name="result_requirement" required defaultValue={parent?.result_requirement||"SUMMARY"}>
              {Object.entries(RESULT_REQUIREMENTS).map(([value,label])=><option key={value} value={value}>{label}</option>)}
            </select>}
          </div>
          <div className="field full">
            <label>Instruksi / Catatan Disposisi</label>
            <textarea
              className="textarea"
              name="instruction"
              required
              placeholder="Contoh: Mohon ditelaah dan tindak lanjuti sesuai kewenangan."
            />
          </div>

          <div className="field full">
            <label>Lampiran Tambahan <span className="muted">(opsional, maksimal 5 file)</span></label>
            <input
              className="input"
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv"
              onChange={e=>setCreateFiles(Array.from(e.target.files||[]).slice(0,5))}
            />
            <span className="hint">Maks. 10 MB/file.</span>
          </div>

          <div className="field full modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={createBusy}
              onClick={()=>setOpen(false)}
            >
              Batal
            </button>

            <button className="btn btn-primary" disabled={createBusy}>
              {createBusy?"Mengirim...":"Kirim Disposisi"}
            </button>
          </div>
        </form>
      </Modal>
    }

    {detailOpen&&detail&&
      <Modal
        title={detail.disposition.subject}
        subtitle={`Dari ${detail.disposition.from_name} → PIC ${detail.disposition.to_name}`}
        onClose={()=>setDetailOpen(false)}
      >
        <div className="grid-2">
          <div>
            <div className="kpi-list">
              <div className="kpi-row">
                <span>Status</span>
                <StatusBadge status={detail.disposition.status}/>
              </div>

              <div className="kpi-row">
                <span>Sifat Surat</span><ConfidentialityBadge value={detail.disposition.confidentiality}/>
              </div>

              <div className="kpi-row">
                <span>Posisi Saat Ini</span>
                <b>{detail.disposition.current_owner_name||detail.disposition.to_name}</b>
              </div>

              <div className="kpi-row">
                <span>PIC Awal</span>
                <b>{detail.disposition.to_name}</b>
              </div>

              <div className="kpi-row">
                <span>Hasil yang Diminta</span>
                <b>{RESULT_REQUIREMENTS[(detail.disposition.result_requirement||"SUMMARY") as ResultRequirement]}</b>
                {detail.disposition.purpose&&<span>{TASK_PURPOSES[detail.disposition.purpose as TaskPurpose]}</span>}
              </div>
              <div className="kpi-row">
                <span>Prioritas</span>
                <b>{detail.disposition.priority}</b>
              </div>

              <div className="kpi-row">
                <span>Deadline</span>
                <b>{dispositionDeadline(detail.disposition.due_date,detail.disposition.due_time)}</b>
              </div>
            </div>

            <div className="notice" style={{marginTop:12}}>
              <b>Instruksi</b><br/>
              {detail.disposition.instruction}
            </div>

            {detail.disposition.result_note&&
              <div className="success" style={{marginTop:12}}>
                <b>Hasil tindak lanjut</b><br/>
                {detail.disposition.result_note}
              </div>
            }

            <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:12}}>
              {actionButtons(detail.disposition)}
              {detail.disposition.status==="IN_PROGRESS"&&(detail.disposition.to_user_id===user.id||user.role==="ROOT_ADMIN")&&<>
                {["STAFF","FINANCE","ROOT_ADMIN"].includes(user.role)&&
                  <a className="btn btn-secondary" href={"/letters/outgoing?source_disposition_id="+encodeURIComponent(detail.disposition.id)}>Buat Draf Surat Hasil</a>}
                {canCreate&&<button className="btn btn-secondary" onClick={()=>{
                  setParent(detail.disposition);
                  setPurpose("GENERAL");
                  setSelectedLetterId(detail.disposition.letter_id);
                  setCreateFiles([]);
                  setDetailOpen(false);
                  setOpen(true);
                }}>Delegasikan ke PIC</button>}
              </>}
            </div>

            {detail.paymentDocuments&&<PaymentDocumentsPanel id={detail.disposition.letter_id}
              data={{...detail.paymentDocuments,editable:false}}/>}

            {detail.sandboxSigning && <AttachmentSandbox key={detail.disposition.id}
              files={detail.attachments.filter((file:any) =>
                ["ORIGINAL","ADDITIONAL"].includes(file.attachment_kind) ||
                detail.actions.some((action:any) => action.id === file.disposition_action_id && action.action === "SUBMIT_RESULT"))
              }/>}

            <div className="card" style={{boxShadow:"none",marginTop:14}}>
              <div className="card-head">
                <div>
                  <h3>Lampiran</h3>
                  <p>Dokumen pendukung umum pada disposisi.</p>
                </div>
              </div>

              <div className="card-body">
                {generalAttachments.map((a:any)=>
                  <div className="disposition-file" key={a.id}>
                    <div>
                      <b>{a.original_name}</b>
                      <span style={{display:"block"}}>
                        {size(Number(a.original_size))}
                        {a.is_compressed?" • compressed":""}
                        {" • "}{a.uploaded_by_name}
                      </span>
                    </div>

                    <AttachmentActions id={a.id} name={a.original_name}/>
                  </div>
                )}

                {!generalAttachments.length&&
                  <div className="empty">Belum ada lampiran umum.</div>
                }

                {(user.role==="ROOT_ADMIN" ||
                  detail.disposition.to_user_id===user.id ||
                  detail.disposition.from_user_id===user.id ||
                  detail.disposition.current_owner_user_id===user.id)&&
                  <label className="btn btn-secondary" style={{marginTop:10}}>
                    + Tambah Lampiran
                    <input
                      hidden
                      type="file"
                      multiple
                      onChange={async e=>{
                        await uploadGeneral(detail.disposition.id,Array.from(e.target.files||[]));
                        e.currentTarget.value="";
                      }}
                    />
                  </label>
                }
              </div>
            </div>
          </div>

          <div>
            <div className="disposition-history-heading">
              <h3 style={{fontSize:13}}>Riwayat Proses</h3>
              <a className="btn btn-secondary" href={`/api/dispositions/${detail.disposition.id}/export`} download>
                Unduh Riwayat (.xlsx)
              </a>
            </div>
            <p className="muted" style={{fontSize:11}}>
              Seluruh Seen, Mulai, Kirim Hasil, Review, Return, catatan, dan lampiran proses tercatat.
            </p>

            <div className="timeline">
              {detail.actions?.map((a:any,i:number)=>{
                const af=processAttachments(a.id);

                return <div className="timeline-row" key={a.id}>
                  <div className="timeline-dot">{i+1}</div>

                  <div style={{width:"100%"}}>
                    <b>{dispositionActionLabel(a.action)} • {a.actor_name}</b><p className="muted">{formatWorkflowTime(a.created_at)}</p>
                    <p>
                      {a.from_status?`${a.from_status} → ${a.to_status}`:a.to_status}
                      {a.note?` • ${a.note}`:""}
                    </p>

                    {a.result_letter&&
                      <a className="btn btn-secondary" href={"/letters/outgoing?letter_id="+encodeURIComponent(a.result_letter.id)}>
                        Surat hasil · {a.result_letter.number||a.result_letter.subject}
                      </a>}
                    {af.length>0&&
                      <div className="disposition-files">
                        {af.map((f:any)=>
                          <div className="disposition-file" key={f.id}>
                            <div>
                              <b>{f.original_name}</b>
                              <span style={{display:"block"}}>
                                {size(Number(f.original_size))}
                                {f.is_compressed?" • compressed":""}
                              </span>
                            </div>

                            <AttachmentActions id={f.id} name={f.original_name}/>
                          </div>
                        )}
                      </div>
                    }
                  </div>
                </div>
              })}
            </div>
          </div>
        </div>
      </Modal>
    }

    {process&&
      <Modal
        title={process.label}
        subtitle="Catatan dan lampiran proses akan masuk ke riwayat dan Audit Log."
        onClose={()=>!processBusy&&setProcess(null)}
      >
        <form className="form-grid workflow-form" onSubmit={submitProcess}>
          {error&&<div className="field full error" role="alert">{error}</div>}
          <div className="field full">
            <label>
              {process.requiredNote?"Catatan / Hasil (wajib)":"Catatan Proses (opsional)"}
            </label>

            <textarea
              className="textarea"
              name="note"
              required={process.requiredNote}
              placeholder={
                process.action==="SUBMIT_RESULT"
                  ?"Tuliskan ringkasan hasil tindak lanjut..."
                  :process.action==="RETURN_RESULT"
                    ?"Jelaskan bagian hasil yang perlu diperbaiki..."
                    :process.action==="RETURN_TASK"
                      ?"Jelaskan alasan disposisi dikembalikan..."
                      :"Catatan review..."
              }
            />
          </div>

          {process.action==="SUBMIT_RESULT"&&process.purpose==="INVOICE_PAYMENT"&&<>
            <label className="field"><span>Nominal Bayar (Rp)</span><input className="input" name="payment_amount" inputMode="decimal" required/></label>
            <label className="field"><span>Tanggal Bayar</span><input className="input" type="date" name="payment_date" max={jakartaDate()} required/></label>
            <label className="field"><span>Nama Penerima</span><input className="input" name="payment_payee" required/></label>
            <label className="field"><span>Rekening Tujuan</span><input className="input" name="payment_account" required/></label>
            <label className="field"><span>Referensi Transfer / BPK</span><input className="input" name="payment_reference" required/></label>
            <label className="field full"><span>Catatan Pembukuan</span><textarea className="textarea" name="bookkeeping_note" required/></label>
            <p className="field full muted">Catat pembayaran yang sudah dilakukan melalui kanal resmi. Lampirkan buktinya sebelum mengirim hasil.</p>
          </>}
          {process.action==="SUBMIT_RESULT"&&(!process.purpose||process.purpose==="GENERAL")&&
            <ResultLetterField dispositionId={process.id} required={process.resultRequirement==="OUTGOING_LETTER"}/>}
          <div className="field full">
            <label>Lampiran Proses <span className="muted">
              ({process.action==="SUBMIT_RESULT"&&process.resultRequirement==="ATTACHMENT"?"wajib":"opsional"}, maksimal 5 file)
            </span></label>
            <input
              className="input"
              type="file"
              multiple
              required={process.action==="SUBMIT_RESULT"&&process.resultRequirement==="ATTACHMENT"}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv"
              onChange={e=>setProcessFiles(Array.from(e.target.files||[]).slice(0,5))}
            />
          </div>

          {detail?.payments?.length>0&&["APPROVE_RESULT","RETURN_RESULT"].includes(process.action)&&
            <div className="field full notice">
              {detail.payments.filter((item:any)=>item.status==="PENDING").map((item:any)=><div key={item.id}>
                <b>{formatInvoiceAmount(item.amount)} · {String(item.payment_date).slice(0,10)}</b>
                <div>{item.payee} · {item.recipient_account} · {item.reference}</div>
                <div>{item.bookkeeping_note}</div>{item.evidence_id&&
                  <AttachmentActions id={item.evidence_id}
                    name={detail.attachments.find((file:any)=>file.id===item.evidence_id)?.original_name||"Bukti pembayaran.pdf"}
                    downloadLabel="Unduh bukti pembayaran"/>}
              </div>)}
            </div>}
          <div className="field full modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={processBusy}
              onClick={()=>setProcess(null)}
            >
              Batal
            </button>

            <button
              className={`btn ${
                process.tone==="danger"
                  ?"btn-danger"
                  :process.tone==="success"
                    ?"btn-success"
                    :"btn-primary"
              }`}
              disabled={processBusy}
            >
              {processBusy?"Memproses...":process.label}
            </button>
          </div>
        </form>
      </Modal>
    }
  </main>;
}
