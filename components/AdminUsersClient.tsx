"use client";
import { FormEvent,useEffect,useState } from "react";
import Modal from "@/components/Modal";
import StatusBadge from "@/components/StatusBadge";
import { useAppDialog } from "@/components/AppDialogProvider";

const roles=["ROOT_ADMIN","STAFF","MANAGER","DIRECTOR_OPS","PRESIDENT_DIRECTOR","FINANCE"];
export default function AdminUsersClient(){
  const dialog=useAppDialog();
  const [rows,setRows]=useState<any[]>([]);const [open,setOpen]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");
  async function load(){const r=await fetch("/api/admin/users");const j=await r.json();if(j.ok)setRows(j.data);else setError(j.error)}
  useEffect(()=>{load()},[]);
  async function create(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);const r=await fetch("/api/admin/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(fd.entries()))});const j=await r.json();if(!r.ok){setError(j.error);return}setOpen(false);setMessage("User berhasil dibuat.");await load()}
  async function toggle(u:any){const ok=await dialog.confirm({title:u.is_active?"Nonaktifkan User":"Aktifkan User",message:u.is_active?`Akun ${u.name} tidak dapat login sampai diaktifkan kembali.`:`Akun ${u.name} akan dapat login kembali.`,confirmLabel:u.is_active?"Nonaktifkan":"Aktifkan",tone:u.is_active?"danger":"success"});if(!ok)return;const r=await fetch(`/api/admin/users/${u.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({is_active:!u.is_active})});const j=await r.json();if(!r.ok){setError(j.error);return}setMessage(`User ${u.is_active?"dinonaktifkan":"diaktifkan"}.`);await load()}
  async function reset(u:any){const password=await dialog.prompt({title:"Reset Password",message:`Buat password baru untuk ${u.name}.`,detail:"Password minimal 10 karakter. Aktivitas reset tetap tercatat di Audit Log.",label:"Password baru",inputType:"password",required:true,confirmLabel:"Reset Password"});if(!password)return;if(password.length<10){setError("Password minimal 10 karakter.");return}const r=await fetch(`/api/admin/users/${u.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});const j=await r.json();if(!r.ok){setError(j.error);return}setMessage("Password berhasil direset.")}
  async function changeRole(u:any){const role=await dialog.select({title:"Ubah Role",message:`Pilih role baru untuk ${u.name}.`,label:"Role",options:roles.map(x=>({value:x,label:x})),initialValue:u.role,required:true,confirmLabel:"Simpan Role"});if(!role)return;const r=await fetch(`/api/admin/users/${u.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({role})});const j=await r.json();if(!r.ok){setError(j.error);return}setMessage("Role berhasil diubah.");await load()}
  return <main className="page">
    <div className="page-head"><div><h2>User & Role</h2><p>Root Admin dapat membuat user, mengubah role, reset password, dan menonaktifkan akun.</p></div><button className="btn btn-primary" onClick={()=>setOpen(true)}>+ Tambah User</button></div>
    {message&&<div className="success" style={{marginBottom:12}}>{message}</div>}{error&&<div className="error" style={{marginBottom:12}}>{error}</div>}
    <div className="card"><div className="table-wrap"><table className="table"><thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Unit</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
      {rows.map(u=><tr key={u.id}><td><b>{u.name}</b></td><td>{u.email}</td><td><span className="badge blue">{u.role}</span></td><td>{u.unit_name||"-"}</td><td><StatusBadge status={u.is_active?"ACTIVE":"DISABLED"}/></td><td><div style={{display:"flex",gap:6,flexWrap:"wrap"}}><button className="btn btn-secondary" onClick={()=>changeRole(u)}>Role</button><button className="btn btn-secondary" onClick={()=>reset(u)}>Reset Password</button><button className={`btn ${u.is_active?"btn-danger":"btn-success"}`} onClick={()=>toggle(u)}>{u.is_active?"Disable":"Enable"}</button></div></td></tr>)}
    </tbody></table></div></div>
    {open&&<Modal title="Tambah User" subtitle="Password minimal 10 karakter." onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={create}>
      <div className="field"><label>Nama</label><input className="input" name="name" required/></div>
      <div className="field"><label>Email</label><input className="input" type="email" name="email" required/></div>
      <div className="field"><label>Role</label><select className="select" name="role">{roles.map(r=><option key={r}>{r}</option>)}</select></div>
      <div className="field"><label>Unit</label><input className="input" name="unit_name"/></div>
      <div className="field full"><label>Password Awal</label><input className="input" type="password" name="password" minLength={10} required/></div>
      <div className="field full" style={{display:"flex",flexDirection:"row",justifyContent:"flex-end",gap:8}}><button type="button" className="btn btn-secondary" onClick={()=>setOpen(false)}>Batal</button><button className="btn btn-primary">Buat User</button></div>
    </form></Modal>}
  </main>
}
