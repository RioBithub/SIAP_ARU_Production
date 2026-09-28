"use client";

import { FormEvent,useEffect,useMemo,useState } from "react";
import type { SessionUser } from "@/lib/types";
import Modal from "@/components/Modal";
import StatusBadge from "@/components/StatusBadge";

const size=(n:number)=>
  n<1024*1024
    ? `${Math.max(1,Math.round(n/1024))} KB`
    : `${(n/1024/1024).toFixed(2)} MB`;

const actionLabel=(a:string)=>({
  CREATE:"Disposisi dibuat",
  SEEN:"Dilihat",
  START:"Mulai ditindaklanjuti",
  SUBMIT_RESULT:"Hasil dikirim",
  APPROVE_RESULT:"Hasil disetujui",
  RETURN_RESULT:"Hasil dikembalikan",
  RETURN_TASK:"Disposisi dikembalikan"
}[a]||a.replace(/_/g," "));

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
  tone?:"primary"|"success"|"danger";
};

function allowedTargetRoles(role:string){
  if(role==="PRESIDENT_DIRECTOR") return ["DIRECTOR_OPS","MANAGER","FINANCE","STAFF"];
  if(role==="DIRECTOR_OPS") return ["MANAGER","FINANCE","STAFF"];
  if(role==="MANAGER") return ["FINANCE","STAFF"];
  if(role==="ROOT_ADMIN") return ["PRESIDENT_DIRECTOR","DIRECTOR_OPS","MANAGER","FINANCE","STAFF"];
  return [];
}

function canDisposeLetter(l:any){
  if(l.direction==="OUTGOING") return l.status==="ISSUED";
  return ["APPROVED","DISPOSED","IN_PROGRESS","COMPLETED"].includes(l.status);
}

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

export default function DispositionsClient({user}:{user:SessionUser}){
  const [rows,setRows]=useState<any[]>([]);
  const [users,setUsers]=useState<any[]>([]);
  const [letters,setLetters]=useState<any[]>([]);
  const [selectedLetterId,setSelectedLetterId]=useState("");
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

      const [dr,ur,lr]=await Promise.all([
        fetch("/api/dispositions",{cache:"no-store"}),
        fetch("/api/users/lookup",{cache:"no-store"}),
        fetch("/api/letters?limit=500",{cache:"no-store"})
      ]);

      const [d,u,l]=await Promise.all([dr.json(),ur.json(),lr.json()]);

      if(d.ok) setRows(d.data); else setError(d.error||"Gagal memuat disposisi.");
      if(u.ok) setUsers(u.data);
      if(l.ok) setLetters(l.data);

    }catch(e){
      setError(e instanceof Error?e.message:"Gagal memuat data disposisi.");
    }
  }

  useEffect(()=>{
    const prefill=new URLSearchParams(window.location.search).get("letter_id")||"";
    if(prefill){
      setSelectedLetterId(prefill);
      setOpen(true);
    }
    void load();
  },[]);

  const filtered=useMemo(()=>rows.filter(d=>{
    const hay=[
      d.subject,d.letter_number,d.external_number,d.instruction,
      d.from_name,d.to_name,d.current_owner_name
    ].join(" ").toLowerCase();

    return (!q||hay.includes(q.toLowerCase()))&&(!status||d.status===status);
  }),[rows,q,status]);

  const targetUsers=useMemo(()=>{
    const allowed=allowedTargetRoles(user.role);
    return users.filter(u=>u.id!==user.id && allowed.includes(u.role));
  },[users,user.id,user.role]);

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
    setProcess({id:d.id,action,label,requiredNote,tone});
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

    if(!owns) return null;

    const out:any[]=[];

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

    if(["REVIEW_MANAGER","REVIEW_DIROPS","REVIEW_DIRUT"].includes(d.status)){
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
          Return
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
        <button className="btn btn-primary" onClick={()=>{setOpen(true);setCreateFiles([])}}>
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
                <td><StatusBadge status={d.status}/></td>
                <td>{d.due_date?String(d.due_date).slice(0,10):"-"}</td>

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
                <td colSpan={8}>
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
        subtitle="Disposisi dibuat dari dokumen yang sudah selesai approval."
        onClose={()=>!createBusy&&setOpen(false)}
      >
        <form onSubmit={create} className="form-grid">

          <div className="field full">
            <label>Dokumen</label>
            <select
              className="select"
              name="letter_id"
              required
              value={selectedLetterId}
              onChange={e=>setSelectedLetterId(e.target.value)}
            >
              <option value="">Pilih dokumen...</option>

              {letters.filter(canDisposeLetter).map(l=>
                <option value={l.id} key={l.id}>
                  {l.direction==="INCOMING"
                    ?"Surat Masuk"
                    :l.direction==="INTERNAL"
                      ?"Nota Dinas"
                      :"Surat Keluar"} — {l.display_number||l.letter_number||l.external_number||"-"} — {l.subject}
                </option>
              )}
            </select>

            <span className="hint">
              Surat masuk/Nota Dinas: setelah APPROVED. Surat keluar: setelah ISSUED.
            </span>
          </div>

          <div className="field">
            <label>Diteruskan Kepada</label>
            <select className="select" name="to_user_id" required>
              <option value="">Pilih PIC...</option>
              {targetUsers.map(u=>
                <option key={u.id} value={u.id}>
                  {u.name} — {u.unit_name||u.role}
                </option>
              )}
            </select>
          </div>

          <div className="field">
            <label>Visibility</label>
            <select className="select" name="visibility" defaultValue="ROUTE">
              <option value="PUBLIC">PUBLIC — semua user persuratan</option>
              <option value="ROUTE">ROUTE — pihak dalam jalur</option>
              <option value="PRIVATE">PRIVATE — pihak terkait</option>
            </select>
          </div>

          <div className="field">
            <label>Prioritas</label>
            <select className="select" name="priority" defaultValue="NORMAL">
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>

          <div className="field">
            <label>Target Selesai</label>
            <input className="input" type="date" name="due_date"/>
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
                <span>Posisi Saat Ini</span>
                <b>{detail.disposition.current_owner_name||detail.disposition.to_name}</b>
              </div>

              <div className="kpi-row">
                <span>PIC Awal</span>
                <b>{detail.disposition.to_name}</b>
              </div>

              <div className="kpi-row">
                <span>Prioritas</span>
                <b>{detail.disposition.priority}</b>
              </div>

              <div className="kpi-row">
                <span>Deadline</span>
                <b>{detail.disposition.due_date?String(detail.disposition.due_date).slice(0,10):"-"}</b>
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
            </div>

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

                    <a className="btn btn-secondary" href={`/api/attachments/${a.id}`} download>
                      ↓ Unduh
                    </a>
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
            <h3 style={{fontSize:13}}>Riwayat Proses</h3>
            <p className="muted" style={{fontSize:11}}>
              Seluruh Seen, Mulai, Kirim Hasil, Review, Return, catatan, dan lampiran proses tercatat.
            </p>

            <div className="timeline">
              {detail.actions?.map((a:any,i:number)=>{
                const af=processAttachments(a.id);

                return <div className="timeline-row" key={a.id}>
                  <div className="timeline-dot">{i+1}</div>

                  <div style={{width:"100%"}}>
                    <b>{actionLabel(a.action)} • {a.actor_name}</b>
                    <p>
                      {a.from_status?`${a.from_status} → ${a.to_status}`:a.to_status}
                      {a.note?` • ${a.note}`:""}
                    </p>

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

                            <a className="btn btn-secondary" href={`/api/attachments/${f.id}`} download>
                              ↓ Unduh
                            </a>
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
        <form className="form-grid" onSubmit={submitProcess}>
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

          <div className="field full">
            <label>Lampiran Proses <span className="muted">(opsional, maksimal 5 file)</span></label>
            <input
              className="input"
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv"
              onChange={e=>setProcessFiles(Array.from(e.target.files||[]).slice(0,5))}
            />
          </div>

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
