"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { SessionUser } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/types";

type Item = { href:string; label:string; icon:string; roles?:string[] };

export default function AppShell({ user, children }:{user:SessionUser;children:React.ReactNode}) {
  const pathname=usePathname();
  const router=useRouter();
  const [open,setOpen]=useState(false);

  const groups:{label:string;items:Item[]}[]=[
    {label:"Utama",items:[{href:"/dashboard",label:"Dashboard",icon:"⌂"}]},
    {label:"Persuratan",items:[
      {href:"/letters/incoming",label:"Surat Masuk",icon:"✉"},
      {href:"/letters/internal",label:"Nota Dinas",icon:"↥"},
      {href:"/letters/outgoing",label:"Surat Keluar",icon:"⇢"},
      {href:"/dispositions",label:"Disposisi",icon:"↗"},
      {href:"/archive",label:"Arsip Dokumen",icon:"▰"},
    ]},
    {label:"Keuangan",items:[
      {href:"/finance",label:"Ringkasan & Dokumen",icon:"▥",roles:["ROOT_ADMIN","FINANCE","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR"]},
      {href:"/finance/receivables",label:"Piutang",icon:"⇢",roles:["ROOT_ADMIN","FINANCE","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR"]},
      {href:"/finance/payables",label:"Utang",icon:"⇠",roles:["ROOT_ADMIN","FINANCE","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR"]},
      {href:"/finance/aging",label:"Aging & Jatuh Tempo",icon:"⌛",roles:["ROOT_ADMIN","FINANCE","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR"]},
    ]},
    {label:"Administrasi",items:[
      {href:"/admin/users",label:"User & Role",icon:"♟",roles:["ROOT_ADMIN"]},
      {href:"/admin/number-formats",label:"Format Nomor Surat",icon:"#",roles:["ROOT_ADMIN"]},
      {href:"/audit",label:"Audit Log",icon:"▤",roles:["ROOT_ADMIN"]},
    ]}
  ];

  async function logout(){
    await fetch("/api/auth/logout",{method:"POST"});
    router.push("/login");
    router.refresh();
  }

  const visibleItems = groups.flatMap(g=>g.items.filter(i=>!i.roles||i.roles.includes(user.role)));
  const activeHref = visibleItems
    .filter(i=>pathname===i.href || pathname.startsWith(i.href+"/"))
    .sort((a,b)=>b.href.length-a.href.length)[0]?.href || "";

  return <div className="app-shell">
    {open && <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,background:"rgba(5,18,42,.5)",zIndex:25}}/>}
    <aside className={`sidebar ${open?"open":""}`}>
      <div className="brand">
        <img src="/aru-logo.png" alt="ARU"/>
        <div><b>SIAP ARU</b><small>Sistem Informasi ARU Terintegrasi</small></div>
      </div>
      {groups.map(g=>{
        const visible=g.items.filter(i=>!i.roles||i.roles.includes(user.role));
        if(!visible.length) return null;
        return <div className="nav-group" key={g.label}>
          <div className="nav-label">{g.label}</div>
          {visible.map(i=>{
            const active=activeHref===i.href;
            return <a className={`nav-link ${active?"active":""}`} href={i.href} key={i.href} onClick={()=>setOpen(false)}>
              <span className="nav-icon">{i.icon}</span>{i.label}
            </a>
          })}
        </div>
      })}
      <div className="sidebar-note">
        <b>{ROLE_LABELS[user.role]}</b>
        <p>{user.unit_name || "PT Aru Raharja"}<br/>{user.email}</p>
      </div>
    </aside>
    <div className="main-area">
      <header className="topbar">
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button className="icon-btn mobile-menu" onClick={()=>setOpen(true)}>☰</button>
          <div className="top-title"><h1>SIAP ARU</h1><p>Persuratan, Disposisi, dan Informasi Keuangan</p></div>
        </div>
        <div className="top-right">
          <div className="user-chip"><div className="avatar">{user.name.slice(0,2).toUpperCase()}</div><div><b>{user.name}</b><small>{ROLE_LABELS[user.role]}</small></div></div>
          <button className="btn btn-secondary" onClick={logout}>Keluar</button>
        </div>
      </header>
      {children}
    </div>
  </div>
}
