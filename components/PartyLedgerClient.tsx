"use client";
import { FormEvent,useEffect,useMemo,useState } from "react";
import type { SessionUser } from "@/lib/types";
import Modal from "@/components/Modal";
import StatusBadge from "@/components/StatusBadge";
import FinanceAttachmentsPanel from "@/components/FinanceAttachmentsPanel";
import CurrencyInput from "@/components/CurrencyInput";
import { useAppDialog } from "@/components/AppDialogProvider";

const rupiah=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n)||0);
const bucket=(days:number)=>days<=30?"1-30":days<=60?"30-60":days<=90?"60-90":"90+";
const today=()=>new Date().toISOString().slice(0,10);
const dt=(v:any)=>v?new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"Belum ada";

type Kind="receivables"|"payables";
type Mode="SUMMARY"|"DETAIL";
type Metric="OUTSTANDING"|"DUE_30"|"AGING_1_30"|"AGING_30_60"|"AGING_60_90"|"AGING_90_PLUS";
type AdjustType="INCREASE"|"DECREASE"|"SET_TOTAL";
type AdjustmentDraft={metric:Metric;adjustment_type:AdjustType;amount:string;data_date:string;note:string}|null;

const metricLabel:Record<Metric,string>={
  OUTSTANDING:"Total Outstanding",DUE_30:"Jatuh Tempo ≤30 Hari",AGING_1_30:"Aging 1-30",AGING_30_60:"Aging 30-60",AGING_60_90:"Aging 60-90",AGING_90_PLUS:"Aging 90+"
};
const adjLabel=(v:string)=>v==="INCREASE"?"Tambah":v==="DECREASE"?"Kurangi":v==="SET_TOTAL"?"Set Total":"Reversal";

export default function PartyLedgerClient({kind,user}:{kind:Kind;user:SessionUser}){
  const dialog=useAppDialog();
  const receivable=kind==="receivables";
  const label=receivable?"Piutang":"Utang";
  const partyLabel=receivable?"Pelanggan":"Vendor";
  const canEdit=["ROOT_ADMIN","FINANCE"].includes(user.role);

  const [rows,setRows]=useState<any[]>([]);
  const [position,setPosition]=useState<any>(null);
  const [open,setOpen]=useState(false);
  const [editTarget,setEditTarget]=useState<any|null>(null);
  const [attachmentTarget,setAttachmentTarget]=useState<any|null>(null);
  const [adjust,setAdjust]=useState<AdjustmentDraft>(null);
  const [attachAdjustment,setAttachAdjustment]=useState<any|null>(null);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [summaryForm,setSummaryForm]=useState({
    as_of_date:today(),outstanding_amount:"0",due_30_amount:"0",due_30_count:"0",
    aging_1_30_amount:"0",aging_30_60_amount:"0",aging_60_90_amount:"0",aging_90_plus_amount:"0",notes:""
  });

  async function load(){
    setError("");
    const [listR,posR]=await Promise.all([
      fetch(`/api/finance/${kind}`,{cache:"no-store"}),
      fetch(`/api/finance/positions/${kind}`,{cache:"no-store"})
    ]);
    const [listJ,posJ]=await Promise.all([listR.json(),posR.json()]);
    if(!listR.ok){setError(listJ.error||`Gagal memuat ${label.toLowerCase()}.`);return;}
    if(!posR.ok){setError(posJ.error||"Gagal memuat posisi keuangan.");return;}
    setRows(listJ.data||[]);setPosition(posJ.data);
    const s=posJ.data?.summary||{};
    setSummaryForm({
      as_of_date:String(s.as_of_date||today()).slice(0,10),outstanding_amount:String(s.outstanding_amount||0),due_30_amount:String(s.due_30_amount||0),due_30_count:String(s.due_30_count||0),
      aging_1_30_amount:String(s.aging_1_30_amount||0),aging_30_60_amount:String(s.aging_30_60_amount||0),aging_60_90_amount:String(s.aging_60_90_amount||0),aging_90_plus_amount:String(s.aging_90_plus_amount||0),notes:String(s.notes||"")
    });
  }
  useEffect(()=>{load()},[kind]);

  const mode:Mode=position?.mode==="DETAIL"?"DETAIL":"SUMMARY";
  const active=position?.active||{};
  const adjustments=position?.adjustments||[];
  const agingTotal=useMemo(()=>Number(summaryForm.aging_1_30_amount||0)+Number(summaryForm.aging_30_60_amount||0)+Number(summaryForm.aging_60_90_amount||0)+Number(summaryForm.aging_90_plus_amount||0),[summaryForm]);

  const currentMetric=(metric:Metric)=>({
    OUTSTANDING:Number(active.outstanding_amount||0),DUE_30:Number(active.due_30_amount||0),AGING_1_30:Number(active.aging_1_30_amount||0),AGING_30_60:Number(active.aging_30_60_amount||0),AGING_60_90:Number(active.aging_60_90_amount||0),AGING_90_PLUS:Number(active.aging_90_plus_amount||0)
  })[metric];
  const preview=useMemo(()=>{
    if(!adjust)return {before:0,after:0,delta:0};
    const before=currentMetric(adjust.metric),amount=Number(adjust.amount||0);
    let after=before;if(adjust.adjustment_type==="INCREASE")after=before+amount;if(adjust.adjustment_type==="DECREASE")after=before-amount;if(adjust.adjustment_type==="SET_TOTAL")after=amount;
    return {before,after,delta:after-before};
  },[adjust,active]);

  function openAdjust(metric:Metric,type:AdjustType){setAdjust({metric,adjustment_type:type,amount:"",data_date:String(active.as_of_date||today()).slice(0,10),note:""});}

  async function saveAdjustment(){
    if(!adjust)return;const draft=adjust;setBusy(true);setError("");setMessage("");
    try{
      const r=await fetch("/api/finance/position-adjustments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,...draft})});
      const j=await r.json();if(!r.ok)throw new Error(j.error||"Gagal menyimpan penyesuaian.");
      setAdjust(null);setMessage(`${metricLabel[draft.metric]} ${label.toLowerCase()} berhasil diperbarui. Riwayat dan Audit Log tersimpan.`);await load();
    }catch(e){setError(e instanceof Error?e.message:"Gagal menyimpan penyesuaian.");}finally{setBusy(false)}
  }
  async function reverseAdjustment(a:any){
    const reason=await dialog.prompt({title:`Reverse Penyesuaian ${label}`,message:"Nilai akan dikoreksi dengan transaksi reversal. Riwayat awal tidak dihapus.",label:"Alasan reversal",placeholder:"Contoh: salah nominal / data sudah masuk dua kali.",required:true,multiline:true,confirmLabel:"Reverse",tone:"danger"});if(!reason?.trim())return;
    setBusy(true);setError("");setMessage("");
    try{const r=await fetch(`/api/finance/position-adjustments/${a.id}/reverse`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({note:reason.trim()})});const j=await r.json();if(!r.ok)throw new Error(j.error||"Gagal melakukan reversal.");setMessage("Penyesuaian dibatalkan dengan reversal. Riwayat lama tetap tersimpan.");await load();}
    catch(e){setError(e instanceof Error?e.message:"Gagal melakukan reversal.");}finally{setBusy(false)}
  }

  async function changeMode(next:Mode){if(next===mode||busy)return;setBusy(true);setError("");setMessage("");try{const r=await fetch(`/api/finance/positions/${kind}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:next})});const j=await r.json();if(!r.ok)throw new Error(j.error||"Gagal mengubah mode.");setMessage(next==="SUMMARY"?`${label} menggunakan Ringkasan Cepat.`:`${label} menggunakan Detail Invoice.`);await load();}catch(e){setError(e instanceof Error?e.message:"Gagal mengubah mode.");}finally{setBusy(false)}}
  async function saveSummary(){setBusy(true);setError("");setMessage("");try{const r=await fetch(`/api/finance/positions/${kind}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(summaryForm)});const j=await r.json();if(!r.ok)throw new Error(j.error||"Gagal menyimpan posisi.");setMessage(`Posisi ${label.toLowerCase()} berhasil diperbarui.`);await load();}catch(e){setError(e instanceof Error?e.message:"Gagal menyimpan posisi.");}finally{setBusy(false)}}
  async function create(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError("");setMessage("");try{const fd=new FormData(e.currentTarget);const r=await fetch(`/api/finance/${kind}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(fd.entries()))});const j=await r.json();if(!r.ok)throw new Error(j.error||"Gagal menambah data.");setOpen(false);setMessage(`${label} berhasil ditambahkan.`);await load();}catch(e){setError(e instanceof Error?e.message:"Gagal menambah data.");}finally{setBusy(false)}}
  async function update(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!editTarget)return;setBusy(true);setError("");setMessage("");try{const fd=new FormData(e.currentTarget);const r=await fetch(`/api/finance/${kind}/${editTarget.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(fd.entries()))});const j=await r.json();if(!r.ok)throw new Error(j.error||"Gagal mengubah data.");setEditTarget(null);setMessage(`${label} berhasil diperbarui.`);await load();}catch(e){setError(e instanceof Error?e.message:"Gagal mengubah data.");}finally{setBusy(false)}}

  const activeAging:[[string,Metric,number],[string,Metric,number],[string,Metric,number],[string,Metric,number]]=[
    ["1-30","AGING_1_30",Number(active.aging_1_30_amount||0)],["30-60","AGING_30_60",Number(active.aging_30_60_amount||0)],["60-90","AGING_60_90",Number(active.aging_60_90_amount||0)],["90+","AGING_90_PLUS",Number(active.aging_90_plus_amount||0)]
  ];
  const QuickActions=({metric}:{metric:Metric})=>canEdit&&mode==="SUMMARY"?<div className="mini-actions"><button className="btn btn-mini" onClick={()=>openAdjust(metric,"INCREASE")}>+ Tambah</button><button className="btn btn-mini" onClick={()=>openAdjust(metric,"DECREASE")}>− Kurangi</button><button className="btn btn-mini" onClick={()=>openAdjust(metric,"SET_TOTAL")}>Set Total</button></div>:null;

  return <main className="page">
    <div className="page-head"><div><h2>{label}</h2><p>{receivable?"Posisi tagihan pelanggan, aging, jatuh tempo, dan dokumen pendukung.":"Posisi kewajiban vendor, aging, jatuh tempo, dan dokumen pendukung."}</p></div>{canEdit&&mode==="DETAIL"&&<button className="btn btn-primary" onClick={()=>setOpen(true)}>+ Tambah {label}</button>}</div>
    {message&&<div className="success" style={{marginBottom:12}}>{message}</div>}{error&&<div className="error" style={{marginBottom:12}}>{error}</div>}

    {canEdit&&<section className="finance-source-card"><div className="finance-source-copy"><b>Pengelolaan Data {label}</b><p><b>Ringkasan Cepat</b> untuk angka posisi/manual. <b>Detail Invoice</b> untuk perhitungan dari invoice. Ganti mode tidak menghapus data.</p></div><div className="segment-control"><button className={mode==="SUMMARY"?"active":""} onClick={()=>changeMode("SUMMARY")} disabled={busy}><span>Ringkasan Cepat</span><small>Manual + tambah/kurang</small></button><button className={mode==="DETAIL"?"active":""} onClick={()=>changeMode("DETAIL")} disabled={busy}><span>Detail Invoice</span><small>Hitung dari invoice</small></button></div></section>}

    {canEdit&&mode==="SUMMARY"&&<div className="finance-help-compact"><b>Cara cepat:</b><span>1. Pakai <b>+ Tambah / − Kurangi</b> untuk update harian.</span><span>2. Pakai <b>Set Total</b> bila menerima angka posisi terbaru.</span><span>3. Semua perubahan, reversal, upload, dan hapus dokumen tetap tercatat.</span></div>}

    <div className="stats finance-position-stats">
      <div className="stat"><div className="stat-label">Total Outstanding</div><div className="stat-value">{rupiah(Number(active.outstanding_amount||0))}</div><div className="stat-sub">Posisi per {String(active.as_of_date||today()).slice(0,10)}</div><QuickActions metric="OUTSTANDING"/></div>
      <div className="stat"><div className="stat-label">Sudah Lewat Jatuh Tempo</div><div className="stat-value">{rupiah(Number(active.overdue_amount||0))}</div><div className="stat-sub" style={{color:"var(--red)"}}>Otomatis dari total aging</div></div>
      <div className="stat"><div className="stat-label">Jatuh Tempo ≤30 Hari</div><div className="stat-value">{rupiah(Number(active.due_30_amount||0))}</div><div className="stat-sub">{Number(active.due_30_count||0)} item mendekati jatuh tempo</div><QuickActions metric="DUE_30"/></div>
      <div className="stat"><div className="stat-label">Update Terakhir</div><div className="stat-value" style={{fontSize:17}}>{dt(active.updated_at)}</div><div className="stat-sub">{active.updated_by_name?`oleh ${active.updated_by_name}`:"Posisi terbaru"}</div></div>
    </div>

    <section className="card" style={{marginBottom:16}}><div className="card-head"><div><h3>Aging {label}</h3><p>Outstanding yang sudah melewati jatuh tempo.</p></div></div><div className="card-body"><div className="grid-4">{activeAging.map(([b,m,v])=><div className="stat aging-stat" key={b}><div className="stat-label">{b} hari</div><div className="stat-value" style={{fontSize:19}}>{rupiah(v)}</div><QuickActions metric={m}/></div>)}</div></div></section>

    {mode==="SUMMARY"&&<>
      {canEdit&&<details className="card finance-details-card" style={{marginBottom:16}}><summary><b>Edit Posisi Lengkap</b><span>Gunakan bila perlu mengubah beberapa angka sekaligus, jumlah item, tanggal posisi, atau catatan.</span></summary><div className="card-body"><div className="finance-position-form"><div className="field"><label>Posisi per Tanggal</label><input className="input" type="date" value={summaryForm.as_of_date} onChange={e=>setSummaryForm(f=>({...f,as_of_date:e.target.value}))}/></div><div className="field"><label>Total Outstanding</label><CurrencyInput value={summaryForm.outstanding_amount} onValueChange={value=>setSummaryForm(f=>({...f,outstanding_amount:value}))}/> </div><div className="field"><label>Jatuh Tempo ≤30 Hari</label><CurrencyInput value={summaryForm.due_30_amount} onValueChange={value=>setSummaryForm(f=>({...f,due_30_amount:value}))}/> </div><div className="field"><label>Jumlah Item ≤30 Hari</label><input className="input" type="number" min="0" value={summaryForm.due_30_count} onChange={e=>setSummaryForm(f=>({...f,due_30_count:e.target.value}))}/></div></div><div className="finance-aging-edit"><div className="field"><label>Aging 1-30</label><CurrencyInput value={summaryForm.aging_1_30_amount} onValueChange={value=>setSummaryForm(f=>({...f,aging_1_30_amount:value}))}/> </div><div className="field"><label>Aging 30-60</label><CurrencyInput value={summaryForm.aging_30_60_amount} onValueChange={value=>setSummaryForm(f=>({...f,aging_30_60_amount:value}))}/> </div><div className="field"><label>Aging 60-90</label><CurrencyInput value={summaryForm.aging_60_90_amount} onValueChange={value=>setSummaryForm(f=>({...f,aging_60_90_amount:value}))}/> </div><div className="field"><label>Aging 90+</label><CurrencyInput value={summaryForm.aging_90_plus_amount} onValueChange={value=>setSummaryForm(f=>({...f,aging_90_plus_amount:value}))}/> </div></div><div className="finance-overdue-preview"><span>Total overdue dari aging</span><b>{rupiah(agingTotal)}</b></div><div className="field" style={{marginTop:12}}><label>Catatan</label><textarea className="textarea" value={summaryForm.notes} onChange={e=>setSummaryForm(f=>({...f,notes:e.target.value}))}/></div><div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}><button className="btn btn-primary" onClick={saveSummary} disabled={busy}>{busy?"Menyimpan...":"Simpan Posisi Lengkap"}</button></div></div></details>}
      {!canEdit&&active.notes&&<section className="card" style={{marginBottom:16}}><div className="card-head"><div><h3>Catatan Posisi</h3></div></div><div className="card-body"><div className="note-box">{active.notes}</div></div></section>}
      {canEdit&&<section className="card finance-history-card" style={{marginBottom:16}}><div className="card-head"><div><h3>Riwayat Perubahan {label}</h3><p>Tambah, kurang, set total, dan reversal tidak menghilangkan jejak lama.</p></div></div><div className="table-wrap"><table className="table"><thead><tr><th>Waktu</th><th>Data per</th><th>Bagian</th><th>Aksi</th><th>Nominal</th><th>Sebelum → Sesudah</th><th>Keterangan</th><th>Oleh</th><th>Aksi</th></tr></thead><tbody>{adjustments.map((a:any)=><tr key={a.id}><td className="nowrap">{dt(a.created_at)}</td><td>{String(a.data_date||"").slice(0,10)}</td><td><b>{metricLabel[a.metric as Metric]||a.metric}</b></td><td><span className={`badge ${a.adjustment_type==="INCREASE"?"green":a.adjustment_type==="DECREASE"||a.adjustment_type==="REVERSAL"?"orange":"blue"}`}>{adjLabel(a.adjustment_type)}</span>{a.status==="REVERSED"&&<span className="badge gray" style={{marginLeft:5}}>REVERSED</span>}</td><td>{rupiah(a.amount)}</td><td className="nowrap">{rupiah(a.value_before)} → <b>{rupiah(a.value_after)}</b></td><td>{a.note||"-"}</td><td>{a.created_by_name||"-"}</td><td><div className="row-actions"><button className="btn btn-secondary" onClick={()=>setAttachAdjustment(a)}>Lampiran {a.attachment_count?`(${a.attachment_count})`:""}</button>{a.status==="ACTIVE"&&a.adjustment_type!=="REVERSAL"&&<button className="btn btn-danger" disabled={busy} onClick={()=>reverseAdjustment(a)}>Reverse</button>}</div></td></tr>)}{!adjustments.length&&<tr><td colSpan={9}><div className="empty">Belum ada riwayat penyesuaian.</div></td></tr>}</tbody></table></div></section>}
      <section className="card"><div className="card-body"><FinanceAttachmentsPanel entityType="LEDGER_SUMMARY" entityId={position?.summary?.id||null} ledgerKind={kind} canEdit={canEdit} title={`Dokumen Pendukung ${label}`}/></div></section>
    </>}

    {mode==="DETAIL"&&<><div className="card"><div className="table-wrap"><table className="table"><thead><tr><th>{partyLabel}</th><th>Invoice</th><th>Tanggal</th><th>Jatuh Tempo</th><th>Total</th><th>Terbayar</th><th>Outstanding</th><th>Aging</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><b>{r.counterparty}</b></td><td className="mono">{r.invoice_no}</td><td>{String(r.invoice_date).slice(0,10)}</td><td>{String(r.due_date).slice(0,10)}</td><td>{rupiah(Number(r.amount))}</td><td>{rupiah(Number(r.paid_amount))}</td><td><b>{rupiah(Number(r.outstanding))}</b></td><td>{Number(r.overdue_days)>0?bucket(Number(r.overdue_days)):"Belum jatuh tempo"}</td><td><StatusBadge status={Number(r.overdue_days)>0&&r.status!=="PAID"?"OVERDUE":r.status}/></td><td><div className="row-actions"><button className="btn btn-secondary" onClick={()=>setAttachmentTarget(r)}>Lampiran</button>{canEdit&&<button className="btn btn-secondary" onClick={()=>setEditTarget(r)}>Edit</button>}{user.role==="ROOT_ADMIN"&&<button className="btn btn-danger" onClick={async()=>{const ok=await dialog.confirm({title:`Hapus ${label}`,message:`Invoice ${r.invoice_no} akan dihapus dari detail ${label.toLowerCase()}.`,detail:"Audit Log penghapusan tetap disimpan.",confirmLabel:"Hapus",tone:"danger"});if(!ok)return;const rr=await fetch(`/api/finance/${kind}/${r.id}`,{method:"DELETE"});const jj=await rr.json();if(!rr.ok){setError(jj.error);return}setMessage("Invoice dihapus.");await load()}}>Hapus</button>}</div></td></tr>)}{!rows.length&&<tr><td colSpan={10}><div className="empty">Belum ada detail invoice.</div></td></tr>}</tbody></table></div></div><div className="notice" style={{marginTop:12}}>Mode Detail Invoice menghitung posisi otomatis dari invoice. Gunakan Ringkasan Cepat jika Finance ingin mengelola angka posisi secara manual.</div></>}

    {adjust&&<Modal title={`${adjLabel(adjust.adjustment_type)} ${metricLabel[adjust.metric]} — ${label}`} subtitle="Ringkas untuk update harian; seluruh perubahan tetap tercatat." onClose={()=>!busy&&setAdjust(null)}><div className="form-grid"><div className="field"><label>{adjust.adjustment_type==="SET_TOTAL"?"Nilai Total Baru":"Nominal"}</label><CurrencyInput autoFocus value={adjust.amount} onValueChange={value=>setAdjust(a=>a?({...a,amount:value}):a)}/> </div><div className="field"><label>Data per Tanggal</label><input className="input" type="date" value={adjust.data_date} onChange={e=>setAdjust(a=>a?({...a,data_date:e.target.value}):a)}/></div><div className="field full"><label>Keterangan *</label><textarea className="textarea" value={adjust.note} onChange={e=>setAdjust(a=>a?({...a,note:e.target.value}):a)} placeholder="Contoh: update posisi berdasarkan rekap Finance hari ini."/></div></div><div className="adjust-preview"><div><span>Sebelum</span><b>{rupiah(preview.before)}</b></div><div><span>Perubahan</span><b>{preview.delta>=0?"+ ":"− "}{rupiah(Math.abs(preview.delta))}</b></div><div><span>Sesudah</span><b>{rupiah(preview.after)}</b></div></div><div className="modal-actions"><button className="btn btn-secondary" onClick={()=>setAdjust(null)} disabled={busy}>Batal</button><button className="btn btn-primary" onClick={saveAdjustment} disabled={busy||!adjust.note.trim()||Number(adjust.amount)<0}>{busy?"Menyimpan...":"Simpan"}</button></div></Modal>}
    {attachAdjustment&&<Modal title={`Lampiran Perubahan ${label}`} subtitle={`${adjLabel(attachAdjustment.adjustment_type)} • ${metricLabel[attachAdjustment.metric as Metric]||attachAdjustment.metric} • ${rupiah(attachAdjustment.amount)}`} onClose={()=>{setAttachAdjustment(null);load()}}><FinanceAttachmentsPanel entityType="POSITION_ADJUSTMENT" entityId={attachAdjustment.id} canEdit={canEdit} title="Bukti / Dokumen Pendukung"/></Modal>}
    {attachmentTarget&&<Modal title={`Lampiran ${label} — ${attachmentTarget.invoice_no}`} subtitle="Invoice, bukti pembayaran, follow-up, atau dokumen pendukung." onClose={()=>setAttachmentTarget(null)}><FinanceAttachmentsPanel entityType={receivable?"RECEIVABLE":"PAYABLE"} entityId={attachmentTarget.id} canEdit={canEdit} title="Dokumen Pendukung"/></Modal>}
    {open&&<Modal title={`Tambah ${label}`} subtitle="Jatuh tempo dan aging dihitung otomatis dari detail invoice." onClose={()=>setOpen(false)}><InvoiceForm partyLabel={partyLabel} onSubmit={create} busy={busy}/></Modal>}
    {editTarget&&<Modal title={`Edit ${label} — ${editTarget.invoice_no}`} subtitle="Perubahan memperbarui outstanding dan aging pada mode Detail Invoice." onClose={()=>setEditTarget(null)}><InvoiceForm partyLabel={partyLabel} onSubmit={update} busy={busy} row={editTarget}/></Modal>}
  </main>;
}

function InvoiceForm({partyLabel,onSubmit,busy,row}:{partyLabel:string;onSubmit:(e:FormEvent<HTMLFormElement>)=>void;busy:boolean;row?:any}){
  return <form className="form-grid" onSubmit={onSubmit}><div className="field"><label>{partyLabel}</label><input className="input" name="counterparty" required defaultValue={row?.counterparty||""}/></div><div className="field"><label>No. Invoice</label><input className="input" name="invoice_no" required defaultValue={row?.invoice_no||""}/></div><div className="field"><label>Tanggal Invoice</label><input className="input" type="date" name="invoice_date" required defaultValue={row?String(row.invoice_date).slice(0,10):""}/></div><div className="field"><label>Jatuh Tempo</label><input className="input" type="date" name="due_date" required defaultValue={row?String(row.due_date).slice(0,10):""}/></div><div className="field"><label>Total</label><CurrencyInput name="amount" required defaultValue={row?.amount??""}/> </div><div className="field"><label>Sudah Dibayar</label><CurrencyInput name="paid_amount" defaultValue={row?.paid_amount??"0"}/> </div><div className="field full"><label>Catatan</label><textarea className="textarea" name="notes" defaultValue={row?.notes||""}/></div><div className="field full" style={{display:"flex",flexDirection:"row",justifyContent:"flex-end",gap:8}}><button className="btn btn-primary" disabled={busy}>{busy?"Menyimpan...":"Simpan"}</button></div></form>;
}
