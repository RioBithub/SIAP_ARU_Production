"use client";
import { useEffect,useState } from "react";
const rupiah=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);

export default function AgingClient(){
  const [recv,setRecv]=useState<any>(null);const [pay,setPay]=useState<any>(null);const [error,setError]=useState("");
  useEffect(()=>{Promise.all([
    fetch("/api/finance/positions/receivables",{cache:"no-store"}).then(r=>r.json()),
    fetch("/api/finance/positions/payables",{cache:"no-store"}).then(r=>r.json())
  ]).then(([a,b])=>{if(a.ok)setRecv(a.data.active);else setError(a.error);if(b.ok)setPay(b.data.active);else setError(b.error)}).catch(()=>setError("Gagal memuat aging."))},[]);
  const buckets=[
    ["1-30","aging_1_30_amount"],
    ["30-60","aging_30_60_amount"],
    ["60-90","aging_60_90_amount"],
    ["90+","aging_90_plus_amount"]
  ] as const;
  return <main className="page">
    <div className="page-head"><div><h2>Aging & Jatuh Tempo</h2><p>Posisi outstanding yang sudah melewati jatuh tempo, dikelompokkan sesuai umur keterlambatan.</p></div></div>
    {error&&<div className="error">{error}</div>}
    <div className="grid-2">
      <div className="card"><div className="card-head"><div><h3>Aging Piutang</h3><p>Posisi per {String(recv?.as_of_date||"-").slice(0,10)}</p></div></div><div className="card-body"><div className="grid-4">{buckets.map(([b,k])=><div className="stat aging-stat" key={b}><div className="stat-label">{b} hari</div><div className="stat-value" style={{fontSize:18}}>{rupiah(Number(recv?.[k]||0))}</div></div>)}</div><div className="finance-overdue-preview" style={{marginTop:12}}><span>Total overdue piutang</span><b>{rupiah(Number(recv?.overdue_amount||0))}</b></div></div></div>
      <div className="card"><div className="card-head"><div><h3>Aging Utang</h3><p>Posisi per {String(pay?.as_of_date||"-").slice(0,10)}</p></div></div><div className="card-body"><div className="grid-4">{buckets.map(([b,k])=><div className="stat aging-stat" key={b}><div className="stat-label">{b} hari</div><div className="stat-value" style={{fontSize:18}}>{rupiah(Number(pay?.[k]||0))}</div></div>)}</div><div className="finance-overdue-preview" style={{marginTop:12}}><span>Total overdue utang</span><b>{rupiah(Number(pay?.overdue_amount||0))}</b></div></div></div>
    </div>
    <div className="notice" style={{marginTop:15}}>Batas bucket: tepat 30 hari masuk <b>1-30</b>; 31-60 masuk <b>30-60</b>; 61-90 masuk <b>60-90</b>; lebih dari 90 masuk <b>90+</b>.</div>
  </main>
}
