"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Modal from "@/components/Modal";
import { statusLabel } from "@/components/StatusBadge";
import { dispositionDeadline, formatWorkflowTime } from "@/lib/workflow-time";

type Notice = {
  id: string; title: string; subject: string; document_number: string | null; href: string;
  created_at: string; read_at: string | null; actor_name: string | null; event_status: string | null;
  entity_type: "LETTER" | "DISPOSITION"; priority: string | null; due_date: string | null;
  due_time: string | null; note: string | null;
};

export default function WorkflowNotifications() {
  const [data, setData] = useState<{ enabled: boolean; unread: number; items: Notice[] }>({ enabled: false, unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [error, setError] = useState("");
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function refresh() {
      if (loading || marking) return;
      loading = true;
      try {
        const response = await fetch("/api/notifications", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Notifikasi belum dapat dimuat.");
        const json = await response.json();
        if (!controller.signal.aborted) { setData(json.data); setError(""); }
      } catch {
        if (!controller.signal.aborted) setError("Notifikasi belum dapat dimuat.");
      } finally {
        loading = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("siap-notification-change", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("siap-notification-change", refresh);
    };
  }, [open, marking]);

  async function mark(id?: string) {
    const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id } : { all: true }) });
    if (!response.ok) throw new Error("Notifikasi belum dapat ditandai dibaca.");
  }

  async function markAll() {
    setMarking(true);
    setError("");
    try {
      await mark();
      const readAt = new Date().toISOString();
      setData(current => ({ ...current, unread: 0, items: current.items.map(item => ({ ...item, read_at: item.read_at || readAt })) }));
    } catch { setError("Notifikasi belum dapat ditandai dibaca."); }
    finally { setMarking(false); }
  }

  const items = onlyUnread ? data.items.filter(notice => !notice.read_at) : data.items;
  if (!data.enabled && !error) return null;
  return <>
    <button className="btn btn-secondary notification-trigger" onClick={() => setOpen(true)}
      aria-label={`Notifikasi, ${data.unread} belum dibaca`}>
      <span aria-hidden="true">🔔</span><span className="notification-label">Notifikasi</span>
      {data.unread > 0 && <span className="notification-count" aria-hidden="true">{data.unread}</span>}
    </button>
    <span className="workflow-sr-only" aria-live="polite">{data.unread ? `${data.unread} notifikasi belum dibaca` : ""}</span>
    {open && createPortal(<Modal title="Notifikasi" onClose={() => setOpen(false)}>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="notification-toolbar">
        <button className="btn btn-secondary" aria-pressed={onlyUnread}
          onClick={() => setOnlyUnread(!onlyUnread)}>{onlyUnread ? "Tampilkan semua" : "Belum dibaca"}</button>
        <button className="btn btn-secondary" disabled={!data.unread || marking}
          onClick={() => void markAll()}>Tandai semua dibaca</button>
      </div>
      {!items.length && !error && <p className="empty">{onlyUnread ? "Semua notifikasi sudah dibaca." : "Belum ada notifikasi."}</p>}
      <div className="notification-list">
        {items.map(notice => <a className={"notification-item" + (notice.read_at ? " read" : "")}
          key={notice.id} href={notice.href}
          onClick={event => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || notice.read_at) return;
            event.preventDefault();
            void mark(notice.id).finally(() => window.location.assign(notice.href)).catch(() => {});
          }}>
          <span className="notification-item-heading">
            <b>{notice.title}</b>
            {!notice.read_at && <span className="badge blue">Baru</span>}
          </span>
          <span>{[notice.document_number, notice.subject].filter(Boolean).join(" · ")}</span>
          <small>{[notice.entity_type === "DISPOSITION" ? "Disposisi" : "Persuratan", notice.actor_name,
            notice.event_status && statusLabel(notice.event_status), formatWorkflowTime(notice.created_at)].filter(Boolean).join(" · ")}</small>
          {notice.due_date && <small>Tenggat {dispositionDeadline(notice.due_date, notice.due_time)}</small>}
          {notice.note && <span className="notification-note">{notice.note}</span>}
        </a>)}
      </div>
    </Modal>, document.body)}
  </>;
}
