"use client";
import { useEffect,useMemo,useState } from "react";
import type { SessionUser } from "@/lib/types";
import FinanceAttachmentsPanel from "@/components/FinanceAttachmentsPanel";
import Modal from "@/components/Modal";
import CurrencyInput from "@/components/CurrencyInput";
import { useAppDialog } from "@/components/AppDialogProvider";

const rupiah=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n)||0);
const currentMonth=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`};
const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
function monthShort(v:string){const d=new Date(`${String(v).slice(0,7)}-01T00:00:00`);return new Intl.DateTimeFormat("id-ID",{month:"short"}).format(d)}
function monthLong(v:string){const [y,m]=String(v).slice(0,7).split("-").map(Number);return new Intl.DateTimeFormat("id-ID",{month:"long",year:"numeric"}).format(new Date(y,m-1,1))}
function dateLabel(v?:string|null){if(!v)return "Belum ditentukan";return new Intl.DateTimeFormat("id-ID",{day:"numeric",month:"long",year:"numeric"}).format(new Date(`${String(v).slice(0,10)}T00:00:00`))}
function dateTimeLabel(v?:string|null){if(!v)return "Belum ada";return new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v))}
function updateLabel(v?:string|null){if(!v)return "Belum pernah diperbarui";const d=new Date(v),n=new Date();return d.toDateString()===n.toDateString()?`Diperbarui hari ini, ${d.toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})} WIB`:`Diperbarui ${dateTimeLabel(v)}`}
function modeLabel(v:string){return v==="MANUAL"?"Posisi YTD Manual":v==="AUTO_MONTHLY"?"Otomatis dari Bulanan":v==="HYBRID"?"Basis Posisi + Bulanan Terpilih":"Belum dikonfigurasi"}
function metricLabel(v:string){return v==="REVENUE"?"Pendapatan":v==="EXPENSE"?"Biaya":"Anggaran"}
function adjLabel(v:string){return v==="INCREASE"?"Tambah":v==="DECREASE"?"Kurangi":v==="SET_TOTAL"?"Set Total":"Reversal"}
const MONTHS=["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

type AdjustmentDraft={metric:"REVENUE"|"EXPENSE"|"BUDGET";adjustment_type:"INCREASE"|"DECREASE"|"SET_TOTAL";amount:string;data_date:string;note:string}|null;

export default function FinanceDashboardClient({user}:{user:SessionUser}){
  const dialog=useAppDialog();
  const canEdit=["ROOT_ADMIN","FINANCE"].includes(user.role);
  const [month,setMonth]=useState(currentMonth());
  const [data,setData]=useState<any>(null);
  const [meta,setMeta]=useState({data_date:localToday(),include_in_ytd:false,publish_status:"DRAFT",notes:""});
  const [error,setError]=useState(""); const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  const [adjust,setAdjust]=useState<AdjustmentDraft>(null);
  const [yearModal,setYearModal]=useState(false);
  const [yearForm,setYearForm]=useState({calculation_mode:"HYBRID",base_through_month:"0",base_income_amount:"0",base_expense_amount:"0",annual_budget_amount:"0",as_of_date:localToday(),notes:"",publish_status:"PUBLISHED"});
  const [showGuide,setShowGuide]=useState(true);
  const [attachAdjustment,setAttachAdjustment]=useState<any>(null);

  async function load(){
    setError("");
    const r=await fetch(`/api/finance/summary?month=${month}`,{cache:"no-store"});
    const j=await r.json();
    if(!r.ok){setError(j.error||"Gagal memuat data keuangan.");return;}
    setData(j.data);
    const s=j.data.summary||{};
    setMeta({data_date:String(s.data_date||localToday()).slice(0,10),include_in_ytd:Boolean(s.include_in_ytd),publish_status:String(s.publish_status||"DRAFT"),notes:String(s.notes||"")});
    const y=j.data.ytd||{};
    setYearForm({
      calculation_mode:String(y.mode&&y.mode!=="UNCONFIGURED"?y.mode:"HYBRID"),
      base_through_month:String(y.base_through_month??0),
      base_income_amount:String(y.base_income_amount||0),
      base_expense_amount:String(y.base_expense_amount||0),
      annual_budget_amount:String(y.annual_budget_amount||0),
      as_of_date:String(y.as_of_date||localToday()).slice(0,10),
      notes:String(y.notes||""),
      publish_status:String(y.publish_status||"PUBLISHED")
    });
  }
  useEffect(()=>{load()},[month]);

  const summary=data?.summary||{};
  const ytd=data?.ytd||{};
  const profit=Number(summary.income_amount||0)-Number(summary.expense_amount||0);
  const ytdMargin=Number(ytd.income_amount||0)>0?Number(ytd.profit_amount||0)/Number(ytd.income_amount||0)*100:0;
  const realization=Number(ytd.budget_amount||0)>0?Number(ytd.expense_amount||0)/Number(ytd.budget_amount||0)*100:0;
  const maxChart=useMemo(()=>Math.max(1,...(data?.history||[]).flatMap((r:any)=>[Number(r.income_amount||0),Number(r.expense_amount||0)])),[data]);
  const selectedMonthNo=Number(month.slice(5,7));
  const currentYear=Number(data?.editable_window?.year||new Date().getFullYear());
  const currentMonthNo=Number(data?.editable_window?.currentMonth||new Date().getMonth()+1);
  const maxEditableMonth=Number(data?.editable_window?.maxEditableMonth||Math.min(12,currentMonthNo+4));
  const maxVisibleMonth=canEdit?maxEditableMonth:currentMonthNo;
  const hybridIgnored=Boolean(meta.include_in_ytd&&ytd.mode==="HYBRID"&&ytd.base_through_month!=null&&selectedMonthNo<=Number(ytd.base_through_month));

  function currentMetric(metric:string){return metric==="REVENUE"?Number(summary.income_amount||0):metric==="EXPENSE"?Number(summary.expense_amount||0):Number(summary.budget_amount||0)}
  function openAdjustment(metric:"REVENUE"|"EXPENSE"|"BUDGET",type:"INCREASE"|"DECREASE"|"SET_TOTAL"){
    setAdjust({metric,adjustment_type:type,amount:"",data_date:meta.data_date||localToday(),note:""});
  }
  function adjustmentPreview(){
    if(!adjust)return {before:0,after:0,delta:0,ytdAfter:Number(ytd.income_amount||0)};
    const before=currentMetric(adjust.metric);const amount=Number(adjust.amount||0);let after=before;
    if(adjust.adjustment_type==="INCREASE")after=before+amount;
    if(adjust.adjustment_type==="DECREASE")after=before-amount;
    if(adjust.adjustment_type==="SET_TOTAL")after=amount;
    const delta=after-before;
    const budgetUsesAnnual=adjust.metric==="BUDGET"&&Number(ytd.annual_budget_amount||0)>0;
    const eligible=meta.include_in_ytd&&meta.publish_status==="PUBLISHED"&&ytd.configured&&ytd.mode!=="MANUAL"&&!budgetUsesAnnual&&!(ytd.mode==="HYBRID"&&Number(ytd.base_through_month||0)>=selectedMonthNo);
    const base=adjust.metric==="REVENUE"?Number(ytd.income_amount||0):adjust.metric==="EXPENSE"?Number(ytd.expense_amount||0):Number(ytd.budget_amount||0);
    return {before,after,delta,ytdAfter:eligible?base+delta:base,eligible};
  }

  async function saveMeta(){
    setBusy(true);setError("");setMessage("");
    try{
      const r=await fetch("/api/finance/summary",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({period_month:month,...meta})});
      const j=await r.json();if(!r.ok)throw new Error(j.error||"Gagal menyimpan.");
      setMessage("Status dan dampak data bulanan berhasil disimpan. Perubahan tercatat di Audit Log.");await load();
    }catch(e){setError(e instanceof Error?e.message:"Gagal menyimpan.");}finally{setBusy(false)}
  }
  async function saveAdjustment(){
    if(!adjust)return;setBusy(true);setError("");setMessage("");
    try{
      const r=await fetch("/api/finance/adjustments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({period_month:month,...adjust})});
      const j=await r.json();if(!r.ok)throw new Error(j.error||"Gagal membuat penyesuaian.");
      setAdjust(null);setMessage(`${metricLabel(adjust.metric)} berhasil diperbarui. History dan audit log sudah tersimpan.`);await load();
    }catch(e){setError(e instanceof Error?e.message:"Gagal membuat penyesuaian.");}finally{setBusy(false)}
  }
  async function saveYear(){
    setBusy(true);setError("");setMessage("");
    try{
      const r=await fetch("/api/finance/yearly",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({summary_year:Number(month.slice(0,4)),...yearForm})});
      const j=await r.json();if(!r.ok)throw new Error(j.error||"Gagal menyimpan pengaturan YTD.");
      setYearModal(false);setMessage("Pengaturan Tahun Berjalan berhasil diperbarui.");await load();
    }catch(e){setError(e instanceof Error?e.message:"Gagal menyimpan pengaturan YTD.");}finally{setBusy(false)}
  }
  async function reverseAdjustment(row:any){
    const reason=await dialog.prompt({title:"Batalkan Penyesuaian",message:"SIAP tidak menghapus riwayat. Sistem akan membuat reversal sehingga nilai kembali tanpa menghilangkan jejak perubahan.",label:"Alasan reversal",placeholder:"Contoh: nominal salah input / data duplikat.",required:true,multiline:true,confirmLabel:"Buat Reversal",tone:"danger"});if(!reason)return;
    setBusy(true);setError("");setMessage("");
    try{
      const r=await fetch(`/api/finance/adjustments/${row.id}/reverse`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({note:reason})});
      const j=await r.json();if(!r.ok)throw new Error(j.error||"Reversal gagal.");
      setMessage("Penyesuaian dibatalkan dengan reversal. Record lama tetap tersimpan.");await load();
    }catch(e){setError(e instanceof Error?e.message:"Reversal gagal.");}finally{setBusy(false)}
  }

  const p=adjustmentPreview();
  return <main className="page finance-v3">
    <div className="page-head">
      <div><h2>Dashboard Keuangan</h2><p>{canEdit?"Data tahun berjalan dapat diperbarui kapan saja. Setiap perubahan tersimpan di Finance History dan Audit Log.":"Ringkasan kondisi keuangan yang sudah dipublikasikan Finance."}</p></div>
      <div className="finance-head-actions"><span className="badge blue">TAHUN BERJALAN {currentYear}</span>{canEdit&&<button className="btn btn-secondary" onClick={()=>setYearModal(true)}>⚙ Pengaturan YTD</button>}</div>
    </div>
    {message&&<div className="success" style={{marginBottom:12}}>{message}</div>}{error&&<div className="error" style={{marginBottom:12}}>{error}</div>}

    <section className="card" style={{marginBottom:16}}>
      <div className="card-head"><div><h3>Cara Membaca Dashboard Keuangan</h3><p>Ringkasan ini dibuat supaya user Finance maupun non-Finance membaca angka dengan arti yang sama.</p></div><span className="badge blue">PANDUAN</span></div>
      <div className="card-body">
        <div className="finance-guide-grid">
          <div><b>Pendapatan</b><span>Nilai pendapatan untuk periode yang dipilih. Pendapatan tidak harus berubah setiap hari dan tidak sama dengan uang kas yang masuk. Jika rekap pendapatan belum tersedia, Finance sebaiknya menuliskannya pada Catatan Periode dan mempertahankan status Draft sampai angkanya siap dipublikasikan.</span></div>
          <div><b>Biaya</b><span>Biaya periode berjalan dapat diperbarui lebih dahulu daripada pendapatan. Angka dapat mencakup biaya aktual maupun akrual/estimasi, sehingga Finance perlu memberi catatan bila ada komponen yang belum final.</span></div>
          <div><b>Laba</b><span>Dihitung otomatis dari Pendapatan dikurangi Biaya. Angka laba paling bermakna jika kedua komponen sudah diperbarui untuk periode yang sama. Cek Catatan Periode sebelum menarik kesimpulan.</span></div>
          <div><b>Tahun Berjalan (YTD)</b><span>Akumulasi sejak awal tahun sesuai metode yang ditetapkan Finance. YTD dapat berupa posisi manual, hasil penjumlahan bulanan, atau basis posisi ditambah bulan terpilih. User non-Finance cukup membaca hasil dan tanggal posisinya.</span></div>
          <div><b>Data per Tanggal</b><span>Menunjukkan tanggal posisi angka yang dilaporkan. Ini berbeda dari waktu ketika data dimasukkan ke SIAP.</span></div>
          <div><b>Terakhir Diperbarui</b><span>Menunjukkan waktu terakhir data diubah di sistem. Gunakan bersama “Data per Tanggal” untuk mengetahui seberapa mutakhir informasi yang sedang dilihat.</span></div>
          <div><b>Draft / Data Aktif</b><span>Draft berarti data masih sementara dan hanya terlihat Finance/Root. Data Aktif berarti angka telah dipublikasikan agar dapat dibaca manajemen, tetapi tetap dapat dikoreksi kemudian dengan histori yang tersimpan.</span></div>
          <div><b>Catatan Periode</b><span>Tempat menjelaskan kondisi data, misalnya “pendapatan belum diperbarui”, “biaya termasuk akrual vendor”, atau “masih menunggu rekonsiliasi”. Catatan ini penting agar angka tidak dibaca di luar konteksnya.</span></div>
        </div>
        <div className="notice" style={{marginTop:12}}><b>Prinsip penting:</b> nilai Rp0 berbeda dengan data yang belum tersedia. Bila suatu angka belum siap, Finance sebaiknya mempertahankan periode sebagai Draft dan menuliskan kondisi tersebut pada Catatan Periode. Semua penyesuaian, perubahan status, dokumen, dan reversal tetap tercatat di log.</div>
      </div>
    </section>

    <section className="card finance-period-picker">
      <div className="card-head"><div><h3>Pilih Periode Data</h3><p>{canEdit?`Semua bulan ${currentYear} tetap dapat dikoreksi. Bulan mendatang dapat disiapkan maksimal 4 bulan ke depan selama masih di tahun ${currentYear}.`:`Pilih bulan ${currentYear} untuk melihat data yang sudah dipublikasikan.`}</p></div><span className="audit-live-badge">● LOG AKTIF</span></div>
      <div className="card-body"><div className="finance-month-tabs">{MONTHS.map((label,i)=>{const no=i+1;const allowed=no<=maxVisibleMonth;const value=`${currentYear}-${String(no).padStart(2,"0")}`;return <button key={label} type="button" className={month===value?"active":""} disabled={!allowed} title={!allowed?"Belum dapat dipilih":""} onClick={()=>allowed&&setMonth(value)}><span>{label}</span>{no===currentMonthNo&&<small>Sekarang</small>}</button>})}</div><div className="period-window-note">{canEdit?<>Periode yang dapat dikelola saat ini: Januari–{MONTHS[maxEditableMonth-1]} {currentYear}. Tidak ada proses tutup periode. Nilai terbaru menjadi posisi aktif, sedangkan setiap nilai sebelumnya tetap tercatat di Finance History dan Audit Log.</>:<>Data ditampilkan sesuai periode Published yang tersedia pada tahun {currentYear}.</>}</div></div>
    </section>

    {canEdit&&<section className="card finance-guide-card">
      <div className="card-head"><div><h3>Panduan Singkat Finance</h3><p>Cukup pahami 4 hal ini untuk update harian.</p></div><button className="btn btn-secondary" onClick={()=>setShowGuide(v=>!v)}>{showGuide?"Sembunyikan":"Lihat Panduan"}</button></div>
      {showGuide&&<div className="card-body finance-guide-grid"><div><b>1. Atur sumber YTD</b><span>Gunakan Manual, Otomatis Bulanan, atau Basis Posisi + Bulanan Terpilih. Untuk awal implementasi, mode Basis biasanya paling fleksibel dan tidak mewajibkan pengisian semua bulan lama.</span></div><div><b>2. Pilih bulan</b><span>Bulan sebelumnya tetap bisa diperbaiki. Pendapatan, biaya, dan dokumen periode tidak harus diperbarui pada hari yang sama. Jika belum lengkap, gunakan Draft dan tulis keterangannya.</span></div><div><b>3. Update angka</b><span>Pakai + Tambah, − Kurangi, atau Set Total. Tuliskan alasan yang singkat tetapi jelas. Jika biaya memuat akrual atau estimasi, jelaskan pada Catatan Periode.</span></div><div><b>4. Tentukan data aktif</b><span>Draft = sementara. Data Aktif = siap dibaca manajemen. “Sertakan ke YTD” menentukan apakah bulan ikut menghitung posisi tahun berjalan sesuai mode YTD.</span></div><div className="finance-guide-wide"><b>5. Lengkapi konteks & dokumen</b><span>Isi Data per Tanggal dan Catatan Periode agar user non-Finance tahu kondisi angka. Dokumen/laporan pendukung dapat diunggah dan diunduh kembali. Semua update, upload, penghapusan dokumen, dan reversal tercatat di Audit Log.</span></div><div className="finance-guide-wide"><b>Audit aman</b><span>Tidak ada tutup periode. Finance boleh memperbaiki bulan mana pun yang masih dalam jendela tahun berjalan. Jika salah input, gunakan Reverse agar nilai dikoreksi tanpa menghilangkan jejak perubahan.</span></div></div>}
    </section>}

    <section className="card finance-ytd-card">
      <div className="card-head"><div><h3>Posisi Tahun Berjalan {month.slice(0,4)}</h3><p>{ytd.configured?`Data per ${dateLabel(ytd.as_of_date)} • ${canEdit?modeLabel(ytd.mode):"posisi terkini"}`:"Belum ada posisi tahun berjalan yang dipublikasikan."}</p></div>{canEdit&&<span className={`badge ${ytd.publish_status==="PUBLISHED"?"green":"orange"}`}>{ytd.configured?ytd.publish_status:"BELUM DIATUR"}</span>}</div>
      <div className="card-body">
        <div className="finance-ytd-grid">
          <div><span>Pendapatan YTD</span><b>{ytd.configured?rupiah(ytd.income_amount):"—"}</b><small>{ytd.configured?`Update ${dateLabel(ytd.as_of_date)}`:"Atur dari akun Finance"}</small></div>
          <div><span>Biaya YTD</span><b>{ytd.configured?rupiah(ytd.expense_amount):"—"}</b><small>{ytd.configured?`Realisasi ${realization.toFixed(1)}% dari anggaran`:"Belum tersedia"}</small></div>
          <div><span>Laba YTD</span><b>{ytd.configured?rupiah(ytd.profit_amount):"—"}</b><small>{ytd.configured?`Margin ${ytdMargin.toFixed(1)}%`:"Pendapatan − biaya"}</small></div>
          <div><span>Anggaran</span><b>{ytd.configured?rupiah(ytd.budget_amount):"—"}</b><small>{ytd.configured?`Sisa ${rupiah(Math.max(0,Number(ytd.budget_amount||0)-Number(ytd.expense_amount||0)))}`:"Belum tersedia"}</small></div>
        </div>
        {canEdit&&ytd.configured&&<div className="finance-mode-note"><b>{modeLabel(ytd.mode)}</b><span>{ytd.mode==="MANUAL"?"Angka YTD berdiri sendiri; perubahan bulanan tidak menambah atau mengurangi YTD.":ytd.mode==="AUTO_MONTHLY"?"YTD dihitung dari bulan Published yang ditandai masuk YTD.":`Basis posisi s.d. ${ytd.base_through_month?MONTHS[Number(ytd.base_through_month)-1]:"sebelum Jan"}: Pendapatan ${rupiah(ytd.base_income_amount)} • Biaya ${rupiah(ytd.base_expense_amount)}. Setelah itu, bulan Published terpilih ditambahkan otomatis.`}</span></div>}
      </div>
    </section>

    <div className="page-head finance-period-title"><div><h2>{monthLong(month)}</h2><p>Angka periode dapat diperbarui setiap hari. Nilai terbaru dipakai dashboard, sedangkan histori sebelumnya tetap tersimpan.</p></div><div className="finance-head-actions">{canEdit&&<span className="badge green">DAPAT DIEDIT • LOG AKTIF</span>}<span className={`badge ${meta.publish_status==="PUBLISHED"?"green":"orange"}`}>{meta.publish_status==="PUBLISHED"?"DATA AKTIF":"DRAFT"}</span></div></div>

    <div className="finance-edit-grid finance-adjust-grid">
      {(["REVENUE","EXPENSE","PROFIT","BUDGET"] as const).map(metric=>{
        const value=metric==="REVENUE"?Number(summary.income_amount||0):metric==="EXPENSE"?Number(summary.expense_amount||0):metric==="BUDGET"?Number(summary.budget_amount||0):profit;
        const label=metric==="REVENUE"?"Pendapatan":metric==="EXPENSE"?"Biaya":metric==="BUDGET"?"Anggaran":"Laba";
        return <div className="stat finance-adjust-card" key={metric}><div className="stat-label">{label} {monthLong(month)}</div><div className="stat-value">{summary.id?rupiah(value):"Belum ada data"}</div><div className="stat-sub">{metric==="PROFIT"?"Dihitung otomatis: pendapatan − biaya":updateLabel(summary.updated_at)}</div>{canEdit&&metric!=="PROFIT"&&<div className="adjust-actions"><button className="mini-action plus" disabled={busy} onClick={()=>openAdjustment(metric as any,"INCREASE")}>+ Tambah</button><button className="mini-action minus" disabled={busy} onClick={()=>openAdjustment(metric as any,"DECREASE")}>− Kurangi</button><button className="mini-action" disabled={busy} onClick={()=>openAdjustment(metric as any,"SET_TOTAL")}>Set Total</button></div>}</div>
      })}
    </div>

    {canEdit&&<section className="card" style={{marginBottom:16}}>
      <div className="card-head"><div><h3>Status Data & Dampak ke YTD</h3><p>Tentukan tanggal posisi, mana data aktif yang terlihat manajemen, dan apakah bulan ini ikut membentuk Tahun Berjalan.</p></div><span className={`badge ${meta.publish_status==="PUBLISHED"?"green":"orange"}`}>{meta.publish_status==="PUBLISHED"?"DATA AKTIF":"DRAFT"}</span></div>
      <div className="card-body">
        <div className="finance-meta-grid">
          <div className="field"><label>Data per Tanggal</label><input className="input" type="date" value={meta.data_date}  onChange={e=>setMeta(f=>({...f,data_date:e.target.value}))}/><span className="hint">Berbeda dari waktu input. Contoh: diinput hari ini tetapi posisi datanya kemarin.</span></div>
          <div className="field"><label>Status Data</label><select className="select" value={meta.publish_status}  onChange={e=>setMeta(f=>({...f,publish_status:e.target.value}))}><option value="DRAFT">Draft — data sementara, hanya Finance/Root</option><option value="PUBLISHED">Published — data aktif, tampil ke manajemen</option></select><span className="hint">Published adalah angka yang dianggap aktif pada dashboard. Perubahan berikutnya tetap boleh dilakukan dan seluruh versi lama tersimpan di log.</span></div>
          <div className="field finance-check-field"><label>Perhitungan Tahun Berjalan</label><label className="check-line"><input type="checkbox" checked={meta.include_in_ytd} disabled={ytd.mode==="MANUAL"} onChange={e=>setMeta(f=>({...f,include_in_ytd:e.target.checked}))}/> Sertakan bulan ini ke YTD</label><span className="hint">Mode Manual mengabaikan angka bulanan. Pada mode Hybrid, bulan di dalam basis juga diabaikan untuk mencegah double count.</span></div>
          <div className="field"><label>Catatan Periode</label><textarea className="textarea" value={meta.notes}  onChange={e=>setMeta(f=>({...f,notes:e.target.value}))} placeholder="Contoh: Pendapatan September belum diperbarui. Biaya s.d. 24 Sep termasuk akrual vendor dan masih menunggu rekonsiliasi akhir bulan."/><span className="hint">Tuliskan kondisi yang perlu diketahui pembaca: data belum tersedia, angka sementara, akrual/estimasi, sumber data, atau hal lain yang membuat angka perlu dibaca dengan konteks.</span></div>
        </div>
        {hybridIgnored&&<div className="warning-box">Bulan {monthLong(month)} berada di dalam basis YTD sampai {MONTHS[Number(ytd.base_through_month)-1]} {month.slice(0,4)}. Sistem akan mengabaikan bulan ini dalam penjumlahan YTD agar tidak terjadi double counting.</div>}
        <div className="finance-meta-footer"><span>{summary.updated_at?`${updateLabel(summary.updated_at)} • oleh ${summary.updated_by_name||"-"}`:"Belum ada update periode."}</span><button className="btn btn-primary" disabled={busy} onClick={saveMeta}>{busy?"Memproses...":"Simpan Status & Dampak"}</button></div>
      </div>
    </section>}

    <div className="stats">
      <a href="/finance/receivables" className="stat stat-link"><div className="stat-label">Piutang Outstanding</div><div className="stat-value">{rupiah(data?.receivables?.outstanding||0)}</div><div className="stat-sub">Overdue {rupiah(data?.receivables?.overdue||0)} • jatuh tempo ≤30 hari: {data?.receivables?.due_30_count||0}</div></a>
      <a href="/finance/payables" className="stat stat-link"><div className="stat-label">Utang Outstanding</div><div className="stat-value">{rupiah(data?.payables?.outstanding||0)}</div><div className="stat-sub">Overdue {rupiah(data?.payables?.overdue||0)} • jatuh tempo ≤30 hari: {data?.payables?.due_30_count||0}</div></a>
      <a href="/finance/aging" className="stat stat-link"><div className="stat-label">Aging</div><div className="stat-value" style={{fontSize:20}}>1-30 • 30-60 • 60-90 • 90+</div><div className="stat-sub">Buka rincian umur utang & piutang</div></a>
      <div className="stat"><div className="stat-label">Posisi Data Bulan Ini</div><div className="stat-value" style={{fontSize:18}}>{summary.id?dateLabel(summary.data_date):"Belum tersedia"}</div><div className="stat-sub">{updateLabel(summary.updated_at)}</div></div>
    </div>

    <div className="grid-2 finance-main-grid">
      <section className="card"><div className="card-head"><div><h3>Tren Tahun {month.slice(0,4)}</h3><p>Hanya periode yang punya record; bulan yang belum diinput tidak dianggap Rp0.</p></div></div><div className="card-body"><div className="finance-chart">{(data?.history||[]).map((r:any)=><div className={`finance-chart-col ${r.publish_status==="DRAFT"?"draft-period":""}`} key={String(r.period_month)}><div className="finance-bars"><div className="finance-bar income" title={`Pendapatan ${rupiah(r.income_amount)}`} style={{height:`${Math.max(4,Number(r.income_amount)/maxChart*100)}%`}}/><div className="finance-bar expense" title={`Biaya ${rupiah(r.expense_amount)}`} style={{height:`${Math.max(4,Number(r.expense_amount)/maxChart*100)}%`}}/></div><span>{monthShort(r.period_month)}{canEdit&&r.publish_status==="DRAFT"?"*":""}</span></div>)}{!(data?.history||[]).length&&<div className="empty" style={{width:"100%"}}>Belum ada histori bulanan.</div>}</div><div className="chart-legend"><span><i className="legend-dot income"/>Pendapatan</span><span><i className="legend-dot expense"/>Biaya</span>{canEdit&&<span>* Draft</span>}</div></div></section>
      <section className="card"><div className="card-head"><div><h3>Catatan & Status</h3><p>Informasi singkat periode terpilih.</p></div></div><div className="card-body"><div className="kpi-list"><div className="kpi-row"><span>Data per</span><b>{dateLabel(summary.data_date)}</b></div><div className="kpi-row"><span>Terakhir diperbarui</span><b>{dateTimeLabel(summary.updated_at)}</b></div>{canEdit&&<><div className="kpi-row"><span>Masuk YTD</span><b>{meta.include_in_ytd?"Ya":"Tidak"}</b></div><div className="kpi-row"><span>Status data</span><b>{meta.publish_status==="PUBLISHED"?"Published / Aktif":"Draft / Sementara"}</b></div></>}<div className="note-box">{summary.notes||"Belum ada catatan periode."}</div></div></div></section>
    </div>

    {canEdit&&<section className="card finance-history-card" style={{marginTop:16}}><div className="card-head"><div><h3>Riwayat Penyesuaian</h3><p>Tambah, kurang, set total, dan reversal tersimpan permanen. Penghapusan langsung tidak disediakan.</p></div></div><div className="table-wrap"><table className="table finance-history-table"><thead><tr><th>Waktu Input</th><th>Data per</th><th>Metrik</th><th>Aksi</th><th>Nominal</th><th>Sebelum → Sesudah</th><th>Keterangan</th><th>Oleh</th><th>Aksi</th></tr></thead><tbody>{(data?.adjustments||[]).map((a:any)=><tr key={a.id}><td className="nowrap">{dateTimeLabel(a.created_at)}</td><td className="nowrap">{dateLabel(String(a.data_date||"").slice(0,10))}</td><td><b>{metricLabel(a.metric)}</b></td><td><span className={`badge ${a.adjustment_type==="INCREASE"?"green":a.adjustment_type==="DECREASE"||a.adjustment_type==="REVERSAL"?"orange":"blue"}`}>{adjLabel(a.adjustment_type)}</span>{a.status==="REVERSED"&&<span className="badge gray" style={{marginLeft:5}}>REVERSED</span>}</td><td>{a.adjustment_type==="INCREASE"?"+ ":a.adjustment_type==="DECREASE"?"− ":""}{rupiah(a.amount)}</td><td className="nowrap">{rupiah(a.value_before)} → <b>{rupiah(a.value_after)}</b></td><td>{a.note||"-"}</td><td>{a.created_by_name||"-"}</td><td><div className="row-actions"><button className="btn btn-secondary" onClick={()=>setAttachAdjustment(a)}>Lampiran {a.attachment_count?`(${a.attachment_count})`:""}</button>{a.status==="ACTIVE"&&a.adjustment_type!=="REVERSAL"&&<button className="btn btn-danger" disabled={busy} onClick={()=>reverseAdjustment(a)}>Reverse</button>}</div></td></tr>)}{!(data?.adjustments||[]).length&&<tr><td colSpan={9}><div className="empty">Belum ada penyesuaian. Gunakan tombol + Tambah, − Kurangi, atau Set Total.</div></td></tr>}</tbody></table></div></section>}

    <section className="card" style={{marginTop:16}}><div className="card-body"><FinanceAttachmentsPanel entityType="SUMMARY" entityId={summary?.id||null} periodMonth={month} canEdit={canEdit} title="Dokumen / Laporan Keuangan Bulanan" reportMode/></div></section>

    {adjust&&<Modal title={`${adjLabel(adjust.adjustment_type)} ${metricLabel(adjust.metric)}`} subtitle={`${monthLong(month)} • setiap perubahan masuk Finance History dan Audit Log`} onClose={()=>!busy&&setAdjust(null)}><div className="form-grid"><div className="field"><label>{adjust.adjustment_type==="SET_TOTAL"?"Nilai Total Baru":"Nominal"}</label><CurrencyInput autoFocus value={adjust.amount} onValueChange={value=>setAdjust(a=>a?({...a,amount:value}):a)}/></div><div className="field"><label>Tanggal Data</label><input className="input" type="date" value={adjust.data_date} onChange={e=>setAdjust(a=>a?({...a,data_date:e.target.value}):a)}/></div><div className="field full"><label>Keterangan *</label><textarea className="textarea" value={adjust.note} onChange={e=>setAdjust(a=>a?({...a,note:e.target.value}):a)} placeholder="Contoh: pembayaran invoice PT ABC / koreksi pencatatan ganda."/></div></div><div className="adjust-preview"><div><span>Sebelum</span><b>{rupiah(p.before)}</b></div><div><span>Perubahan</span><b>{p.delta>=0?"+ ":"− "}{rupiah(Math.abs(p.delta))}</b></div><div><span>Sesudah</span><b>{rupiah(p.after)}</b></div></div><div className="notice" style={{marginTop:12}}>{p.eligible?`Estimasi ${metricLabel(adjust.metric)} YTD setelah penyimpanan: ${rupiah(p.ytdAfter)}.`:`Penyesuaian ini tidak mengubah YTD saat ini (cek mode YTD, status Published, dan toggle Masuk YTD).`}</div><div className="modal-actions"><button className="btn btn-secondary" onClick={()=>setAdjust(null)} disabled={busy}>Batal</button><button className="btn btn-primary" onClick={saveAdjustment} disabled={busy||!adjust.note.trim()||Number(adjust.amount)<0}>{busy?"Menyimpan...":"Simpan Penyesuaian"}</button></div></Modal>}

    {yearModal&&<Modal title={`Pengaturan Tahun Berjalan ${month.slice(0,4)}`} subtitle="Tentukan angka tahun berjalan. Manajemen hanya melihat hasil akhirnya; cara perhitungan tetap khusus Finance/Root." onClose={()=>!busy&&setYearModal(false)}><div className="field"><label>Metode Perhitungan YTD</label><select className="select" value={yearForm.calculation_mode} onChange={e=>setYearForm(f=>({...f,calculation_mode:e.target.value}))}><option value="MANUAL">Manual — YTD berdiri sendiri</option><option value="AUTO_MONTHLY">Otomatis dari Bulanan</option><option value="HYBRID">Basis Posisi + Bulanan Terpilih</option></select></div><div className="year-mode-help">{yearForm.calculation_mode==="MANUAL"?"Isi posisi YTD secara langsung. Input bulanan tetap bisa dilakukan tetapi tidak menambah YTD.":yearForm.calculation_mode==="AUTO_MONTHLY"?"YTD menjumlahkan bulan Published yang ditandai Masuk YTD. Bulan yang belum diinput tidak dianggap nol.":"Tetapkan angka basis/posisi kumulatif sampai bulan tertentu. Bulan Published yang dipilih setelah bulan basis akan ditambahkan otomatis. Basis tetap bisa dikoreksi dan semua perubahan tercatat."}</div><div className="form-grid" style={{marginTop:12}}>{yearForm.calculation_mode==="HYBRID"&&<div className="field"><label>Basis Posisi mencakup sampai Bulan</label><select className="select" value={yearForm.base_through_month} onChange={e=>setYearForm(f=>({...f,base_through_month:e.target.value}))}><option value="0">Belum ada bulan / basis awal</option>{MONTHS.slice(0,currentMonthNo).map((m,i)=><option value={i+1} key={m}>{m} {month.slice(0,4)}</option>)}</select></div>}{yearForm.calculation_mode!=="AUTO_MONTHLY"&&<><div className="field"><label>{yearForm.calculation_mode==="MANUAL"?"Pendapatan YTD":"Pendapatan Basis Posisi"}</label><CurrencyInput value={yearForm.base_income_amount} onValueChange={value=>setYearForm(f=>({...f,base_income_amount:value}))}/></div><div className="field"><label>{yearForm.calculation_mode==="MANUAL"?"Biaya YTD":"Biaya Basis Posisi"}</label><CurrencyInput value={yearForm.base_expense_amount} onValueChange={value=>setYearForm(f=>({...f,base_expense_amount:value}))}/></div></>}<div className="field"><label>Anggaran Tahunan / YTD</label><CurrencyInput value={yearForm.annual_budget_amount} onValueChange={value=>setYearForm(f=>({...f,annual_budget_amount:value}))}/></div><div className="field"><label>Data YTD / Basis per Tanggal</label><input className="input" type="date" value={yearForm.as_of_date} onChange={e=>setYearForm(f=>({...f,as_of_date:e.target.value}))}/></div><div className="field"><label>Status</label><select className="select" value={yearForm.publish_status} onChange={e=>setYearForm(f=>({...f,publish_status:e.target.value}))}><option value="PUBLISHED">Published</option><option value="DRAFT">Draft</option></select></div><div className="field full"><label>Catatan</label><textarea className="textarea" value={yearForm.notes} onChange={e=>setYearForm(f=>({...f,notes:e.target.value}))} placeholder="Contoh: basis berasal dari laporan posisi s.d. Agustus 2026."/></div></div><div className="modal-actions"><button className="btn btn-secondary" onClick={()=>setYearModal(false)} disabled={busy}>Batal</button><button className="btn btn-primary" onClick={saveYear} disabled={busy}>{busy?"Menyimpan...":"Simpan Pengaturan YTD"}</button></div></Modal>}

    {attachAdjustment&&<Modal title={`Lampiran Penyesuaian ${metricLabel(attachAdjustment.metric)}`} subtitle={`${adjLabel(attachAdjustment.adjustment_type)} • ${rupiah(attachAdjustment.amount)} • ${dateTimeLabel(attachAdjustment.created_at)}`} onClose={()=>{setAttachAdjustment(null);load()}}><FinanceAttachmentsPanel entityType="ADJUSTMENT" entityId={attachAdjustment.id} canEdit={canEdit} title="Bukti / Dokumen Pendukung"/></Modal>}
  </main>;
}
