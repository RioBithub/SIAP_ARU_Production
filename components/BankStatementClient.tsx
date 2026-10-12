"use client";

import { useEffect,useMemo,useState } from "react";
import type { FormEvent } from "react";
import type { SessionUser } from "@/lib/types";

type Account={
  id:string;bank_name:string;account_name:string;account_number:string;product_name?:string|null;currency:string;
  branch_name?:string|null;unit_name?:string|null;company_address?:string|null;opening_balance:number;opening_balance_date:string;
};
type Tx={
  id:string;transaction_at:string;description:string;teller_id?:string|null;reference_no?:string|null;
  debit_amount:number;credit_amount:number;notes?:string|null;creator_name:string;balance:number;
};
type Statement={
  account:Account;period:{from:string;to:string};opening_balance:number;total_debit:number;total_credit:number;
  closing_balance:number;terbilang:string;generated_at:string;rows:Tx[];
};

type AccountForm={bank_name:string;account_name:string;account_number:string;product_name:string;currency:string;branch_name:string;unit_name:string;company_address:string;opening_balance:string;opening_balance_date:string};
type TxForm={transaction_at:string;description:string;teller_id:string;reference_no:string;kind:"DEBIT"|"CREDIT";amount:string;notes:string};

const pad=(n:number)=>String(n).padStart(2,"0");
function localDate(d=new Date()){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function localDateTime(d=new Date()){return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
function firstMonthDay(){const d=new Date();d.setDate(1);return localDate(d)}
function sqlDate(v?:string|null){return String(v||"").slice(0,10)}
function money(v:number){return new Intl.NumberFormat("id-ID",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0))}
function dateOnlyLabel(v:string){const d=new Date(`${v}T00:00:00`);return new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"2-digit",year:"numeric"}).format(d)}
function dateTimeLabel(v:string){const d=new Date(v);if(Number.isNaN(d.getTime()))return v;return new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(d).replace(",","")}
function toDateTimeInput(v:string){const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v).slice(0,16).replace(" ","T");return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
function emptyAccount():AccountForm{return {bank_name:"",account_name:"PT ARU RAHARJA",account_number:"",product_name:"Giro / Rekening Operasional",currency:"IDR",branch_name:"",unit_name:"PT Aru Raharja",company_address:"",opening_balance:"0",opening_balance_date:localDate()}}
function emptyTx():TxForm{return {transaction_at:localDateTime(),description:"",teller_id:"",reference_no:"",kind:"CREDIT",amount:"",notes:""}}

function Modal({title,subtitle,onClose,children}:{title:string;subtitle?:string;onClose:()=>void;children:React.ReactNode}){
  return <div className="modal-backdrop bank-statement-screen-only" onMouseDown={e=>e.target===e.currentTarget&&onClose()}>
    <div className="modal"><div className="modal-head"><div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div><button type="button" className="close-btn" onClick={onClose}>×</button></div><div className="modal-body">{children}</div></div>
  </div>;
}

export default function BankStatementClient({user}:{user:SessionUser}){
  const canEdit=user.role==="ROOT_ADMIN"||user.role==="FINANCE";
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [accountId,setAccountId]=useState("");
  const [from,setFrom]=useState(firstMonthDay());
  const [to,setTo]=useState(localDate());
  const [statement,setStatement]=useState<Statement|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [accountOpen,setAccountOpen]=useState(false);
  const [editingAccount,setEditingAccount]=useState<Account|null>(null);
  const [accountForm,setAccountForm]=useState<AccountForm>(emptyAccount());
  const [txOpen,setTxOpen]=useState(false);
  const [editingTx,setEditingTx]=useState<Tx|null>(null);
  const [txForm,setTxForm]=useState<TxForm>(emptyTx());
  const [voidTx,setVoidTx]=useState<Tx|null>(null);
  const [voidReason,setVoidReason]=useState("");
  const [saving,setSaving]=useState(false);

  async function loadStatement(id=accountId,f=from,t=to){
    if(!id){setStatement(null);return;}
    setLoading(true);setError("");
    try{
      const r=await fetch(`/api/finance/bank-statement?account_id=${encodeURIComponent(id)}&from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`,{cache:"no-store"});
      const j=await r.json();
      if(!j.ok) throw new Error(j.error||"Gagal memuat rekening koran.");
      setStatement(j.data);
    }catch(e){setStatement(null);setError(e instanceof Error?e.message:"Gagal memuat rekening koran.")}
    finally{setLoading(false)}
  }

  async function loadAccounts(preferId?:string){
    setError("");
    try{
      const r=await fetch("/api/finance/bank-accounts",{cache:"no-store"});const j=await r.json();
      if(!j.ok) throw new Error(j.error||"Gagal memuat rekening.");
      const list=(j.data||[]) as Account[];setAccounts(list);
      const chosen=preferId&&list.some(a=>a.id===preferId)?preferId:(accountId&&list.some(a=>a.id===accountId)?accountId:(list[0]?.id||""));
      setAccountId(chosen);
      if(chosen){
        const account=list.find(a=>a.id===chosen)!;
        const safeFrom=firstMonthDay()<sqlDate(account.opening_balance_date)?sqlDate(account.opening_balance_date):firstMonthDay();
        const nextFrom=from<sqlDate(account.opening_balance_date)?safeFrom:from;
        setFrom(nextFrom);
        await loadStatement(chosen,nextFrom,to);
      }else setStatement(null);
    }catch(e){setError(e instanceof Error?e.message:"Gagal memuat rekening.")}
  }

  useEffect(()=>{void loadAccounts()},[]);

  function setPreset(kind:"week"|"last7"|"month"|"lastweek"){
    const now=new Date();let start=new Date(now),end=new Date(now);
    const weekday=(now.getDay()+6)%7;
    if(kind==="week"){start.setDate(now.getDate()-weekday)}
    if(kind==="last7"){start.setDate(now.getDate()-6)}
    if(kind==="month"){start.setDate(1)}
    if(kind==="lastweek"){end.setDate(now.getDate()-weekday-1);start=new Date(end);start.setDate(end.getDate()-6)}
    let f=localDate(start),t=localDate(end);
    const account=accounts.find(a=>a.id===accountId);
    if(account&&f<sqlDate(account.opening_balance_date)) f=sqlDate(account.opening_balance_date);
    setFrom(f);setTo(t);void loadStatement(accountId,f,t);
  }

  function openAccount(account?:Account){
    if(account){setEditingAccount(account);setAccountForm({bank_name:account.bank_name,account_name:account.account_name,account_number:account.account_number,product_name:account.product_name||"",currency:account.currency||"IDR",branch_name:account.branch_name||"",unit_name:account.unit_name||"",company_address:account.company_address||"",opening_balance:String(account.opening_balance||0),opening_balance_date:sqlDate(account.opening_balance_date)})}
    else{setEditingAccount(null);setAccountForm(emptyAccount())}
    setAccountOpen(true);
  }

  async function saveAccount(e:FormEvent){
    e.preventDefault();setSaving(true);setError("");setMessage("");
    try{
      const url=editingAccount?`/api/finance/bank-accounts/${editingAccount.id}`:"/api/finance/bank-accounts";
      const r=await fetch(url,{method:editingAccount?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...accountForm,opening_balance:Number(accountForm.opening_balance||0)})});
      const j=await r.json();if(!j.ok)throw new Error(j.error||"Gagal menyimpan rekening.");
      const id=editingAccount?.id||j.data?.id;setAccountOpen(false);setMessage(editingAccount?"Data rekening diperbarui.":"Rekening ditambahkan.");await loadAccounts(id);
    }catch(e){setError(e instanceof Error?e.message:"Gagal menyimpan rekening.")}
    finally{setSaving(false)}
  }

  function openTx(tx?:Tx){
    if(tx){setEditingTx(tx);setTxForm({transaction_at:toDateTimeInput(tx.transaction_at),description:tx.description,teller_id:tx.teller_id||"",reference_no:tx.reference_no||"",kind:Number(tx.debit_amount)>0?"DEBIT":"CREDIT",amount:String(Number(tx.debit_amount)>0?tx.debit_amount:tx.credit_amount),notes:tx.notes||""})}
    else{setEditingTx(null);setTxForm(emptyTx())}
    setTxOpen(true);
  }

  async function saveTx(e:FormEvent){
    e.preventDefault();if(!accountId)return;setSaving(true);setError("");setMessage("");
    try{
      const value=Number(txForm.amount||0);
      const payload={bank_account_id:accountId,transaction_at:txForm.transaction_at,description:txForm.description,teller_id:txForm.teller_id,reference_no:txForm.reference_no,notes:txForm.notes,debit_amount:txForm.kind==="DEBIT"?value:0,credit_amount:txForm.kind==="CREDIT"?value:0};
      const url=editingTx?`/api/finance/bank-transactions/${editingTx.id}`:"/api/finance/bank-transactions";
      const r=await fetch(url,{method:editingTx?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const j=await r.json();
      if(!j.ok)throw new Error(j.error||"Gagal menyimpan transaksi.");
      setTxOpen(false);setMessage(editingTx?"Transaksi diperbarui.":"Transaksi ditambahkan.");await loadStatement();
    }catch(e){setError(e instanceof Error?e.message:"Gagal menyimpan transaksi.")}
    finally{setSaving(false)}
  }

  async function confirmVoid(e:FormEvent){
    e.preventDefault();if(!voidTx)return;setSaving(true);setError("");
    try{
      const r=await fetch(`/api/finance/bank-transactions/${voidTx.id}`,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason:voidReason})});const j=await r.json();
      if(!j.ok)throw new Error(j.error||"Gagal membatalkan transaksi.");
      setVoidTx(null);setVoidReason("");setMessage("Transaksi dibatalkan dan tetap tercatat pada Audit Log.");await loadStatement();
    }catch(e){setError(e instanceof Error?e.message:"Gagal membatalkan transaksi.")}
    finally{setSaving(false)}
  }

  const selected=accounts.find(a=>a.id===accountId)||null;
  const exportUrl=useMemo(()=>accountId?`/api/finance/bank-statement/export?account_id=${encodeURIComponent(accountId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`:"#",[accountId,from,to]);

  return <main className="page bank-statement-page">
    <style jsx global>{`
      .bank-filter-card{margin-bottom:16px}.bank-filter-grid{display:grid;grid-template-columns:1.4fr 1fr 1fr auto;gap:10px;align-items:end}.bank-quick-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}.bank-statement-print-area{background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);padding:28px;overflow:hidden;position:relative}.bank-statement-print-area:before{content:"ARU RAHARJA  •  ARU RAHARJA  •  ARU RAHARJA  •  ARU RAHARJA";position:absolute;left:-4%;right:-4%;top:43%;transform:rotate(-24deg);font-size:24px;letter-spacing:.16em;color:rgba(10,47,108,.035);font-weight:900;white-space:nowrap;pointer-events:none}.bank-statement-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:2px solid #c9e3ee;padding-bottom:16px;margin-bottom:16px;position:relative;z-index:1}.bank-statement-brand{display:flex;align-items:center;gap:13px}.bank-statement-brand img{width:72px;height:72px;object-fit:contain}.bank-statement-brand b{font-size:20px;color:var(--navy);display:block}.bank-statement-brand span{font-size:10px;color:var(--muted)}.bank-statement-title{text-align:right}.bank-statement-title h2{margin:0;font-size:18px;letter-spacing:.04em}.bank-statement-title p{margin:3px 0;color:var(--muted);font-size:9px;font-style:italic}.bank-statement-title small{display:block;margin-top:8px;font-size:9px}.bank-meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:15px;position:relative;z-index:1}.bank-meta{display:grid;grid-template-columns:125px 12px 1fr;gap:5px 7px;font-size:9.5px}.bank-meta span{color:#4e596a}.bank-meta b{font-weight:700}.bank-statement-table-wrap{overflow:auto;position:relative;z-index:1}.bank-statement-table{width:100%;border-collapse:collapse;min-width:850px}.bank-statement-table th{background:#bfe7f2;color:#244553;font-size:8.5px;padding:8px 7px;border:1px solid #d6edf3;text-align:center}.bank-statement-table td{font-size:8.8px;padding:7px;border-bottom:1px solid #e6edf2;vertical-align:top}.bank-statement-table .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.bank-statement-table .tx-desc{min-width:260px}.bank-statement-summary{display:grid;grid-template-columns:repeat(4,1fr);margin-top:13px;border:1px solid #cfe4ea;position:relative;z-index:1}.bank-statement-summary>div{text-align:center;border-right:1px solid #cfe4ea}.bank-statement-summary>div:last-child{border-right:0}.bank-statement-summary span{display:block;background:#c8eaf2;padding:5px;font-size:8.5px}.bank-statement-summary b{display:block;padding:8px;font-size:9.5px}.bank-terbilang{margin-top:9px;border:1px solid #dbe5eb;padding:8px 10px;font-size:8.5px;position:relative;z-index:1}.bank-terbilang b{display:block;margin-bottom:3px}.bank-statement-footer{display:flex;justify-content:space-between;gap:20px;margin-top:18px;padding-top:10px;border-top:1px solid #e4e9ee;font-size:8px;color:#7b8491;position:relative;z-index:1}.bank-statement-row-actions{display:flex;gap:5px;justify-content:flex-end;margin-top:3px}.bank-statement-row-actions button{font-size:8px;padding:4px 6px}.bank-empty{padding:40px;text-align:center;color:var(--muted)}
      @media(max-width:900px){.bank-filter-grid{grid-template-columns:1fr 1fr}.bank-filter-grid .bank-filter-account{grid-column:1/-1}.bank-meta-grid{grid-template-columns:1fr}.bank-statement-print-area{padding:18px}.bank-statement-summary{grid-template-columns:1fr 1fr}.bank-statement-summary>div:nth-child(2){border-right:0}.bank-statement-summary>div:nth-child(-n+2){border-bottom:1px solid #cfe4ea}}
      @media(max-width:560px){.bank-filter-grid{grid-template-columns:1fr}.bank-filter-grid .bank-filter-account{grid-column:auto}.bank-statement-head{flex-direction:column}.bank-statement-title{text-align:left}.bank-statement-summary{grid-template-columns:1fr}.bank-statement-summary>div{border-right:0;border-bottom:1px solid #cfe4ea}.bank-statement-summary>div:last-child{border-bottom:0}}
      @media print{@page{size:A4 portrait;margin:9mm}body{background:#fff!important}.sidebar,.topbar,.bank-statement-screen-only{display:none!important}.app-shell{display:block!important}.main-area{display:block!important}.bank-statement-page{padding:0!important;max-width:none!important}.bank-statement-print-area{border:0!important;border-radius:0!important;box-shadow:none!important;padding:0!important;overflow:visible!important}.bank-statement-table-wrap{overflow:visible!important}.bank-statement-table{min-width:0!important}.bank-statement-head{margin-top:0}.bank-statement-print-area:before{color:rgba(10,47,108,.025)!important}.bank-statement-row-actions{display:none!important}}
    `}</style>

    <div className="bank-statement-screen-only">
      <div className="page-head"><div><h2>Rekening Koran</h2><p>Input transaksi bank oleh Finance, filter periode bebas, laporan bergaya rekening koran, Excel, dan cetak/simpan PDF.</p></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{canEdit&&<><button className="btn btn-secondary" onClick={()=>openAccount(selected||undefined)}>{selected?"⚙ Data Rekening":"+ Tambah Rekening"}</button>{selected&&<button className="btn btn-primary" onClick={()=>openTx()}>+ Transaksi</button>}</>}</div></div>
      <div className="notice" style={{marginBottom:14}}><b>Akses:</b> Finance dan Root dapat input/koreksi transaksi. Direktur Operasional dan Direktur Utama bersifat view-only. Pembatalan transaksi tidak menghapus histori; jejaknya masuk Audit Log.</div>
      {message&&<div className="success" style={{marginBottom:12}}>{message}</div>}{error&&<div className="error" style={{marginBottom:12}}>{error}</div>}
      <section className="card bank-filter-card"><div className="card-body">
        <div className="bank-filter-grid">
          <div className="field bank-filter-account"><label>Rekening</label><select className="select" value={accountId} onChange={e=>{const id=e.target.value;setAccountId(id);const a=accounts.find(x=>x.id===id);let f=from;if(a&&f<sqlDate(a.opening_balance_date)){f=sqlDate(a.opening_balance_date);setFrom(f)}void loadStatement(id,f,to)}}><option value="">Pilih rekening...</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.bank_name} • {a.account_number} • {a.account_name}</option>)}</select></div>
          <div className="field"><label>Dari tanggal</label><input className="input" type="date" value={from} min={selected?sqlDate(selected.opening_balance_date):undefined} onChange={e=>setFrom(e.target.value)}/></div>
          <div className="field"><label>Sampai tanggal</label><input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
          <button className="btn btn-primary" disabled={!accountId||loading} onClick={()=>void loadStatement()}>Terapkan</button>
        </div>
        <div className="bank-quick-actions"><button className="btn-mini" onClick={()=>setPreset("week")}>Minggu Ini</button><button className="btn-mini" onClick={()=>setPreset("lastweek")}>Minggu Lalu</button><button className="btn-mini" onClick={()=>setPreset("last7")}>7 Hari Terakhir</button><button className="btn-mini" onClick={()=>setPreset("month")}>Bulan Ini</button><span style={{flex:1}}/><a className={`btn btn-secondary ${!statement?"disabled":""}`} href={statement?exportUrl:undefined}>↓ Download Excel</a><button className="btn btn-secondary" disabled={!statement} onClick={()=>window.print()}>⎙ Cetak / Simpan PDF</button></div>
      </div></section>
    </div>

    {!accounts.length&&!loading?<div className="card bank-empty"><b>Belum ada rekening bank.</b><p>Finance/Root dapat menambahkan rekening perusahaan untuk mulai mencatat transaksi.</p>{canEdit&&<button className="btn btn-primary" onClick={()=>openAccount()}>+ Tambah Rekening</button>}</div>:loading&&!statement?<div className="card bank-empty">Memuat rekening koran...</div>:statement&&<section className="bank-statement-print-area">
      <header className="bank-statement-head"><div className="bank-statement-brand"><img src="/aru-logo.png" alt="ARU Raharja"/><div><b>PT ARU RAHARJA</b><span>Sistem Informasi ARU Terintegrasi</span></div></div><div className="bank-statement-title"><h2>REKENING KORAN</h2><p>STATEMENT OF FINANCIAL TRANSACTION</p><small>Tanggal Laporan: {dateTimeLabel(statement.generated_at)}</small></div></header>
      <div className="bank-meta-grid"><div className="bank-meta"><span>Kepada Yth.</span><i>:</i><b>{statement.account.account_name}</b><span>Alamat</span><i>:</i><b>{statement.account.company_address||"-"}</b><span>No. Rekening</span><i>:</i><b>{statement.account.account_number}</b><span>Nama Bank</span><i>:</i><b>{statement.account.bank_name}</b><span>Nama Produk</span><i>:</i><b>{statement.account.product_name||"-"}</b><span>Valuta</span><i>:</i><b>{statement.account.currency}</b></div><div className="bank-meta"><span>Periode Transaksi</span><i>:</i><b>{dateOnlyLabel(statement.period.from)} s.d. {dateOnlyLabel(statement.period.to)}</b><span>Unit / Kantor</span><i>:</i><b>{statement.account.unit_name||"PT Aru Raharja"}</b><span>Cabang Bank</span><i>:</i><b>{statement.account.branch_name||"-"}</b><span>Saldo Awal Dasar</span><i>:</i><b>{money(statement.account.opening_balance)}</b><span>Tanggal Saldo Dasar</span><i>:</i><b>{dateOnlyLabel(sqlDate(statement.account.opening_balance_date))}</b></div></div>
      <div className="bank-statement-table-wrap"><table className="bank-statement-table"><thead><tr><th>Tanggal Transaksi<br/><small>Transaction Date</small></th><th>Uraian Transaksi<br/><small>Transaction Description</small></th><th>Teller / User ID</th><th>Debit</th><th>Kredit<br/><small>Credit</small></th><th>Saldo<br/><small>Balance</small></th>{canEdit&&<th className="bank-statement-screen-only">Aksi</th>}</tr></thead><tbody>{statement.rows.map(r=><tr key={r.id}><td>{dateTimeLabel(r.transaction_at)}</td><td className="tx-desc"><b>{r.description}</b>{r.reference_no&&<div className="muted" style={{marginTop:3}}>Ref: {r.reference_no}</div>}{r.notes&&<div className="muted" style={{marginTop:2}}>{r.notes}</div>}</td><td>{r.teller_id||r.creator_name||"-"}</td><td className="num">{money(r.debit_amount)}</td><td className="num">{money(r.credit_amount)}</td><td className="num"><b>{money(r.balance)}</b></td>{canEdit&&<td className="bank-statement-screen-only"><div className="bank-statement-row-actions"><button className="btn btn-secondary" onClick={()=>openTx(r)}>Edit</button><button className="btn btn-danger" onClick={()=>{setVoidTx(r);setVoidReason("")}}>Batalkan</button></div></td>}</tr>)}{!statement.rows.length&&<tr><td colSpan={canEdit?7:6} style={{textAlign:"center",padding:26,color:"var(--muted)"}}>Tidak ada transaksi pada periode ini.</td></tr>}</tbody></table></div>
      <div className="bank-statement-summary"><div><span>Saldo Awal<br/><small>Opening Balance</small></span><b>{money(statement.opening_balance)}</b></div><div><span>Total Transaksi Debit</span><b>{money(statement.total_debit)}</b></div><div><span>Total Transaksi Kredit</span><b>{money(statement.total_credit)}</b></div><div><span>Saldo Akhir<br/><small>Closing Balance</small></span><b>{money(statement.closing_balance)}</b></div></div>
      <div className="bank-terbilang"><b>Terbilang / In Words</b>{statement.terbilang}</div>
      <footer className="bank-statement-footer"><span>Dokumen internal PT Aru Raharja • Data berasal dari SIAP ARU.</span><span>Generated: {dateTimeLabel(statement.generated_at)}</span></footer>
    </section>}

    {accountOpen&&<Modal title={editingAccount?"Ubah Data Rekening":"Tambah Rekening"} subtitle="Data ini tampil pada header rekening koran." onClose={()=>!saving&&setAccountOpen(false)}><form className="form-grid" onSubmit={saveAccount}>
      <div className="field"><label>Nama Bank</label><input className="input" value={accountForm.bank_name} onChange={e=>setAccountForm({...accountForm,bank_name:e.target.value})} placeholder="Contoh: BRI" required/></div><div className="field"><label>Nomor Rekening</label><input className="input" value={accountForm.account_number} onChange={e=>setAccountForm({...accountForm,account_number:e.target.value})} required/></div>
      <div className="field full"><label>Nama Rekening</label><input className="input" value={accountForm.account_name} onChange={e=>setAccountForm({...accountForm,account_name:e.target.value})} required/></div>
      <div className="field"><label>Nama Produk</label><input className="input" value={accountForm.product_name} onChange={e=>setAccountForm({...accountForm,product_name:e.target.value})} placeholder="Giro / Rekening Operasional"/></div><div className="field"><label>Valuta</label><input className="input" value={accountForm.currency} onChange={e=>setAccountForm({...accountForm,currency:e.target.value.toUpperCase()})} maxLength={10}/></div>
      <div className="field"><label>Cabang Bank</label><input className="input" value={accountForm.branch_name} onChange={e=>setAccountForm({...accountForm,branch_name:e.target.value})}/></div><div className="field"><label>Unit / Kantor</label><input className="input" value={accountForm.unit_name} onChange={e=>setAccountForm({...accountForm,unit_name:e.target.value})}/></div>
      <div className="field full"><label>Alamat Perusahaan</label><textarea className="textarea" value={accountForm.company_address} onChange={e=>setAccountForm({...accountForm,company_address:e.target.value})}/></div>
      <div className="field"><label>Tanggal Saldo Awal</label><input className="input" type="date" value={accountForm.opening_balance_date} onChange={e=>setAccountForm({...accountForm,opening_balance_date:e.target.value})} required/></div><div className="field"><label>Saldo Awal</label><input className="input" type="number" min="0" step="0.01" value={accountForm.opening_balance} onChange={e=>setAccountForm({...accountForm,opening_balance:e.target.value})} required/></div>
      <div className="field full" style={{display:"flex",justifyContent:"flex-end",gap:8,flexDirection:"row"}}><button type="button" className="btn btn-secondary" onClick={()=>setAccountOpen(false)}>Batal</button><button className="btn btn-primary" disabled={saving}>{saving?"Menyimpan...":"Simpan Rekening"}</button></div>
    </form></Modal>}

    {txOpen&&<Modal title={editingTx?"Ubah Transaksi":"Tambah Transaksi Bank"} subtitle="Debit mengurangi saldo, Kredit menambah saldo." onClose={()=>!saving&&setTxOpen(false)}><form className="form-grid" onSubmit={saveTx}>
      <div className="field"><label>Tanggal & Waktu Transaksi</label><input className="input" type="datetime-local" value={txForm.transaction_at} onChange={e=>setTxForm({...txForm,transaction_at:e.target.value})} required/></div><div className="field"><label>Jenis</label><select className="select" value={txForm.kind} onChange={e=>setTxForm({...txForm,kind:e.target.value as "DEBIT"|"CREDIT"})}><option value="CREDIT">Kredit / Uang Masuk</option><option value="DEBIT">Debit / Uang Keluar</option></select></div>
      <div className="field full"><label>Uraian Transaksi</label><input className="input" value={txForm.description} onChange={e=>setTxForm({...txForm,description:e.target.value})} placeholder="Contoh: Pembayaran customer / transfer vendor" required/></div>
      <div className="field"><label>Nominal</label><input className="input" type="number" min="0.01" step="0.01" value={txForm.amount} onChange={e=>setTxForm({...txForm,amount:e.target.value})} required/></div><div className="field"><label>Teller / User ID</label><input className="input" value={txForm.teller_id} onChange={e=>setTxForm({...txForm,teller_id:e.target.value})} placeholder="Opsional"/></div>
      <div className="field"><label>No. Referensi</label><input className="input" value={txForm.reference_no} onChange={e=>setTxForm({...txForm,reference_no:e.target.value})}/></div><div className="field"><label>Catatan</label><input className="input" value={txForm.notes} onChange={e=>setTxForm({...txForm,notes:e.target.value})}/></div>
      <div className="field full" style={{display:"flex",justifyContent:"flex-end",gap:8,flexDirection:"row"}}><button type="button" className="btn btn-secondary" onClick={()=>setTxOpen(false)}>Batal</button><button className="btn btn-primary" disabled={saving}>{saving?"Menyimpan...":"Simpan Transaksi"}</button></div>
    </form></Modal>}

    {voidTx&&<Modal title="Batalkan Transaksi" subtitle="Transaksi tidak dihapus; status menjadi VOIDED dan tetap tercatat pada Audit Log." onClose={()=>!saving&&setVoidTx(null)}><form onSubmit={confirmVoid}><div className="notice" style={{marginBottom:12}}><b>{voidTx.description}</b><br/>{dateTimeLabel(voidTx.transaction_at)} • {Number(voidTx.debit_amount)>0?`Debit ${money(voidTx.debit_amount)}`:`Kredit ${money(voidTx.credit_amount)}`}</div><div className="field"><label>Alasan pembatalan</label><textarea className="textarea" value={voidReason} onChange={e=>setVoidReason(e.target.value)} required placeholder="Jelaskan alasan koreksi/pembatalan..."/></div><div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14}}><button type="button" className="btn btn-secondary" onClick={()=>setVoidTx(null)}>Batal</button><button className="btn btn-danger" disabled={saving}>{saving?"Memproses...":"Batalkan Transaksi"}</button></div></form></Modal>}
  </main>;
}
