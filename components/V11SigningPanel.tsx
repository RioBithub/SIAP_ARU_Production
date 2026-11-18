"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SignatureAnnotation } from "@/lib/mekari-sign";
import SignaturePlacement from "@/components/SignaturePlacement";
import AttachmentActions from "@/components/AttachmentActions";

type Mode = "mock" | "sandbox";
type Job = { id: string; status: string; mode: Mode; final_attachment_id: string | null };
export type SandboxSource = { id: string; original_name: string; attachment_kind: string };
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
  const selectedPdf = source?.id ?? attachmentId;
  useEffect(() => {
    const controller = new AbortController();
    onReady?.(false);
    setMode(null);
    setJob(null);
    void fetch(path, { signal: controller.signal }).then(async response => {
      if (!response.ok) {
        if (source && !controller.signal.aborted) setMessage("Akses tanda tangan untuk PDF ini tidak tersedia.");
        return;
      }
      const json = await response.json();
      setMode(json.mode);
      setJob(json.data);
      onReady?.(json.data?.status === "COMPLETED");
    }).catch(() => {});
    return () => controller.abort();
  }, [path, onReady, source]);

  async function postAction(action: "START" | "REFRESH" | "PREDICT", fields = {}) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, action }) });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Mekari belum dapat diproses.");
    return json;
  }

  function editSigner(signerId: number, change: Partial<Omit<DraftSigner, "id">>) {
    setSigners(current => current.map(signer => signer.id === signerId ? { ...signer, ...change } : signer));
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
      const fields = kind === "START" ? { attachment_id: selectedPdf, confirm_sandbox: confirmed, ...sandboxFields } : {};
      const json = await postAction(kind, fields);
      setJob(json.data);
      onReady?.(json.data?.status === "COMPLETED");
      if (json.retry_after) setMessage("PDF belum siap. Segarkan setelah " + json.retry_after + " detik.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proses Mekari gagal.");
    } finally {
      setBusy(null);
    }
  }

  if (!mode) return source ? <p role="status">{message || "Memuat Mekari Sandbox…"}</p> : null;
  const pdfs = files.filter(file => file.attachment_kind === "ORIGINAL" && /\.pdf$/i.test(file.original_name));
  return <details className="card" style={{ marginTop: 12 }} open={source ? true : undefined}>
    <summary className="card-head"><b>{(job?.mode ?? mode) === "mock" ? "Simulasi Mekari Sign" : "Mekari Sign Sandbox"}</b></summary>
    <div className="card-body">
      {source && <p className="notice">Hasil tanda tangan disimpan sebagai bukti Sandbox. Status persetujuan dan penerbitan dicatat melalui alur SIAP ARU.</p>}
      {message && <p className="notice" role="status">{message}</p>}
      {job ? <>
        <p>Status {job.status}</p>
        {job.status === "IN_PROGRESS" && job.mode === mode && <button className="btn btn-secondary" disabled={!!busy} onClick={() => void action("REFRESH")}>Segarkan Status Mekari</button>}
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
            <button className="btn btn-primary" type="submit" disabled={!selectedPdf || (mode === "sandbox" && !confirmed)}>
              {mode === "mock" ? "Mulai Simulasi" : "Ajukan Tanda Tangan Sandbox"}
            </button>
          </div>
        </fieldset>
      </form>}
    </div>
  </details>;
}
