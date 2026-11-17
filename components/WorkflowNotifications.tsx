"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Modal from "@/components/Modal";

type Notice = { id: string; title: string; subject: string; href: string; created_at: string; read_at: string | null };

export default function WorkflowNotifications() {
  const [data, setData] = useState<{ enabled: boolean; unread: number; items: Notice[] }>({ enabled: false, unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch("/api/notifications", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Notifikasi belum dapat dimuat.");
        const json = await response.json();
        setData(json.data);
        setError("");
      } catch {
        if (!controller.signal.aborted) setError("Notifikasi belum dapat dimuat.");
      } finally {
        loading = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15_000);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  async function openNotice(notice: Notice) {
    try {
      const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: notice.id }) });
      if (!response.ok) throw new Error();
      window.location.assign(notice.href);
    } catch {
      setError("Notifikasi belum dapat ditandai dibaca. Coba kembali.");
    }
  }

  if (!data.enabled && !error) return null;
  return <>
    <button className="btn btn-secondary notification-trigger" onClick={() => setOpen(true)}
      aria-label={`Notifikasi, ${data.unread} belum dibaca`}>
      <span aria-hidden="true">🔔</span><span className="notification-label">Notifikasi</span>
      {data.unread > 0 && <span aria-hidden="true">{data.unread}</span>}
    </button>
    {open && createPortal(<Modal title="Notifikasi" onClose={() => setOpen(false)}>
      {error && <p role="status" className="notice">{error}</p>}
      {!data.items.length && !error && <p>Belum ada notifikasi.</p>}
      <div className="notification-list">
        {data.items.map(notice => <button className={"notification-item" + (notice.read_at ? " read" : "")}
          key={notice.id} onClick={() => void openNotice(notice)}>
          <b>{notice.title}</b>
          <span>{notice.subject}</span>
          <small>{new Date(notice.created_at).toLocaleString("id-ID")}{notice.read_at ? " · Dibaca" : " · Belum dibaca"}</small>
        </button>)}
      </div>
    </Modal>, document.body)}
  </>;
}
