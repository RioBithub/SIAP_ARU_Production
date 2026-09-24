"use client";
import { useEffect,useState } from "react";
export default function ArchiveClient(){
  const [rows,setRows]=useState<any[]>([]);const [q,setQ]=useState("");const [error,setError]=useState("");
  async function load(){const r=await fetch(`/api/archive?q=${encodeURIComponent(q)}`);const j=await r.json();if(j.ok)setRows(j.data);else setError(j.error)}
  useEffect(()=>{load()},[]);
  const size=(n:number)=>n<1024*1024?`${Math.round(n/1024)} KB`:`${(n/1024/1024).toFixed(2)} MB`;
  return <main className="page"><div className="page-head"><div><h2>Arsip Dokumen</h2><p>Surat asli dan lampiran tambahan tersimpan di storage private, bukan public folder.</p></div></div>
    {error&&<div className="error">{error}</div>}
    <div className="toolbar"><div className="search"><span>⌕</span><input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load()} placeholder="Cari nama file, nomor surat, perihal..."/></div><button className="btn btn-secondary" onClick={load}>Cari</button></div>
    <div className="card"><div className="table-wrap"><table className="table"><thead><tr><th>File</th><th>Surat</th><th>Jenis</th><th>Ukuran Asli</th><th>Stored</th><th>Kompresi</th><th>Tanggal</th><th></th></tr></thead><tbody>
      {rows.map(a=><tr key={a.id}><td><b>{a.original_name}</b></td><td>{a.letter_number||a.external_number||"-"}<span className="muted" style={{display:"block",fontSize:9}}>{a.subject}</span></td><td>{a.attachment_kind}</td><td>{size(Number(a.original_size))}</td><td>{size(Number(a.stored_size))}</td><td><span className={`badge ${a.is_compressed?"green":"gray"}`}>{a.is_compressed?"GZIP":"ORIGINAL"}</span></td><td>{new Date(a.created_at).toLocaleString("id-ID")}</td><td><a className="btn btn-secondary" href={`/api/attachments/${a.id}`}>Download</a></td></tr>)}
      {!rows.length&&<tr><td colSpan={8}><div className="empty">Belum ada arsip.</div></td></tr>}
    </tbody></table></div></div>
  </main>
}
