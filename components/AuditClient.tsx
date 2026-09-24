"use client";
import { useEffect,useState } from "react";
export default function AuditClient(){
  const [rows,setRows]=useState<any[]>([]);const [q,setQ]=useState("");const [error,setError]=useState("");
  async function load(){const r=await fetch(`/api/audit?q=${encodeURIComponent(q)}`);const j=await r.json();if(j.ok)setRows(j.data);else setError(j.error)}
  useEffect(()=>{load()},[]);
  return <main className="page">
    <div className="page-head"><div><h2>Audit Log</h2><p>Log sistem tidak disembunyikan dari Root Admin: auth, surat, disposisi, file, finance, user, dan konfigurasi.</p></div></div>
    {error&&<div className="error" style={{marginBottom:12}}>{error}</div>}
    <div className="toolbar"><div className="search"><span>⌕</span><input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load()} placeholder="Cari action, entity, user..."/></div><button className="btn btn-secondary" onClick={load}>Cari</button></div>
    <div className="card"><div className="table-wrap"><table className="table"><thead><tr><th>Waktu</th><th>User</th><th>Action</th><th>Entity</th><th>ID</th><th>IP</th><th>Metadata</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.id}><td className="nowrap">{new Date(r.created_at).toLocaleString("id-ID")}</td><td>{r.user_name||"System"}<span className="muted" style={{display:"block",fontSize:9}}>{r.user_email||""}</span></td><td><b>{r.action}</b></td><td>{r.entity_type}</td><td className="mono" style={{maxWidth:120,overflow:"hidden",textOverflow:"ellipsis"}}>{r.entity_id||"-"}</td><td>{r.ip_address||"-"}</td><td className="mono" style={{maxWidth:330,whiteSpace:"pre-wrap",fontSize:9}}>{r.metadata_json?JSON.stringify(typeof r.metadata_json==="string"?JSON.parse(r.metadata_json):r.metadata_json):"-"}</td></tr>)}
      {!rows.length&&<tr><td colSpan={7}><div className="empty">Belum ada log.</div></td></tr>}
    </tbody></table></div></div>
  </main>
}
