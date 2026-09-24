"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage(){
  const router=useRouter();
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);

  async function submit(e:FormEvent){
    e.preventDefault(); setError(""); setLoading(true);
    try{
      const res=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})});
      const json=await res.json();
      if(!res.ok) throw new Error(json.error||"Login gagal.");
      router.push("/dashboard"); router.refresh();
    }catch(err){setError(err instanceof Error?err.message:"Login gagal.");}
    finally{setLoading(false);}
  }

  return <main className="login-page">
    <form className="login-card" onSubmit={submit}>
      <div className="login-brand"><img src="/aru-logo.png" alt="ARU"/><div><h1>SIAP ARU</h1><p>Sistem Informasi ARU Terintegrasi</p></div></div>
      {error&&<div className="error" style={{marginBottom:12}}>{error}</div>}
      <div className="login-form">
        <div className="field"><label>Email</label><input className="input" value={email} onChange={e=>setEmail(e.target.value)} type="email" required/></div>
        <div className="field"><label>Password</label><input className="input" value={password} onChange={e=>setPassword(e.target.value)} type="password" required/></div>
        <button className="btn btn-primary" disabled={loading}>{loading?"Masuk...":"Masuk ke SIAP"}</button>
      </div>
    </form>
  </main>
}
