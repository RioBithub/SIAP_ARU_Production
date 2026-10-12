"use client";

import { useEffect,useMemo,useState } from "react";
import type { FormEvent } from "react";
import type { SessionUser } from "@/lib/types";
import CurrencyInput from "@/components/CurrencyInput";

type Account={id:string;bank_name:string;account_name:string;account_number:string};
type ImportRow={
  id:string;bank_account_id:string;bank_name:string;account_name:string;account_number:string;original_name:string;
  statement_date:string;period_from:string;period_to:string;statement_opening_balance:number;statement_closing_balance:number;
  manual_opening_balance:number|null;manual_closing_balance:number|null;effective_opening_balance:number;effective_closing_balance:number;
  total_debit:number;total_credit:number;source_transaction_count:number;inserted_count:number;duplicate_count:number;
  source_document_id?:string|null;parse_warnings?:string[];status:string;created_at:string;corrected_at?:string|null;undone_at?:string|null;undo_reason?:string|null;creator_name:string;
};

type ImportResult={account_id:string;account_number:string;statement_date:string;period_from:string;period_to:string;opening_balance:number;closing_balance:number;total_debit:number;total_credit:number;source_transaction_count:number;inserted_count:number;duplicate_count:number;warnings:string[]};

function money(v:number){return new Intl.NumberFormat("id-ID",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0))}
function date(v:string){if(!v)return"-";const d=new Date(`${String(v).slice(0,10)}T00:00:00`);return new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"short",year:"numeric"}).format(d)}

export default function BankImportClient({user}:{user:SessionUser}){
  const canEdit=user.role==="ROOT_ADMIN"||user.role==="FINANCE";
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [accountId,setAccountId]=useState("");
  const [imports,setImports]=useState<ImportRow[]>([]);
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [result,setResult]=useState<ImportResult|null>(null);
  const [editing,setEditing]=useState<ImportRow|null>(null);
  const [opening,setOpening]=useState("");
  const [closing,setClosing]=useState("");

  async function loadAccounts(){
    const r=await fetch("/api/finance/bank-accounts",{cache:"no-store"});const j=await r.json();
    if(!j.ok) throw new Error(j.error||"Gagal memuat rekening.");
    setAccounts(j.data||[]);
  }
  async function loadImports(id=accountId){
    const q=id?`?account_id=${encodeURIComponent(id)}`:"";
    const r=await fetch(`/api/finance/bank-statement/imports${q}`,{cache:"no-store"});const j=await r.json();
    if(!j.ok) throw new Error(j.error||"Gagal memuat riwayat import.");
    setImports(j.data||[]);
  }
  useEffect(()=>{void (async()=>{try{await loadAccounts();await loadImports("")}catch(e){setError(e instanceof Error?e.message:"Gagal memuat data.")}})()},[]);

  const latest=useMemo(()=>imports.find(x=>x.status==="ACTIVE")||null,[imports]);

  async function doImport(e:FormEvent){
    e.preventDefault();if(!file)return;setBusy(true);setError("");setMessage("");setResult(null);
    try{
      const fd=new FormData();fd.set("file",file);if(accountId)fd.set("account_id",accountId);
      const r=await fetch("/api/finance/bank-statement/import-bri",{method:"POST",body:fd});const j=await r.json();
      if(!j.ok) throw new Error(j.error||"Import gagal.");
      setResult(j.data);setMessage(`Import berhasil: ${j.data.inserted_count} transaksi baru, ${j.data.duplicate_count} duplikat dilewati.`);
      setAccountId(j.data.account_id);setFile(null);
      const el=document.getElementById("bri-pdf-file") as HTMLInputElement|null;if(el)el.value="";
      await loadImports(j.data.account_id);
    }catch(e){setError(e instanceof Error?e.message:"Import gagal.")}
    finally{setBusy(false)}
  }

  function openCorrection(row:ImportRow){setEditing(row);setOpening(String(row.effective_opening_balance));setClosing(String(row.effective_closing_balance));}
  async function saveCorrection(e:FormEvent){
    e.preventDefault();if(!editing)return;setBusy(true);setError("");
    try{
      const r=await fetch(`/api/finance/bank-statement/imports/${editing.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({opening_balance:Number(opening||0),closing_balance:Number(closing||0)})});const j=await r.json();
      if(!j.ok)throw new Error(j.error||"Koreksi saldo gagal.");
      setEditing(null);setMessage("Saldo referensi import berhasil dikoreksi.");await loadImports(editing.bank_account_id);
    }catch(e){setError(e instanceof Error?e.message:"Koreksi saldo gagal.")}
    finally{setBusy(false)}
  }

  async function undo(row:ImportRow){
    const reason=window.prompt(`Undo import ${row.period_from} s.d. ${row.period_to}.\nMasukkan alasan undo:`);
    if(!reason?.trim())return;
    if(!window.confirm(`Transaksi yang BARU masuk dari batch ini (${row.inserted_count}) akan dihapus dari Rekening Koran.\nTransaksi duplikat dari import sebelumnya tidak disentuh. Lanjut?`))return;
    setBusy(true);setError("");
    try{
      const r=await fetch(`/api/finance/bank-statement/imports/${row.id}/undo`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason})});const j=await r.json();
      if(!j.ok)throw new Error(j.error||"Undo gagal.");
      setMessage(`Undo berhasil. ${j.data?.removed_transactions||0} transaksi dari batch tersebut dibatalkan dari data aktif.`);await loadImports(row.bank_account_id);
    }catch(e){setError(e instanceof Error?e.message:"Undo gagal.")}
    finally{setBusy(false)}
  }

  return <main className="page bank-import-page">
    <style jsx global>{`
      .bank-import-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}
      .bank-import-metric{border:1px solid var(--line);border-radius:16px;background:var(--surface2,#f8fafc);padding:16px;min-width:0}
      .bank-import-metric span{display:block;color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.02em;margin-bottom:7px}
      .bank-import-metric b{display:block;font-size:20px;line-height:1.25;color:var(--ink);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
      .bank-import-upload-actions{display:flex;align-items:center;gap:10px;flex-direction:row}
      @media(max-width:700px){
        .bank-import-metrics{grid-template-columns:1fr;gap:10px}
        .bank-import-metric{padding:15px 16px}
        .bank-import-metric span{font-size:12px;margin-bottom:5px}
        .bank-import-metric b{font-size:18px}
        .bank-import-upload-actions{align-items:flex-start!important;flex-direction:column!important}
        .bank-import-upload-actions .btn{width:auto}
        .bank-import-page .page-head{align-items:flex-start}
      }
    `}</style>

    <div className="page-head"><div><h2>Import Rekening Koran BRI</h2><p>Upload PDF BRI IBBIZ untuk membaca periode, saldo, dan transaksi secara otomatis tanpa memasukkan transaksi yang sama dua kali.</p></div><a className="btn btn-secondary" href="/finance/bank-statement">← Rekening Koran</a></div>

    <div className="notice" style={{marginBottom:14}}><b>Cara kerja:</b> SIAP membaca nomor rekening dan transaksi dari PDF BRI, lalu membuat fingerprint dari waktu + uraian + teller + debit/kredit + saldo. PDF periode yang tumpang tindih aman: transaksi yang sudah pernah masuk dilewati. Import terbaru yang aktif menjadi sumber saldo referensi untuk periode berikutnya. Jika salah import, Finance/Root dapat <b>Undo</b>.</div>
    {message&&<div className="success" style={{marginBottom:12}}>{message}</div>}{error&&<div className="error" style={{marginBottom:12}}>{error}</div>}

    {canEdit&&<section className="card" style={{marginBottom:16}}><div className="card-body"><h3 style={{marginTop:0}}>Upload PDF BRI</h3><form onSubmit={doImport} className="form-grid">
      <div className="field"><label>Rekening tujuan</label><select className="select" value={accountId} onChange={e=>{setAccountId(e.target.value);void loadImports(e.target.value)}}><option value="">Deteksi otomatis dari nomor rekening PDF</option>{accounts.map(a=><option value={a.id} key={a.id}>{a.bank_name} • {a.account_number} • {a.account_name}</option>)}</select></div>
      <div className="field"><label>PDF Rekening Koran BRI</label><input id="bri-pdf-file" className="input" type="file" accept="application/pdf,.pdf" onChange={e=>setFile(e.target.files?.[0]||null)} required/></div>
      <div className="field full bank-import-upload-actions"><button className="btn btn-primary" disabled={busy||!file}>{busy?"Memproses PDF...":"↑ Import PDF BRI"}</button><span className="muted">Maks. 10 MB • PDF harus memiliki text layer (bukan hasil scan foto).</span></div>
    </form></div></section>}

    {result&&<section className="card" style={{marginBottom:16}}><div className="card-body"><h3 style={{marginTop:0}}>Hasil Import Terakhir</h3><div className="bank-import-metrics"><div className="bank-import-metric"><span>Periode</span><b>{date(result.period_from)} — {date(result.period_to)}</b></div><div className="bank-import-metric"><span>Saldo Awal BRI</span><b>Rp {money(result.opening_balance)}</b></div><div className="bank-import-metric"><span>Saldo Akhir BRI</span><b>Rp {money(result.closing_balance)}</b></div><div className="bank-import-metric"><span>Transaksi</span><b>{result.inserted_count} baru • {result.duplicate_count} duplikat</b></div></div>{result.warnings?.length>0&&<div className="notice" style={{marginTop:12}}><b>Peringatan parser:</b><ul>{result.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></div>}</div></section>}

    {latest&&<section className="card" style={{marginBottom:16}}><div className="card-body"><div className="page-head" style={{marginBottom:8}}><div><h3 style={{margin:0}}>Saldo Referensi BRI Terbaru</h3><p style={{marginBottom:0}}>Mengikuti import aktif dengan periode paling baru.</p></div><span className="badge">{date(latest.period_from)} — {date(latest.period_to)}</span></div><div className="bank-import-metrics"><div className="bank-import-metric"><span>Saldo Awal</span><b>Rp {money(latest.effective_opening_balance)}</b></div><div className="bank-import-metric"><span>Saldo Akhir</span><b>Rp {money(latest.effective_closing_balance)}</b></div><div className="bank-import-metric"><span>Total Debit</span><b>Rp {money(latest.total_debit)}</b></div><div className="bank-import-metric"><span>Total Kredit</span><b>Rp {money(latest.total_credit)}</b></div></div></div></section>}

    <section className="card"><div className="card-body"><div className="page-head"><div><h3 style={{margin:0}}>Riwayat Import</h3><p style={{marginBottom:0}}>Import diurutkan dari periode terbaru. Dokumen PDF juga otomatis disimpan sebagai Dokumen Bank.</p></div>{accountId&&<button className="btn btn-secondary" onClick={()=>{setAccountId("");void loadImports("")}}>Lihat Semua Rekening</button>}</div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Rekening / File</th><th>Periode</th><th>Saldo BRI</th><th>Transaksi</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{imports.map(row=><tr key={row.id}><td><b>{row.bank_name} • {row.account_number}</b><div className="muted">{row.original_name}</div><div className="muted">oleh {row.creator_name}</div></td><td>{date(row.period_from)}<br/>s.d. {date(row.period_to)}<div className="muted">Laporan {date(row.statement_date)}</div></td><td>Awal: <b>Rp {money(row.effective_opening_balance)}</b><br/>Akhir: <b>Rp {money(row.effective_closing_balance)}</b>{(row.manual_opening_balance!==null||row.manual_closing_balance!==null)&&<div className="muted">dikoreksi manual</div>}</td><td>{row.inserted_count} baru<br/>{row.duplicate_count} duplikat<div className="muted">{row.source_transaction_count} baris PDF</div></td><td><span className={`badge ${row.status==="ACTIVE"?"badge-success":""}`}>{row.status}</span>{row.undo_reason&&<div className="muted" style={{maxWidth:220}}>{row.undo_reason}</div>}</td><td>{canEdit&&row.status==="ACTIVE"?<div style={{display:"flex",gap:6,flexWrap:"wrap"}}><button className="btn btn-secondary" onClick={()=>openCorrection(row)}>Koreksi Saldo</button><button className="btn btn-danger" disabled={busy} onClick={()=>void undo(row)}>Undo</button></div>:"-"}</td></tr>)}{!imports.length&&<tr><td colSpan={6} style={{textAlign:"center",padding:28}} className="muted">Belum ada import rekening koran BRI.</td></tr>}</tbody></table></div>
    </div></section>

    {editing&&<div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&!busy&&setEditing(null)}><div className="modal"><div className="modal-head"><div><h3>Koreksi Saldo Referensi</h3><p>{date(editing.period_from)} — {date(editing.period_to)} • sumber PDF tetap tersimpan di Audit/riwayat.</p></div><button className="close-btn" onClick={()=>setEditing(null)}>×</button></div><div className="modal-body"><form onSubmit={saveCorrection} className="form-grid"><div className="field"><label>Saldo Awal</label><CurrencyInput value={opening} onValueChange={setOpening} allowDecimals required/></div><div className="field"><label>Saldo Akhir</label><CurrencyInput value={closing} onValueChange={setClosing} allowDecimals required/></div><div className="field full" style={{display:"flex",justifyContent:"flex-end",gap:8,flexDirection:"row"}}><button type="button" className="btn btn-secondary" onClick={()=>setEditing(null)}>Batal</button><button className="btn btn-primary" disabled={busy}>{busy?"Menyimpan...":"Simpan Koreksi"}</button></div></form></div></div></div>}
  </main>;
}
