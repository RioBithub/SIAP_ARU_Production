"use client";
import { useEffect,useMemo,useState } from "react";

const rupiah=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);
function monthShort(v:string){const d=new Date(String(v).slice(0,10));return new Intl.DateTimeFormat("id-ID",{month:"short"}).format(d)}

export default function DashboardClient(){
  const [data,setData]=useState<any>(null);
  const [error,setError]=useState("");
  useEffect(()=>{fetch("/api/dashboard/summary",{cache:"no-store"}).then(r=>r.json()).then(j=>j.ok?setData(j.data):setError(j.error)).catch(()=>setError("Gagal mengambil dashboard."))},[]);
  const letters=data?.letters||{};
  const disp=data?.dispositions||{};
  const fin=data?.finance;
  const chartMax=useMemo(()=>Math.max(1,...(fin?.history||[]).flatMap((r:any)=>[Number(r.income||0),Number(r.expense||0)])),[fin]);

  return <main className="page">
    <div className="hero">
      <span className="eyebrow">SIAP • PT Aru Raharja</span>
      <h2>Satu sistem untuk persuratan, Nota Dinas, disposisi, dan informasi keuangan.</h2>
      <p>Satu tampilan terintegrasi untuk memantau surat eksternal, Nota Dinas dari Staff ke manajemen, tindak lanjut disposisi, serta posisi keuangan perusahaan sesuai hak akses masing-masing pengguna.</p>
    </div>
    {error&&<div className="error" style={{marginTop:15}}>{error}</div>}

    {fin&&<>
      <div className="page-head finance-highlight-head"><div><h2>Highlight Keuangan</h2><p>Ringkasan bulan berjalan — klik untuk membuka dashboard Finance.</p></div><a href="/finance" className="btn btn-primary">Buka Keuangan</a></div>
      <div className="finance-dashboard-highlight">
        <div className="finance-highlight-kpis">
          <a href="/finance" className="stat stat-link"><div className="stat-label">Pendapatan</div><div className="stat-value">{rupiah(fin.income)}</div><div className="stat-sub">Periode berjalan</div></a>
          <a href="/finance" className="stat stat-link"><div className="stat-label">Biaya</div><div className="stat-value">{rupiah(fin.expense)}</div><div className="stat-sub">Periode berjalan</div></a>
          <a href="/finance/receivables" className="stat stat-link"><div className="stat-label">Piutang</div><div className="stat-value">{rupiah(fin.receivables)}</div><div className="stat-sub">Overdue {rupiah(fin.receivables_overdue)}</div></a>
          <a href="/finance/payables" className="stat stat-link"><div className="stat-label">Utang</div><div className="stat-value">{rupiah(fin.payables)}</div><div className="stat-sub">Overdue {rupiah(fin.payables_overdue)}</div></a>
        </div>
        <section className="card compact-chart-card">
          <div className="card-head"><div><h3>Tren 6 Periode</h3><p>Perbandingan pendapatan dan biaya.</p></div></div>
          <div className="card-body">
            <div className="finance-chart compact">
              {(fin.history||[]).map((r:any)=><div className="finance-chart-col" key={String(r.period_month)}>
                <div className="finance-bars"><div className="finance-bar income" style={{height:`${Math.max(4,Number(r.income||0)/chartMax*100)}%`}}/><div className="finance-bar expense" style={{height:`${Math.max(4,Number(r.expense||0)/chartMax*100)}%`}}/></div><span>{monthShort(r.period_month)}</span>
              </div>)}
              {!(fin.history||[]).length&&<div className="empty" style={{width:"100%"}}>Belum ada histori ringkasan keuangan.</div>}
            </div>
          </div>
        </section>
      </div>
    </>}

    <div className="page-head" style={{marginTop:18}}><div><h2>Persuratan & Disposisi</h2><p>Status operasional surat bulan berjalan.</p></div></div>
    <div className="stats stats-five">
      <div className="stat"><div className="stat-label">Surat Masuk Bulan Ini</div><div className="stat-value">{Number(letters.incoming_total||0)}</div><div className="stat-sub">Registrasi tersimpan</div></div>
      <div className="stat"><div className="stat-label">Nota Dinas Bulan Ini</div><div className="stat-value">{Number(letters.internal_total||0)}</div><div className="stat-sub">Nota Dinas</div></div>
      <div className="stat"><div className="stat-label">Menunggu Approval</div><div className="stat-value">{Number(letters.waiting_approval||0)}</div><div className="stat-sub">Manager / Direksi</div></div>
      <div className="stat"><div className="stat-label">Disposisi Unseen</div><div className="stat-value">{Number(disp.unseen||0)}</div><div className="stat-sub">Belum dibuka penerima</div></div>
      <div className="stat"><div className="stat-label">Disposisi Aktif</div><div className="stat-value">{Number(disp.active||0)}</div><div className="stat-sub">Sedang ditindaklanjuti</div></div>
    </div>
    <div className="grid-2">
      <section className="card"><div className="card-head"><div><h3>Alur Persuratan Utama</h3><p>Workflow approval dan return diberlakukan oleh sistem.</p></div></div><div className="card-body"><div className="kpi-list">
        <div className="kpi-row"><span>1. Surat Eksternal</span><b>Staff meregistrasi surat yang diterima perusahaan</b></div>
        <div className="kpi-row"><span>2. Nota Dinas</span><b>Staff menyampaikan Nota Dinas + lampiran</b></div>
        <div className="kpi-row"><span>3. Manager / Direksi</span><b>Approve, return, atau meneruskan ke level berikutnya</b></div>
        <div className="kpi-row"><span>4. Disposisi</span><b>Digunakan pimpinan untuk instruksi/tindak lanjut setelah dokumen diterima</b></div>
        <div className="kpi-row"><span>5. PIC</span><b>Seen / In Progress / Completed + lampiran hasil</b></div>
      </div></div></section>
      <section className="card"><div className="card-head"><div><h3>Jejak & Dokumen</h3><p>Aturan dasar untuk operasional.</p></div></div><div className="card-body"><div className="timeline">
        <div className="timeline-row"><div className="timeline-dot">A</div><div><b>Audit log permanen</b><p>Login, edit, approval, return, disposisi, upload, download, dan perubahan Finance tercatat.</p></div></div>
        <div className="timeline-row"><div className="timeline-dot">B</div><div><b>Nomor batal tetap hangus</b><p>Ledger tidak menggunakan ulang nomor yang sudah direservasi lalu dibatalkan.</p></div></div>
        <div className="timeline-row"><div className="timeline-dot">C</div><div><b>Attachment hemat storage</b><p>Surat asli tidak dikompres; lampiran tambahan dan Finance dikompresi bila efektif.</p></div></div>
      </div></div></section>
    </div>
  </main>
}
