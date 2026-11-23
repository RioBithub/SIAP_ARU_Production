"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Modal from "@/components/Modal";
import { ROLE_LABELS, type SessionUser } from "@/lib/types";

export const ACCOUNT_SWITCH_EVENT = "siap-account-switch";
const endpoint = "/api/auth/impersonation";

function useAccountChange(expectedTargetId: string | null) {
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");

  async function changeAccount(targetUserId: string | null) {
    setSwitching(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-SIAP-Account-Switch": "1" },
        body: JSON.stringify({ targetUserId, expectedTargetId }),
      });
      if (!response.ok && response.status !== 401 && response.status !== 409) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "Akun belum dapat diganti.");
      }
      if (response.ok) {
        try {
          window.localStorage.setItem(ACCOUNT_SWITCH_EVENT, String(Date.now()));
        } catch {
          // The current tab can still navigate when browser storage is blocked.
        }
      }
      // A fresh document drops the previous account's router cache and client state.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Akun belum dapat diganti.");
      setSwitching(false);
    }
  }

  return { changeAccount, switching, error, setError };
}

export function RestoreAccountButton({ targetId, children }: { targetId: string; children: React.ReactNode }) {
  const { changeAccount, switching, error } = useAccountChange(targetId);
  return <div className="account-mode-actions">
    <button type="button" className="btn btn-secondary" disabled={switching} onClick={() => void changeAccount(null)}>
      {switching ? "Memulihkan akun..." : children}
    </button>
    {error && <small role="alert">{error}</small>}
  </div>;
}

export default function AccountSwitcher({ targetId }: { targetId: string | null }) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<SessionUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const { changeAccount, switching, error, setError } = useAccountChange(targetId);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Daftar akun belum dapat dimuat.");
        if (!controller.signal.aborted) setAccounts(result.data);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Daftar akun belum dapat dimuat.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, setError]);

  function showAccounts() {
    setAccounts([]);
    setSearch("");
    setError("");
    setLoading(true);
    setOpen(true);
  }

  function closeAccounts() {
    if (switching) return;
    setOpen(false);
    trigger.current?.focus();
  }

  const query = search.trim().toLowerCase();
  const matches = accounts.filter(account => account.id !== targetId &&
    [account.name, account.alias, account.email, ROLE_LABELS[account.role], account.unit_name].some(value => value?.toLowerCase().includes(query))
  );

  return <>
    <button type="button" ref={trigger} className="btn btn-secondary account-switch-trigger"
      aria-haspopup="dialog" aria-expanded={open} onClick={showAccounts}>
      Ganti akun
    </button>
    {open && createPortal(<Modal title="Ganti akun" onClose={closeAccounts}>
      <div className="account-picker" onKeyDown={event => {
        if (event.key === "Escape") closeAccounts();
      }}>
        <input type="search" className="input" aria-label="Cari akun" placeholder="Cari nama, email, peran, atau unit"
          value={search} onChange={event => setSearch(event.target.value)} autoFocus />
        {error && <div className="error" role="alert">{error}</div>}
        {loading && <p className="hint" role="status">Memuat akun...</p>}
        {!loading && !error && !matches.length && <p className="hint">Akun tidak ditemukan.</p>}
        <div className="account-picker-list">
          {matches.map(account => <button type="button" key={account.id} className="account-picker-item"
            disabled={switching} onClick={() => void changeAccount(account.id)}>
            <strong>{account.name}</strong>
            <small>{account.alias || ROLE_LABELS[account.role]}{account.unit_name ? ` · ${account.unit_name}` : ""}</small>
            <span>{account.email}</span>
          </button>)}
        </div>
      </div>
    </Modal>, document.body)}
  </>;
}
