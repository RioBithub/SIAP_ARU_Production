"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

export type DisplayedPage = { number: number; width: number; height: number };

export default function PdfPreview({ id, title, overlay }: {
  id: string;
  title: string;
  overlay?: (page: DisplayedPage) => ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [number, setNumber] = useState(1);
  const [page, setPage] = useState<DisplayedPage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    let clean: (() => Promise<void>) | undefined;
    setPdf(null);
    setPage(null);
    setNumber(1);
    setError("");
    void import("pdfjs-dist").then(async ({ getDocument, PDFWorker }) => {
      if (stopped) return;
      const port = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
      port.addEventListener("error", () => {
        if (!stopped) setError("Pratinjau PDF belum dapat dimuat di browser ini.");
      });
      const worker = PDFWorker.create({ port });
      const task = getDocument({ url: "/api/attachments/" + encodeURIComponent(id) + "?preview=1",
        worker, isEvalSupported: false, enableXfa: false });
      clean = async () => {
        try { await task.destroy(); } finally { worker.destroy(); port.terminate(); }
      };
      const document = await task.promise;
      if (!stopped) setPdf(document);
    }).catch(() => { if (!stopped) setError("PDF belum dapat ditampilkan. Periksa akses dan pastikan file bisa dibuka."); });
    return () => { stopped = true; void clean?.().catch(() => {}); };
  }, [id]);

  useEffect(() => {
    if (!pdf) return;
    let stopped = false;
    let cancel: (() => void) | undefined;
    setPage(null);
    setError("");
    void pdf.getPage(number).then(async documentPage => {
      const view = canvas.current;
      if (stopped || !view) return;
      const base = documentPage.getViewport({ scale: 1 });
      const scale = Math.min(1, 1400 / Math.max(base.width, base.height));
      const viewport = documentPage.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      view.width = Math.ceil(viewport.width * ratio);
      view.height = Math.ceil(viewport.height * ratio);
      const task = documentPage.render({ canvas: view, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      cancel = () => task.cancel();
      await task.promise;
      if (!stopped) setPage({ number, width: viewport.width, height: viewport.height });
    }).catch(() => { if (!stopped) setError("Halaman PDF belum dapat ditampilkan."); });
    return () => { stopped = true; cancel?.(); };
  }, [pdf, number]);

  return <section className="pdf-preview" aria-label={title}>
    {pdf && <div className="pdf-preview-controls">
      <button type="button" className="btn btn-secondary" onClick={() => setNumber(number - 1)} disabled={number === 1}>Sebelumnya</button>
      <label>Halaman <select aria-label="Pilih halaman PDF" className="select" value={number}
        onChange={event => setNumber(Number(event.target.value))}>
        {Array.from({ length: pdf.numPages }, (_, index) => <option key={index + 1}>{index + 1}</option>)}
      </select> dari {pdf.numPages}</label>
      <button type="button" className="btn btn-secondary" onClick={() => setNumber(number + 1)} disabled={number === pdf.numPages}>Berikutnya</button>
    </div>}
    {error && <div className="error" role="alert">{error}</div>}
    {!error && !page && <p className="hint" role="status">Memuat halaman PDF…</p>}
    <div className="pdf-page" style={{ maxWidth: page ? Math.round(page.width) : undefined }} hidden={!page}>
      <canvas ref={canvas} aria-label={`Halaman ${number} dari ${title}`}/>
      {page && overlay?.(page)}
    </div>
  </section>;
}
