"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import type { AccountIdentity } from "@/lib/account-profile";

export default function AccountProfileDialog({ account, admin = false, onClose, onSaved }: {
  account: AccountIdentity & { id: string };
  admin?: boolean;
  onClose: () => void;
  onSaved?: (identity: AccountIdentity) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const body = { name: form.get("name"), ...(admin ? { email: form.get("email") } : {}) };
    setBusy(true);
    setError("");
    try {
      const response = await fetch(admin ? "/api/admin/users/" + encodeURIComponent(account.id) : "/api/auth/me", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Profil belum dapat disimpan.");
      onSaved?.(result.data);
      router.refresh();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profil belum dapat disimpan.");
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={admin ? "Edit Profil Pengguna" : "Profil Saya"} onClose={() => { if (!busy) onClose(); }}>
    <form className="form-grid workflow-form" onSubmit={submit}>
      <label className="field full"><span>Nama</span>
        <input className="input" name="name" autoComplete="name" defaultValue={account.name} maxLength={150} required disabled={busy}/>
      </label>
      {admin ? <label className="field full"><span>Email login</span>
        <input className="input" name="email" type="email" autoComplete="off" defaultValue={account.email} maxLength={190} required disabled={busy}/>
      </label> : <div className="field full"><small className="muted">Email login</small><b>{account.email}</b>
        <small className="hint">Perubahan email dilakukan oleh Root Admin.</small>
      </div>}
      {error && <p className="field full error" role="alert">{error}</p>}
      <div className="field full modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Batal</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? "Menyimpan…" : "Simpan Profil"}</button>
      </div>
    </form>
  </Modal>;
}
