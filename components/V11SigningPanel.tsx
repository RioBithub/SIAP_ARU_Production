"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SandboxProgress, SignatureAnnotation } from "@/lib/mekari-sign";
import type { MekariSendFailureNotice } from "@/lib/mekari-signing-audit";
import SignaturePlacement from "@/components/SignaturePlacement";
import AttachmentActions from "@/components/AttachmentActions";
import type { DraftSignatureSlot } from "@/lib/correspondence-layout";

type Mode = "mock" | "sandbox";
type Job = { id: string; status: string; mode: Mode; final_attachment_id: string | null; can_retry?: boolean;
  send_failure?: MekariSendFailureNotice };
export type SandboxSource = { id: string; original_name: string; attachment_kind: string; slots?: DraftSignatureSlot[] };
type Coordinate = keyof Omit<SignatureAnnotation, "type_of">;
type DraftSigner = {
  id: number;
  name: string;
  email: string;
  coordinates: Record<Coordinate, string>;
  suggestion: string;
};
const fieldLabels: Record<Coordinate, string> = {
  page: "Halaman", position_x: "Posisi X", position_y: "Posisi Y", element_width: "Lebar tanda tangan",
  element_height: "Tinggi tanda tangan", canvas_width: "Lebar halaman PDF", canvas_height: "Tinggi halaman PDF",
};
const coordinateFields = Object.keys(fieldLabels) as Coordinate[];
const jobLabels: Record<string, string> = {
  IN_PROGRESS: "Menunggu tanda tangan", COMPLETED: "Selesai", REQUESTING: "Mengirim permintaan",
  VOIDED: "Dibatalkan", DECLINED: "Ditolak penandatangan", DENIED: "Ditolak Mekari",
  FAILED: "Pengiriman gagal", RECONCILE: "Perlu pengecekan permintaan",
};
const signerLabels: Record<SandboxProgress["signers"][number]["status"], string> = {
  completed: "Sudah tanda tangan", your_turn: "Giliran tanda tangan", awaiting: "Menunggu giliran", unknown: "Status belum diketahui",
};

function editableCoordinates(annotation?: SignatureAnnotation) {
  return Object.fromEntries(coordinateFields.map(key => [key, String(annotation?.[key] ?? "")])) as DraftSigner["coordinates"];
}

function newSigner(id: number): DraftSigner {
  return { id, name: "", email: "", coordinates: editableCoordinates(), suggestion: "" };
}

function placementOf(values: DraftSigner["coordinates"]): SignatureAnnotation | null {
  if (coordinateFields.some(key => !values[key].trim() || !Number.isFinite(Number(values[key])))) return null;
  const coords = Object.fromEntries(coordinateFields.map(key => [key, Number(values[key])])) as Record<Coordinate, number>;
  return coords.canvas_width > 0 && coords.canvas_height > 0 ? { type_of: "signature", ...coords } : null;
}

export default function V11SigningPanel({ id, files = [], onReady, source }: {
  id: string;
  files?: SandboxSource[];
  onReady?: (ready: boolean) => void;
  source?: SandboxSource;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [progress, setProgress] = useState<SandboxProgress | null>(null);
  const [retryAfter, setRetryAfter] = useState(0);
  const [busy, setBusy] = useState<"START" | "REFRESH" | "PREDICT" | null>(null);
  const [message, setMessage] = useState("");
  const [attachmentId, setAttachmentId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [ordered, setOrdered] = useState(false);
  const [signers, setSigners] = useState([newSigner(0)]);
  const [suggestions, setSuggestions] = useState<SignatureAnnotation[]>([]);
  const [placementOpen, setPlacementOpen] = useState(false);
  const [placementSigner, setPlacementSigner] = useState(0);
  const nextSignerId = useRef(1);
  const path = source ? "/api/attachments/" + source.id + "/signing" : "/api/letters/" + id + "/signing";
  const attachmentMode = Boolean(source);
  const selectedPdf = source?.id ?? attachmentId;
  const slots = (source ?? files.find(file => file.id === selectedPdf))?.slots;
  useEffect(() => {
    const controller = new AbortController();
    onReady?.(false);
    setMode(null);
    setJob(null);
    setRetrying(false);
    setProgress(null);
    setRetryAfter(0);
    setMessage("");
    void fetch(path, { signal: controller.signal }).then(async response => {
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (attachmentMode) setMessage("Akses tanda tangan untuk PDF ini tidak tersedia.");
        return;
      }
      const json = await response.json();
      if (controller.signal.aborted) return;
      setMode(json.mode);
      setJob(json.data);
      onReady?.(json.data?.status === "COMPLETED");
    }).catch(() => {
      if (!controller.signal.aborted) setMessage("Status tanda tangan belum dapat dimuat.");
    });
    return () => controller.abort();
  }, [path, onReady, attachmentMode]);

  useEffect(() => {
    if (!retryAfter) return;
    const timer = window.setTimeout(() => setRetryAfter(0), retryAfter * 1000);
    return () => window.clearTimeout(timer);
  }, [retryAfter]);

  async function postAction(action: "START" | "REFRESH" | "PREDICT", fields = {}) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, action }) });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) throw new Error(json?.error || "Mekari belum dapat diproses.");
    return json;
  }

  function editSigner(signerId: number, change: Partial<Omit<DraftSigner, "id">>) {
    setSigners(current => current.map(signer => signer.id === signerId ? { ...signer, ...change } : signer));
  }

  function applyDraftSlots() {
    if (!slots?.length) return;
    const people = slots.map(({ name, annotation }) => ({
      ...newSigner(nextSignerId.current++), name, coordinates: editableCoordinates(annotation),
      email: signers.find(person => person.name.trim() === name)?.email ?? "",
    }));
    setSigners(people);
    setPlacementSigner(people[0].id);
  }

  function moveSigner(index: number, offset: number) {
    setSigners(current => {
      const next = [...current];
      const [signer] = next.splice(index, 1);
      next.splice(index + offset, 0, signer);
      return next;
    });
  }

  const recipients = signers.map(signer => ({ signer_name: signer.name, signer_email: signer.email }));
  const active = signers.find(signer => signer.id === placementSigner) ?? signers[0];

  async function predict() {
    setBusy("PREDICT");
    setMessage("");
    setSuggestions([]);
    setSigners(current => current.map(signer => ({ ...signer, suggestion: "" })));
    try {
      const json = await postAction("PREDICT", { attachment_id: selectedPdf, signers: recipients, confirm_sandbox: confirmed });
      setSuggestions(json.data);
      if (!json.data.length) setMessage("Mekari belum memberi saran posisi yang bisa dipakai. Isi posisi secara manual.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Prediksi posisi tidak tersedia.");
    } finally {
      setBusy(null);
    }
  }

  async function action(kind: "START" | "REFRESH", event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setBusy(kind);
    setMessage("");
    const sandboxFields = mode === "sandbox" ? {
      signing_order: ordered,
      signers: signers.map((signer, index) => ({ ...recipients[index], ...signer.coordinates })),
    } : {};
    try {
      const fields = kind === "START"
        ? { attachment_id: selectedPdf, confirm_sandbox: confirmed, retry_failed: retrying, ...sandboxFields }
        : {};
      const json = await postAction(kind, fields);
      setJob(json.data);
      setRetrying(false);
      if (json.progress) setProgress(json.progress);
      setRetryAfter(Number(json.retry_after) || 0);
      onReady?.(json.data?.status === "COMPLETED");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proses Mekari gagal.");
      if (kind === "START") {
        const latest = await fetch(path, { cache: "no-store" })
          .then(response => response.ok ? response.json() : null).catch(() => null);
        if (latest?.ok) {
          setJob(latest.data);
          setRetrying(false);
          onReady?.(latest.data?.status === "COMPLETED");
        }
      }
    } finally {
      setBusy(null);
    }
  }

  if (!mode) return source ? <p role="status">{message || "Memuat Mekari Sandbox…"}</p> : null;
  const pdfs = files.filter(file => file.attachment_kind === "ORIGINAL" && /\.pdf$/i.test(file.original_name));
  const checkedSigners = progress?.signers ?? [];
  const signed = checkedSigners.filter(signer => signer.status === "completed").length;
  const pdfPending = job?.status === "IN_PROGRESS" && progress?.status === "COMPLETED";
  const documentAwaitingConfirmation = job?.status === "IN_PROGRESS" && checkedSigners.length > 0 && signed === checkedSigners.length;
  const canRetry = job?.can_retry === true && job.mode === mode;
  const failure = job?.send_failure;
  return <details className="card" style={{ marginTop: 12 }} open={source ? true : undefined}>
    <summary className="card-head"><b>{(job?.mode ?? mode) === "mock" ? "Simulasi Mekari Sign" : "Mekari Sign Sandbox"}</b></summary>
    <div className="card-body">
      {source && <p className="notice">Hasil tanda tangan disimpan sebagai bukti Sandbox. Status persetujuan dan penerbitan dicatat melalui alur SIAP ARU.</p>}
      {message && message !== failure?.message && <p className="notice" role="status">{message}</p>}
      {failure && <div className="notice" role="status">
        <p>{failure.message}</p>
        <p className="hint">Referensi Audit Log #{failure.audit_reference}</p>
      </div>}
      {job && !(canRetry && retrying) ? <>
        <div role="status">
          <b>{pdfPending ? "PDF final sedang disiapkan" : documentAwaitingConfirmation
            ? "Menunggu konfirmasi akhir dari Mekari" : jobLabels[job.status] ?? job.status}</b>
          {checkedSigners.length > 0 && <p>{signed} dari {checkedSigners.length} penandatangan sudah selesai.</p>}
        </div>
        {checkedSigners.length > 0 && <ul className="signing-progress">
          {checkedSigners.map((signer, index) => <li key={index}>
            <span>{signer.name}</span><span className="muted">{signerLabels[signer.status]}</span>
          </li>)}
        </ul>}
        {job.status === "IN_PROGRESS" && job.mode === mode && <>
          <button className="btn btn-secondary" disabled={!!busy || retryAfter > 0} onClick={() => void action("REFRESH")}>
            {busy === "REFRESH" ? "Mengecek Mekari…" : "Segarkan Status Mekari"}
          </button>
          {retryAfter > 0 && <p className="hint">Bisa dicek lagi dalam {retryAfter} detik.</p>}
        </>}
        {canRetry && <button className="btn btn-primary" type="button" disabled={!!busy} onClick={() => {
          setConfirmed(false);
          setRetrying(true);
        }}>Coba Kirim Lagi</button>}
        {job.status === "RECONCILE" && !failure && <p className="hint">Periksa dokumen di akun Mekari Sandbox sebelum mengirim pengajuan lain.</p>}
        {job.final_attachment_id && <AttachmentActions id={job.final_attachment_id} name="Bukti tanda tangan.pdf"
          downloadLabel={source ? "Unduh PDF bukti Sandbox" : "Unduh PDF final"}/>}
      </> : <form className="workflow-form" onSubmit={event => void action("START", event)}>
        <fieldset className="form-grid signing-form" disabled={!!busy}>
          {source ? <label className="field full"><span>PDF sumber · {source.original_name}</span>
            <span><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required/> Saya sudah memastikan PDF ini boleh dikirim untuk uji di Mekari Sandbox.</span>
          </label> : <label className="field full"><span>PDF Draf yang Disetujui</span>
            <select className="select" value={attachmentId} onChange={event => {
              setAttachmentId(event.target.value);
              setMessage("");
              setSuggestions([]);
              setPlacementOpen(false);
              setSigners(current => current.map(signer => ({ ...signer, coordinates: editableCoordinates(), suggestion: "" })));
            }} required>
              <option value="">Pilih PDF</option>
              {pdfs.map(file => <option key={file.id} value={file.id}>{file.original_name}</option>)}
            </select>
          </label>}
          {mode === "sandbox" && <>
            {!source && <label className="field full consent-field"><span>
              <input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>
              {" "}Saya mengizinkan PDF ini dikirim untuk uji Mekari Sandbox.
            </span></label>}
            <label className="field full"><span>Urutan tanda tangan</span>
              <select className="select" value={ordered ? "sequential" : "parallel"} onChange={event => setOrdered(event.target.value === "sequential")}>
                <option value="parallel">Paralel</option>
                <option value="sequential">Berurutan</option>
              </select>
            </label>
            {Boolean(slots?.length) && <div className="field full">
              <button type="button" className="btn btn-secondary" onClick={applyDraftSlots}>Pakai posisi dari draf</button>
            </div>}
            {signers.map((signer, index) => <fieldset className="form-grid signing-signer" key={signer.id}>
              <legend>Penandatangan {index + 1}</legend>
              <label className="field"><span>Nama penandatangan uji</span>
                <input className="input" value={signer.name} maxLength={150}
                  onChange={event => editSigner(signer.id, { name: event.target.value })} required/>
              </label>
              <label className="field"><span>Email penandatangan uji</span>
                <input className="input" type="email" maxLength={254} value={signer.email}
                  onChange={event => editSigner(signer.id, { email: event.target.value })} required/>
              </label>
              {suggestions.length > 0 && <label className="field full"><span>Saran posisi dari Mekari</span>
                <select className="select" value={signer.suggestion} onChange={event => {
                  const value = event.target.value;
                  const suggestion = value ? suggestions[Number(value)] : undefined;
                  editSigner(signer.id, suggestion ? { suggestion: value, coordinates: editableCoordinates(suggestion) } : { suggestion: "" });
                }}>
                  <option value="">Pilih saran posisi</option>
                  {suggestions.map((suggestion, option) => <option key={option} value={option}>
                    Halaman {suggestion.page} · X {suggestion.position_x} · Y {suggestion.position_y}
                  </option>)}
                </select>
              </label>}
              {coordinateFields.map(key => <label key={key} className="field">
                <span>{fieldLabels[key]}</span>
                <input className="input" type="number" value={signer.coordinates[key]}
                  step={key === "page" ? "1" : "any"} min={key === "position_x" || key === "position_y" ? 0 : 1}
                  onChange={event => editSigner(signer.id, {
                    coordinates: { ...signer.coordinates, [key]: event.target.value }, suggestion: "",
                  })} required/>
              </label>)}
              {signers.length > 1 && <div className="signing-controls">
                {ordered && <>
                  <button className="btn btn-secondary" type="button" aria-label={`Naikkan penandatangan ${index + 1}`}
                    disabled={index === 0} onClick={() => moveSigner(index, -1)}>Naikkan</button>
                  <button className="btn btn-secondary" type="button" aria-label={`Turunkan penandatangan ${index + 1}`}
                    disabled={index === signers.length - 1} onClick={() => moveSigner(index, 1)}>Turunkan</button>
                </>}
                <button className="btn btn-secondary" type="button" aria-label={`Hapus penandatangan ${index + 1}`}
                  onClick={() => setSigners(current => current.filter(item => item.id !== signer.id))}>Hapus</button>
              </div>}
            </fieldset>)}
            <div className="signing-controls">
              <button className="btn btn-secondary" type="button" onClick={() => {
                const signer = newSigner(nextSignerId.current++);
                setSigners(current => [...current, signer]);
              }}>Tambah Penandatangan</button>
              <button className="btn btn-primary" type="button" disabled={!selectedPdf} aria-expanded={placementOpen}
                onClick={() => setPlacementOpen(current => !current)}>Atur Posisi di PDF</button>
              <button className="btn btn-secondary" type="button" disabled={!selectedPdf || !confirmed || !recipients.every(
                recipient => recipient.signer_name.trim() && recipient.signer_email.trim(),
              )} onClick={() => void predict()}>{busy === "PREDICT" ? "Meminta saran posisi…" : "Prediksi Posisi Tanda Tangan"}</button>
            </div>
            {selectedPdf && placementOpen && <div className="field full">
              <label className="field">
                <span>Penandatangan yang ditempatkan</span>
                <select className="select" value={active.id} onChange={event => setPlacementSigner(Number(event.target.value))}>
                  {signers.map((signer, index) => <option key={signer.id} value={signer.id}>
                    {signer.name || "Penandatangan " + (index + 1)}
                  </option>)}
                </select>
              </label>
              <p className="hint">Pilih halaman, pasang kotak, lalu geser kotak atau tarik pegangan sudutnya. Kolom posisi ikut terisi.</p>
              <SignaturePlacement key={selectedPdf} id={selectedPdf}
                signerName={active.name || "Penandatangan " + (signers.indexOf(active) + 1)}
                value={placementOf(active.coordinates)}
                onChange={annotation => editSigner(active.id, { coordinates: editableCoordinates(annotation), suggestion: "" })}/>
            </div>}
          </>}
          <div className="signing-controls">
            {retrying && <button className="btn btn-secondary" type="button" onClick={() => setRetrying(false)}>Batal</button>}
            <button className="btn btn-primary" type="submit" disabled={!selectedPdf || (mode === "sandbox" && !confirmed)}>
              {mode === "mock" ? "Mulai Simulasi" : retrying ? "Kirim Ulang ke Sandbox" : "Ajukan Tanda Tangan Sandbox"}
            </button>
          </div>
        </fieldset>
      </form>}
    </div>
  </details>;
}
