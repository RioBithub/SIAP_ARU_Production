"use client";

import { FormEvent,useEffect,useMemo,useState } from "react";
import type { SessionUser } from "@/lib/types";
import ConfidentialityBadge from "@/components/ConfidentialityBadge";
import DispositionLetterPicker, { type DispositionLetterOption } from "@/components/DispositionLetterPicker";
import AttachmentActions from "@/components/AttachmentActions";
import DispositionHistory, { type PreviousDisposition } from "@/components/DispositionHistory";
import LetterHistory from "@/components/LetterHistory";
import PaymentDocumentsPanel from "@/components/PaymentDocumentsPanel";
import SearchableSelect from "@/components/SearchableSelect";
import { dispositionDeadline } from "@/lib/workflow-time";
import AttachmentSandbox from "@/components/AttachmentSandbox";
import Modal from "@/components/Modal";
import StatusBadge from "@/components/StatusBadge";
import { letterDirectionLabel, RESULT_REQUIREMENTS, type ResultRequirement } from "@/lib/correspondence-workflow";
import { INVOICE_INCOMING, formatInvoiceAmount, type DocumentReference } from "@/lib/business-documents";
import { dispositionTargetRoles, jakartaDate, staffCanVerify, staffUnit, TASK_PURPOSES, TERMINAL_TASK_STATES,
  unitManagerScope, type RequestingUnit, type TaskPurpose } from "@/lib/v11-workflow";

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
  reassignment?: { instruction: string; pic: string; dueDate: string; dueTime: string };
};

type DispositionLetter = {
  id: string;
  subject: string;
  direction: string;
  display_number: string | null;
  letter_number: string | null;
  external_number: string | null;
  document_type: string;
  status: string;
  confidentiality: string;
  current_owner_user_id: string | null;
  v11_kind: string | null;
  v11_unit: RequestingUnit | null;
};

function letterOption(letter: DispositionLetter): DispositionLetterOption {
  const type = letterDirectionLabel(letter.direction);
  const number = letter.display_number || letter.letter_number || letter.external_number;
  return { id: letter.id, subject: letter.subject, reference: number ? `${type} · ${number}` : type };
}

async function fetchDispositionLetters(params: URLSearchParams, signal: AbortSignal): Promise<DispositionLetter[]> {
  const response = await fetch("/api/letters?" + params, { signal, cache: "no-store" }).catch(() => null);
  if (response?.status === 401) throw new Error("Sesi berakhir. Silakan masuk kembali.");
  const result = await response?.json().catch(() => null);
  if (!response?.ok || !result?.ok || !Array.isArray(result.data)) {
    throw new Error("Pencarian dokumen belum tersedia.");
  }
  return result.data;
}

const ASSIGNEE_TASK_STATES = ["UNSEEN", "SEEN", "IN_PROGRESS"];
const SOURCE_FILE_LABELS: Record<string, string> = {
  ORIGINAL: "Dokumen surat", ADDITIONAL: "Lampiran surat", PROCESS: "Bukti proses surat",
  RECEIPT: "Bukti serah terima", SIGNED: "Surat bertanda tangan", DISPATCH: "Bukti pengiriman",
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
  const [selectedLetterId,setSelectedLetterId]=useState("");
  const [pinnedLetter,setPinnedLetter]=useState<DispositionLetter|null>(null);
  const [letterQuery,setLetterQuery]=useState("");
  const [letterResponse,setLetterResponse]=useState<{ term: string; letters: DispositionLetter[]; error?: string }|null>(null);
  const [letterAttempt,setLetterAttempt]=useState(0);
  const [delegation,setDelegation]=useState<string[]|null>(null);
  const [parent,setParent]=useState<{id:string;subject:string;from_name:string;result_requirement:ResultRequirement}|null>(null);
  const [open,setOpen]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [createFiles,setCreateFiles]=useState<File[]>([]);
  const [createBusy,setCreateBusy]=useState(false);
  const [createError,setCreateError]=useState("");
  const [detail,setDetail]=useState<any>(null);
  const [detailOpen,setDetailOpen]=useState(false);
  const [process,setProcess]=useState<ProcessAction|null>(null);
  const [processFiles,setProcessFiles]=useState<File[]>([]);
  const [processBusy,setProcessBusy]=useState(false);
  const [q,setQ]=useState("");
  const [status,setStatus]=useState("");

  const canCreate=["ROOT_ADMIN","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR"].includes(user.role);
  const letterTerm=letterQuery.trim();

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
    if(!open||parent) return;
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      const params=new URLSearchParams({for_disposition:"1",limit:"60",q:letterTerm});
      void fetchDispositionLetters(params,controller.signal)
        .then(letters=>{
          if(!controller.signal.aborted) setLetterResponse({term:letterTerm,letters});
        }).catch(error=>{
          if(!controller.signal.aborted) setLetterResponse({term:letterTerm, letters:[],
            error:error instanceof Error?error.message:"Dokumen belum dapat dimuat."});
        });
    },letterTerm?180:0);
    return ()=>{window.clearTimeout(timer);controller.abort();};
  },[open,parent,letterTerm,letterAttempt]);

  useEffect(()=>{
    if(!open||!selectedLetterId||pinnedLetter?.id===selectedLetterId) return;
    const controller=new AbortController();
    const params=new URLSearchParams({limit:"1",id:selectedLetterId});
    if(!parent) params.set("for_disposition","1");
    void fetchDispositionLetters(params,controller.signal).then(([letter])=>{
        if(!controller.signal.aborted&&letter) setPinnedLetter(letter);
      }).catch(()=>{});
    return ()=>controller.abort();
  },[open,parent,selectedLetterId,pinnedLetter?.id]);

  const filtered=useMemo(()=>{
    const term=q.trim().toLowerCase();
    const matches=rows.filter(d=>{
      const hay=[
        d.subject,d.letter_number,d.external_number,d.instruction,
        d.from_name,d.to_name,d.current_owner_name,d.confidentiality
      ].join(" ").toLowerCase();
      return hay.includes(term)&&(!status||d.status===status);
    });
    const ids=new Set(matches.map(task=>task.id));
    const children=new Map<string,typeof rows>();
    for(const task of matches){
      if(!ids.has(task.parent_id)) continue;
      const siblings=children.get(task.parent_id)??[];
      siblings.push(task);
      children.set(task.parent_id,siblings);
    }
    const ordered:{task:any;depth:number}[]=[];
    const visited=new Set<string>();
    function add(task:any,depth:number){
      if(visited.has(task.id)) return;
      visited.add(task.id);
      ordered.push({task,depth});
      for(const child of children.get(task.id)??[]) add(child,depth+1);
    }
    for(const task of matches) if(!ids.has(task.parent_id)) add(task,0);
    for(const task of matches) add(task,0);
    return ordered;
  },[rows,q,status]);

  const currentResponse=letterResponse?.term===letterTerm?letterResponse:null;
  const letterChoices=currentResponse?.letters??[];
  const selectedLetter=letterChoices.find(letter=>letter.id===selectedLetterId) ||
    (pinnedLetter?.id===selectedLetterId?pinnedLetter:undefined);
  const selectedOption=selectedLetter?letterOption(selectedLetter):null;
  const delegationSources=!parent&&selectedOption&&purpose==="GENERAL"&&["MANAGER","DIRECTOR_OPS"].includes(user.role)
    ? rows.filter(task=>task.letter_id===selectedOption.id&&task.to_user_id===user.id&&ASSIGNEE_TASK_STATES.includes(task.status))
    : [];
  const strict=Boolean(v11Enabled||selectedLetter?.v11_kind);
  const scope=users.find(account=>account.id===user.id)?.v11_scope;
  const invoice=selectedLetter?.v11_kind&&selectedLetter.document_type===INVOICE_INCOMING;
  const notePayment=selectedLetter?.v11_kind==="PERSEKOT"||selectedLetter?.v11_kind==="PAYMENT_REQUEST";
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
    if(purpose==="INVOICE_VERIFY") return account.role==="STAFF"&&selectedLetter?.v11_unit&&staffCanVerify(selectedLetter.v11_unit,account.unit_name);
    if(purpose==="INVOICE_PAYMENT"||purpose==="REQUEST_PAYMENT") return account.role==="FINANCE";
    return !(invoice||notePayment)||account.role!=="FINANCE";
  });

  function searchLetters(query:string) {
    setLetterQuery(query);
    setSelectedLetterId("");
    setPinnedLetter(null);
    setPurpose("GENERAL");
  }

  function selectLetter(id:string) {
    const letter=letterChoices.find(choice=>choice.id===id);
    if(!letter) return;
    setPinnedLetter(letter);
    setSelectedLetterId(id);
    if(id!==selectedLetterId) setPurpose("GENERAL");
    setLetterQuery("");
  }

  async function create(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setCreateBusy(true);
    setCreateError("");

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

      const j=await r.json().catch(()=>null);

      if(!r.ok||!j?.data?.id){
        setCreateError(j?.error||"Gagal membuat disposisi.");
        return;
      }

      let uploaded=0;
      const attachments=createFiles.slice(0,5);

      for(const file of attachments){
        const fd=new FormData();
        fd.set("file",file);

        const ur=await fetch(`/api/dispositions/${j.data.id}/attachments`,{
          method:"POST",
          body:fd
        }).catch(()=>null);

        if(ur?.ok) uploaded++;
      }

      setOpen(false);
      setCreateFiles([]);
      setSelectedLetterId("");
      setParent(null);
      setPurpose("GENERAL");
      const outcome=j.data.parent_id?"Delegasi tersambung ke disposisi asal.":"Disposisi berhasil dikirim.";
      const uploadStatus=uploaded<attachments.length
        ? ` ${uploaded} dari ${attachments.length} lampiran tambahan tersimpan. Unggah sisanya dari detail tugas.`
        : uploaded?` ${uploaded} lampiran tambahan tersimpan.`:"";
      setMessage(outcome+uploadStatus);
      await load();
      if(j.data.parent_id) await openDetail(j.data.parent_id);

    }catch{
      setCreateError("Gagal mengirim disposisi. Cek daftar sebelum mencoba lagi.");
    }finally{
      setCreateBusy(false);
    }
  }

  async function readDetail(id:string){
    const response=await fetch(`/api/dispositions/${id}`,{cache:"no-store"});
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result?.data?.disposition) throw new Error(result?.error||"Gagal membuka detail disposisi.");
    return result.data;
  }

  async function refreshDetail(id:string){
    const next=await readDetail(id);
    setDetail((current:typeof detail)=>current?.disposition.id===id?next:current);
  }

  async function openDetail(id:string){
    try{
      setDetail(await readDetail(id));
      setDetailOpen(true);
      return true;
    }catch(e){
      setError(e instanceof Error?e.message:"Gagal membuka detail disposisi.");
      return false;
    }
  }

  async function startProcess(
    d:any,
    action:string,
    label:string,
    requiredNote=false,
    tone:"primary"|"success"|"danger"="primary"
  ){
    setError("");
    const needsDetail=(action==="SUBMIT_RESULT"&&d.purpose==="INVOICE_VERIFY")||
      (["APPROVE_RESULT","RETURN_RESULT"].includes(action)&&d.purpose==="INVOICE_PAYMENT");
    if(needsDetail&&(!detailOpen||detail?.disposition.id!==d.id)){
      try{
        setDetail(await readDetail(d.id));
      }catch(e){
        setError(e instanceof Error?e.message:"Gagal membuka detail disposisi.");
        return;
      }
    }
    setProcessFiles([]);
    setProcess({
      id:d.id,action,label,requiredNote,tone,resultRequirement:d.result_requirement,purpose:d.purpose,
      reassignment:action==="REASSIGN_TASK"?{
        instruction:d.instruction,pic:d.to_name,dueDate:d.due_date?.slice(0,10)||"",dueTime:d.due_time?.slice(0,5)||"",
      }:undefined,
    });
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
      if(process.reassignment){
        fd.set("due_date",String(form.get("due_date")||""));
        fd.set("due_time",String(form.get("due_time")||""));
      }

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

    const returned=d.status==="RETURNED";
    const canCancel=(returned||Boolean(d.purpose)&&!TERMINAL_TASK_STATES.includes(d.status))&&
      (user.role==="ROOT_ADMIN"||d.from_user_id===user.id);
    const out:any[]=[];
    if(returned&&d.from_user_id===user.id&&d.current_owner_user_id===user.id) out.push(
      <button key="reassign" className="btn btn-primary"
        onClick={()=>startProcess(d,"REASSIGN_TASK","Perbaiki & Tugaskan Ulang",true)}>Perbaiki & Tugaskan Ulang</button>);
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
      const label=d.return_note?"Kirim Ulang Hasil":"Kirim Hasil";
      out.push(
        <button key="result" className="btn btn-success" onClick={()=>startProcess(d,"SUBMIT_RESULT",label,true,"success")}>
          {label}
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
  const sourceAttachments=detail?.sourceAttachments??[];
  const childTasks=detail?.children??[];
  const submittingVerification=process?.action==="SUBMIT_RESULT"&&process.purpose==="INVOICE_VERIFY";



  return <main className="page">
    <div className="page-head">
      <div>
        <h2>Disposisi</h2>
        <p>Penugasan pimpinan ke PIC. Hasil kembali ke pemberi tugas melalui jalur review yang sesuai.</p>
      </div>

      {canCreate&&
        <button className="btn btn-primary" onClick={()=>{
          setParent(null);
          searchLetters("");
          setLetterResponse(null);
          setCreateFiles([]);
          setCreateError("");
          setOpen(true);
        }}>
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
            {filtered.map(({task:d,depth})=>
              <tr key={d.id} className={`letter-row ${docClass(d.document_type)}`}>
                <td>
                  <div className={depth?"disposition-child":""} style={depth?{marginInlineStart:Math.min(depth-1,3)*10}:undefined}>
                    <b>{depth?`Delegasi ke ${d.to_name}`:d.subject}</b>
                    <span className="muted" style={{display:"block",fontSize:10}}>
                      {d.parent_id&&!depth?"Delegasi · ":""}{d.letter_number||d.external_number||"-"}
                    </span>
                  </div>
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
        title={parent?"Teruskan Disposisi":"Buat Disposisi"}
        subtitle="Pilih dokumen dan penanggung jawab sesuai tahap review."
        onClose={()=>!createBusy&&setOpen(false)}
      >
        <form onSubmit={create} className="form-grid workflow-form">
          {createError&&<div className="error field full" role="alert">{createError}</div>}
          {parent&&<div className="field full notice">
            Terhubung ke tugas dari <b>{parent.from_name}</b>.
            <input type="hidden" name="parent_id" value={parent.id}/>
          </div>}
          <input type="hidden" name="letter_id" value={parent?selectedLetterId:selectedOption?.id||""}/>

          <div className="field full">
            {parent ? <>
              <label htmlFor="disposition-source-letter">Dokumen</label>
              <input id="disposition-source-letter" className="input" required readOnly
                value={selectedOption?`${selectedOption.reference} — ${selectedOption.subject}`:parent.subject}/>
            </> : <DispositionLetterPicker options={letterChoices.map(letterOption)} selected={selectedOption}
              query={letterQuery} loading={!currentResponse} error={currentResponse?.error}
              onSearch={searchLetters} onSelect={selectLetter} onRetry={()=>{
                setLetterResponse(null);
                setLetterAttempt(attempt=>attempt+1);
              }}/>}

            {selectedLetter?.confidentiality&&<span className="hint">Sifat surat <ConfidentialityBadge value={selectedLetter.confidentiality}/></span>}
            {delegationSources.length===1&&<span className="hint">
              {delegationSources[0].status==="IN_PROGRESS"
                ? `Disposisi ini akan tersambung ke tugas dari ${delegationSources[0].from_name}.`
                : "Mulai disposisi asal sebelum meneruskannya ke PIC."}
            </span>}
            {delegationSources.length>1&&<span className="hint">Buka salah satu disposisi asal lalu pilih Teruskan ke PIC.</span>}
          </div>

          {selectedLetter&&(invoice||notePayment)&&<label className="field">
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
            <span className="hint">Lampiran surat asal ikut ditampilkan. Unggah berkas tambahan bila perlu, maks. 10 MB per file.</span>
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

    {detailOpen&&detail&&<div hidden={Boolean(process)}>
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

            {detail.disposition.return_note&&["RETURNED","IN_PROGRESS"].includes(detail.disposition.status)&&
              <div className="notice" style={{marginTop:12}}>
                <b>{detail.disposition.status==="RETURNED"?"Alasan pengembalian disposisi":"Catatan revisi hasil"}</b><br/>
                {detail.disposition.return_note}
                {detail.disposition.status==="RETURNED"&&
                  <p>PIC dapat melanjutkan setelah pemberi tugas menugaskan ulang disposisi ini.</p>}
              </div>
            }

            {detail.disposition.result_note&&
              <div className="success" style={{marginTop:12}}>
                <b>{detail.disposition.status==="IN_PROGRESS"?"Hasil sebelumnya":"Hasil tindak lanjut"}</b><br/>
                {detail.disposition.result_note}
              </div>
            }

            <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:12}}>
              {actionButtons(detail.disposition)}
              {detail.disposition.status==="IN_PROGRESS"&&(detail.disposition.to_user_id===user.id||user.role==="ROOT_ADMIN")&&<>
                {(!detail.disposition.purpose||detail.disposition.purpose==="GENERAL")&&
                  ["STAFF","FINANCE","ROOT_ADMIN"].includes(user.role)&&
                  <a className="btn btn-secondary" href={"/letters/outgoing?source_disposition_id="+encodeURIComponent(detail.disposition.id)}>Buat Draf Surat Hasil</a>}
                {canCreate&&(detail.disposition.to_user_id===user.id||!detail.disposition.purpose)&&<button className="btn btn-secondary" onClick={()=>{
                  searchLetters("");
                  setParent(detail.disposition);
                  setSelectedLetterId(detail.disposition.letter_id);
                  setCreateFiles([]);
                  setCreateError("");
                  setDetailOpen(false);
                  setOpen(true);
                }}>Teruskan ke PIC</button>}
              </>}
            </div>

            {(detail.parent||childTasks.length>0)&&<section className="card disposition-context">
              <div className="card-head"><h3>Jalur Disposisi</h3></div>
              <div className="card-body">
                {detail.parent&&<div className="disposition-file">
                  <div><b>Tugas asal</b><div>{detail.parent.from_name} → {detail.parent.to_name}</div></div>
                  <button className="btn btn-secondary" onClick={()=>void openDetail(detail.parent.id)}>Buka Tugas Asal</button>
                </div>}
                {childTasks.map((task:any)=><div className="disposition-file" key={task.id}>
                  <div><b>Delegasi ke {task.to_name}</b><div>Posisi saat ini · {task.current_owner_name||task.to_name}</div></div>
                  <StatusBadge status={task.status}/>
                  <button className="btn btn-secondary" onClick={()=>void openDetail(task.id)}>Buka Delegasi</button>
                </div>)}
              </div>
            </section>}

            <section className="card disposition-context">
              <div className="card-head"><h3>Lampiran Surat Asal</h3></div>
              <div className="card-body">
                {sourceAttachments.map((file:any)=><div className="disposition-file" key={file.id}>
                  <div>
                    <b>{file.original_name}</b>
                    <span className="muted" style={{display:"block"}}>{SOURCE_FILE_LABELS[file.source_kind]||"Lampiran"} · {size(Number(file.original_size))}</span>
                  </div>
                  <AttachmentActions id={file.id} name={file.original_name}/>
                </div>)}
                {!sourceAttachments.length&&<div className="empty">Belum ada lampiran surat asal yang tersedia.</div>}
              </div>
            </section>

            {!process&&detail.paymentDocuments&&<PaymentDocumentsPanel key={`payment-${detail.disposition.id}`} id={detail.disposition.letter_id}
              data={detail.paymentDocuments} attachments={sourceAttachments} onSaved={()=>refreshDetail(detail.disposition.id)}/>}

            {detail.sandboxSigning && <AttachmentSandbox key={`attachment-sandbox-${detail.disposition.id}`}
              files={detail.attachments.filter((file:any) =>
                ["ORIGINAL","ADDITIONAL"].includes(file.attachment_kind) ||
                detail.actions.some((action:any) => action.id === file.disposition_action_id && action.action === "SUBMIT_RESULT"))
              }/>}

            <div className="card" style={{boxShadow:"none",marginTop:14}}>
              <div className="card-head">
                <div>
                  <h3>Lampiran Tambahan Disposisi</h3>
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
                  <div className="empty">Belum ada lampiran tambahan.</div>
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
                        const files=Array.from(e.currentTarget.files||[]);
                        e.currentTarget.value="";
                        await uploadGeneral(detail.disposition.id,files);
                      }}
                    />
                  </label>
                }
              </div>
            </div>
          </div>

          <div>
            <div className="disposition-history-heading">
              <h3 style={{fontSize:13}}>Riwayat Disposisi</h3>
              <a className="btn btn-secondary" href={`/api/dispositions/${detail.disposition.id}/export`} download>
                Unduh Riwayat (.xlsx)
              </a>
            </div>

            <DispositionHistory actions={detail.actions??[]} attachments={detail.attachments??[]}/>
            {detail.previousTasks?.length > 0 && <details className="disposition-source-history" key={"tasks-" + detail.disposition.id}>
              <summary>Riwayat Delegasi Sebelumnya</summary>
              <div className="disposition-source-history-content">
                {detail.previousTasks.map((task:PreviousDisposition) => <section className="disposition-previous-task" key={task.id}>
                  <h4>{task.from_name} → {task.to_name}</h4>
                  <DispositionHistory actions={task.actions} attachments={task.attachments}/>
                </section>)}
              </div>
            </details>}
            <details className="disposition-source-history" key={detail.disposition.id}>
              <summary>Riwayat {letterDirectionLabel(detail.disposition.direction)} Asal</summary>
              <div className="disposition-source-history-content">
                <LetterHistory actions={detail.sourceActions??[]} attachments={sourceAttachments}/>
              </div>
            </details>
          </div>
        </div>
      </Modal>
    </div>}

    {process&&
      <Modal
        title={process.label}
        subtitle="Catatan dan lampiran proses akan masuk ke riwayat dan Audit Log."
        onClose={()=>!processBusy&&setProcess(null)}
      >
        {submittingVerification&&detail?.disposition.id===process.id&&<>
          <p className="notice">
            Unggah berkas pembayaran sesuai jenisnya di bawah. Setelah itu isi ringkasan pemeriksaan dan unggah bukti verifikasi
            seperti berita acara atau bukti barang diterima. Hasil dikirim ke Manager untuk diperiksa.
          </p>
          {detail.paymentDocuments&&<PaymentDocumentsPanel id={detail.disposition.letter_id}
            data={detail.paymentDocuments} attachments={sourceAttachments} onSaved={()=>refreshDetail(process.id)}/>}
        </>}
        <form className="form-grid workflow-form" onSubmit={submitProcess}>
          {error&&<div className="field full error" role="alert">{error}</div>}
          {process.reassignment&&<div className="field full notice">
            Tugas akan dikirim kembali ke <b>{process.reassignment.pic}</b>. Masukkan instruksi yang sudah diperjelas.
          </div>}
          <div className="field full">
            <label htmlFor="disposition-process-note">
              {process.reassignment?"Instruksi tindak lanjut (wajib)":submittingVerification?"Ringkasan pemeriksaan (wajib)":
                process.requiredNote?"Catatan / Hasil (wajib)":"Catatan Proses (opsional)"}
            </label>

            <textarea
              className="textarea"
              id="disposition-process-note"
              name="note"
              defaultValue={process.reassignment?.instruction}
              maxLength={5000}
              required={process.requiredNote}
              placeholder={
                submittingVerification?"Contoh: Jumlah ATK dan penerimaan sesuai invoice."
                :process.action==="SUBMIT_RESULT"
                  ?"Tuliskan ringkasan hasil tindak lanjut..."
                  :process.action==="RETURN_RESULT"
                    ?"Jelaskan bagian hasil yang perlu diperbaiki..."
                    :process.action==="RETURN_TASK"
                      ?"Jelaskan alasan disposisi dikembalikan..."
                      :"Catatan review..."
              }
            />
          </div>

          {process.reassignment&&<>
            <label className="field"><span>Tanggal target selesai (opsional)</span>
              <input className="input" type="date" name="due_date" defaultValue={process.reassignment.dueDate}/>
            </label>
            <label className="field"><span>Jam target selesai WIB (opsional)</span>
              <input className="input" type="time" name="due_time" defaultValue={process.reassignment.dueTime}/>
            </label>
          </>}

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
            <label htmlFor="disposition-process-files">
              {submittingVerification?"Bukti verifikasi":"Lampiran Proses"} <span className="muted">
              ({process.action==="SUBMIT_RESULT"&&process.resultRequirement==="ATTACHMENT"?"wajib":"opsional"}, maksimal 5 file)
            </span></label>
            <input
              className="input"
              id="disposition-process-files"
              type="file"
              multiple
              required={process.action==="SUBMIT_RESULT"&&process.resultRequirement==="ATTACHMENT"}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv"
              onChange={e=>setProcessFiles(Array.from(e.target.files||[]).slice(0,5))}
            />
          </div>

          {detail?.disposition.id===process.id&&detail.payments?.length>0&&["APPROVE_RESULT","RETURN_RESULT"].includes(process.action)&&
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
