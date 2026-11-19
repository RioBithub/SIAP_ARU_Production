"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import AttachmentActions from "@/components/AttachmentActions";
import Modal from "@/components/Modal";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { formatWorkflowTime } from "@/lib/workflow-time";

type Thread = {
  unread: number;
  lastNotificationId: string | null;
  respondable: boolean;
  responses: {
    id: string; actor_name: string; actor_role: Role; comment: string; created_at: string;
    files: { id: string; original_name: string }[];
  }[];
};

export default function NotaResponses({ id, refreshHistory }: { id: string; refreshHistory: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Thread | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestVersion = useRef(0);
  const url = `/api/letters/${id}/responses`;

  const load = useCallback(async (mark: boolean) => {
    const version = ++requestVersion.current;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Tanggapan belum dapat dimuat.");
    const { data: thread }: { data: Thread } = await response.json();
    if (version !== requestVersion.current) return;
    setData(thread);
    if (mark && thread.lastNotificationId) {
      const read = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ through: thread.lastNotificationId }) });
      if (read.ok) {
        if (version === requestVersion.current) setData({ ...thread, unread: 0 });
        window.dispatchEvent(new Event("siap-notification-change"));
      }
    }
  }, [url]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("letter_id") === id && query.get("tanggapan") === "1") setOpen(true);
  }, [id]);

  useEffect(() => {
    let active = true;
    const update = () => void load(open).catch(() => { if (active) setError("Tanggapan belum dapat dimuat."); });
    update();
    const timer = window.setInterval(() => { if (!document.hidden) update(); }, 15_000);
    return () => { active = false; ++requestVersion.current; window.clearInterval(timer); };
  }, [load, open]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const body = new FormData(form);
    if (body.getAll("files").filter(file => typeof file !== "string" && file.size).length > 5) {
      setError("Maksimal 5 lampiran tanggapan.");
      return;
    }
    body.set("action", "RESPONSE");
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/letters/${id}/actions`, { method: "POST", body });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Tanggapan belum dapat dikirim.");
      form.reset();
      await load(true).catch(() => setError("Tanggapan tersimpan. Buka kembali untuk melihat pembaruan."));
      void refreshHistory().catch(() => {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Tanggapan belum dapat dikirim.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="btn btn-secondary attachment-actions" onClick={() => { setError(""); setOpen(true); }}>
      Tanggapan {(data?.unread ?? 0) > 0 && <span className="notification-count" aria-label={`${data?.unread} baru`}>{data?.unread}</span>}
    </button>
    {open && createPortal(<Modal title="Tanggapan Nota Dinas" onClose={() => !busy && setOpen(false)}>
      {data && !data.responses.length && <p className="empty">Belum ada tanggapan.</p>}
      <div className="nota-response-list">
        {data?.responses.map(response => <article className="notice" key={response.id}>
          <b>{response.actor_name}</b><small>{ROLE_LABELS[response.actor_role]} · {formatWorkflowTime(response.created_at)}</small>
          <p>{response.comment}</p>
          {response.files.map(file => <div key={file.id}><span>{file.original_name}</span>
            <AttachmentActions id={file.id} name={file.original_name}/>
          </div>)}
        </article>)}
      </div>
      {data?.respondable && <form className="form-grid workflow-form" onSubmit={send}>
        <label className="field full"><span>Tanggapan</span>
          <textarea className="textarea" name="comment" required maxLength={5000} placeholder="Tulis tanggapan untuk pihak yang menangani Nota Dinas."/>
        </label>
        <label className="field full"><span>Lampiran tanggapan</span><input type="file" className="input" name="files" multiple/></label>
        <div className="field full"><button className="btn btn-primary" disabled={busy}>{busy ? "Mengirim…" : "Kirim Tanggapan"}</button></div>
      </form>}
      {error && <p className="error" role="alert">{error}</p>}
    </Modal>, document.body)}
  </>;
}
