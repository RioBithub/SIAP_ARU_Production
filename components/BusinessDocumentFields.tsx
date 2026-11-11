"use client";

import { useEffect, useRef, useState } from "react";
import CurrencyInput from "@/components/CurrencyInput";
import {
  formatInvoiceAmount, formatInvoiceQuantity, isInvoice, MAX_INVOICE_ITEMS, MAX_SUPPORTING_LETTERS, normalizeInvoice,
  type BusinessDocumentDetails, type DocumentReference, type ReferenceKind,
} from "@/lib/business-documents";

function directionLabel(direction: string) {
  if (direction === "INCOMING") return "Masuk";
  if (direction === "OUTGOING") return "Keluar";
  return "Internal";
}

function referenceLabel(reference: DocumentReference) {
  return [directionLabel(reference.direction), reference.number, reference.subject].filter(Boolean).join(" · ");
}

export function ReferencePicker({
  kind, letterId, selected, onChange, limit,
}: {
  kind: ReferenceKind;
  letterId?: string;
  selected: DocumentReference[];
  onChange: (references: DocumentReference[]) => void;
  limit: number;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<DocumentReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const label = kind === "spk" ? "SPK rujukan" : kind === "source" ? "surat atau Nota Dinas asal" : "surat pendukung";

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    const timeout = window.setTimeout(async () => {
      const params = new URLSearchParams({ kind, q: query });
      if (letterId) params.set("exclude", letterId);
      try {
        const response = await fetch("/api/letters/references?" + params, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error("Gagal memuat rujukan.");
        if (!controller.signal.aborted) setOptions(result.data);
      } catch {
        if (!controller.signal.aborted) {
          setOptions([]);
          setFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [kind, query, letterId]);

  const available = options.filter(option => !selected.some(item => item.id === option.id));
  return (
    <div className="field">
      <label>
        Cari {label}
        <input
          className="input"
          value={query}
          maxLength={100}
          placeholder="Nomor atau perihal"
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }}
        />
      </label>
      <select
        className="select"
        aria-label={"Pilih " + label}
        value=""
        disabled={loading || limit === 0 || (kind === "support" && selected.length >= limit)}
        onChange={event => {
          const option = available.find(item => item.id === event.target.value);
          if (option) onChange(kind === "support" ? [...selected, option] : [option]);
        }}
      >
        <option value="">{loading ? "Memuat dokumen..." : available.length ? "Pilih dokumen..." : "Tidak ada dokumen yang cocok"}</option>
        {available.map(option => <option key={option.id} value={option.id}>{referenceLabel(option)}</option>)}
      </select>
      {failed && <span className="hint" role="alert">Gagal memuat dokumen. Coba ubah kata pencarian.</span>}
      {selected.map(reference => (
        <div className="kpi-row" key={reference.id}>
          <b>{referenceLabel(reference)}</b>
          <button type="button" className="btn btn-secondary" onClick={() => onChange(selected.filter(item => item.id !== reference.id))}>
            Hapus
          </button>
        </div>
      ))}
    </div>
  );
}

type EditableLine = { key: number; description: string; quantity: string; unit_price: string };

function InvoiceFields({ outgoing, initial, letterId }: {
  outgoing: boolean; initial?: BusinessDocumentDetails; letterId?: string;
}) {
  const invoice = initial?.invoice;
  const [requiresSpk, setRequiresSpk] = useState(invoice?.requires_spk ?? false);
  const [references, setReferences] = useState<DocumentReference[]>(invoice?.spk_reference ? [invoice.spk_reference] : []);
  const [changedReference, setChangedReference] = useState(false);
  const [dueDate, setDueDate] = useState(invoice?.due_date ?? "");
  const [total, setTotal] = useState(invoice?.total ?? "");
  const [items, setItems] = useState<EditableLine[]>(() => invoice?.items.length
    ? invoice.items.map((item, index) => ({ ...item, key: index }))
    : [{ key: 0, description: "", quantity: "1", unit_price: "" }]);
  const nextKey = useRef(items.length);
  const fields = {
    due_date: dueDate,
    total,
    items: items.map(({ description, quantity, unit_price }) => ({ description, quantity, unit_price })),
    requires_spk: requiresSpk,
    ...(changedReference ? { spk_reference_id: references[0]?.id ?? null } : {}),
  };
  let calculated = "";
  if (outgoing) {
    try {
      calculated = normalizeInvoice(fields, true).total;
    } catch {
      // The server validates the completed form. Partially typed rows have no total yet.
    }
  }
  function updateItem(key: number, field: "description" | "quantity" | "unit_price", value: string) {
    setItems(current => current.map(item => item.key === key ? { ...item, [field]: value } : item));
  }

  return (
    <>
      <input type="hidden" name="business" value={JSON.stringify(fields)} />
      <div className="field">
        <label htmlFor={letterId ? "due-" + letterId : "invoice-due"}>Jatuh tempo</label>
        <input
          className="input"
          id={letterId ? "due-" + letterId : "invoice-due"}
          type="date"
          value={dueDate}
          onChange={event => setDueDate(event.target.value)}
        />
      </div>
      {!outgoing && (
        <div className="field">
          <label>Nominal invoice (Rp)</label>
          <CurrencyInput aria-label="Nominal invoice (Rp)" required value={total} onValueChange={setTotal} />
        </div>
      )}
      {outgoing && (
        <div className="field full">
          <b>Rincian tagihan</b>
          {items.map((item, index) => (
            <div className="invoice-item" key={item.key}>
              <div className="field full">
                <label>Uraian item {index + 1}</label>
                <input
                  className="input"
                  aria-label={"Uraian item " + (index + 1)}
                  required
                  maxLength={300}
                  value={item.description}
                  onChange={event => updateItem(item.key, "description", event.target.value)}
                />
              </div>
              <div className="field">
                <label>Kuantitas</label>
                <input
                  className="input"
                  aria-label={"Kuantitas item " + (index + 1)}
                  required
                  type="number"
                  min="0.001"
                  step="0.001"
                  max="9999999.999"
                  value={item.quantity}
                  onChange={event => updateItem(item.key, "quantity", event.target.value)}
                />
              </div>
              <div className="field">
                <label>Harga satuan (Rp)</label>
                <CurrencyInput
                  aria-label={"Harga satuan item " + (index + 1)}
                  required
                  value={item.unit_price}
                  onValueChange={value => updateItem(item.key, "unit_price", value)}
                />
              </div>
              {items.length > 1 && <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setItems(current => current.filter(row => row.key !== item.key))}
              >Hapus item {index + 1}</button>}
            </div>
          ))}
          <div className="kpi-row">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={items.length >= MAX_INVOICE_ITEMS}
              onClick={() => {
                const key = nextKey.current++;
                setItems(current => [...current, { key, description: "", quantity: "1", unit_price: "" }]);
              }}
            >+ Tambah item</button>
            <b>{calculated ? "Total " + formatInvoiceAmount(calculated) : "Total dihitung dari rincian"}</b>
          </div>
        </div>
      )}
      <div className="field full">
        <label className="document-checkbox">
          <input type="checkbox" checked={requiresSpk} onChange={event => setRequiresSpk(event.target.checked)} />
          Invoice ini wajib merujuk SPK
        </label>
        <span className="hint">
          Pilih SPK masuk atau keluar sesuai pekerjaan yang ditagihkan. Rujukan boleh dikosongkan jika tidak wajib.
        </span>
        {invoice?.has_spk_reference && !invoice.spk_reference && !changedReference && (
          <span className="hint">Rujukan tersimpan. Hak akses dokumen SPK mengikuti pengaturan SPK tersebut.</span>
        )}
        <ReferencePicker kind="spk" letterId={letterId} selected={references} limit={1} onChange={value => {
          setReferences(value);
          setChangedReference(true);
        }} />
      </div>
    </>
  );
}

function SpkFields({ initial, letterId }: { initial?: BusinessDocumentDetails; letterId?: string }) {
  const [references, setReferences] = useState(initial?.supporting_letters ?? []);
  const hidden = initial?.hidden_supporting_count ?? 0;
  return (
    <div className="field full">
      <input type="hidden" name="business" value={JSON.stringify({ supporting_letter_ids: references.map(ref => ref.id) })} />
      <b>Surat pendukung SPK</b>
      <span className="hint">Tautkan surat yang sudah tercatat di SIAP atau unggah file pada Lampiran Tambahan.</span>
      {hidden > 0 && <span className="hint">{hidden} rujukan tersimpan dengan akses terbatas.</span>}
      <ReferencePicker
        kind="support"
        letterId={letterId}
        selected={references}
        onChange={setReferences}
        limit={MAX_SUPPORTING_LETTERS - hidden}
      />
    </div>
  );
}

export default function BusinessDocumentFields({ documentType, outgoing, initial, letterId }: {
  documentType: string; outgoing: boolean; initial?: BusinessDocumentDetails; letterId?: string;
}) {
  return isInvoice(documentType)
    ? <InvoiceFields outgoing={outgoing} initial={initial} letterId={letterId} />
    : <SpkFields initial={initial} letterId={letterId} />;
}

function ReferenceLink({ reference }: { reference: DocumentReference }) {
  const path = reference.direction === "INCOMING" ? "incoming" : reference.direction === "OUTGOING" ? "outgoing" : "internal";
  return <a href={"/letters/" + path + "?letter_id=" + encodeURIComponent(reference.id)} target="_blank" rel="noreferrer">
    {referenceLabel(reference)}
  </a>;
}

export function BusinessDocumentSummary({ details, documentType }: { details: BusinessDocumentDetails; documentType: string }) {
  const invoice = details.invoice;
  if (isInvoice(documentType)) {
    if (!invoice) return null;
    return (
      <section className="document-details notice">
        <h3>Data invoice</h3>
        <div className="kpi-row"><span>Total tagihan</span><b>{formatInvoiceAmount(invoice.total)}</b></div>
        <div className="kpi-row"><span>Jatuh tempo</span><b>{invoice.due_date || "—"}</b></div>
        <div className="kpi-row"><span>Rujukan SPK</span>{
          invoice.spk_reference ? <ReferenceLink reference={invoice.spk_reference} />
            : <b>{invoice.has_spk_reference ? "Akses terbatas" : "Tanpa SPK"}</b>
        }</div>
        {invoice.requires_spk && <p className="hint">Rujukan SPK wajib untuk invoice ini.</p>}
        {invoice.items.length > 0 && (
          <ul className="invoice-summary-items">{invoice.items.map((item, index) => (
            <li key={index}>{item.description} · {formatInvoiceQuantity(item.quantity)} × {formatInvoiceAmount(item.unit_price)}</li>
          ))}</ul>
        )}
      </section>
    );
  }
  return (
    <section className="document-details notice">
      <h3>Surat pendukung SPK</h3>
      {details.supporting_letters.length > 0 && <ul className="invoice-summary-items">{details.supporting_letters.map(ref => (
        <li key={ref.id}><ReferenceLink reference={ref} /></li>
      ))}</ul>}
      {details.hidden_supporting_count > 0 && <p className="hint">{details.hidden_supporting_count} rujukan tersimpan dengan akses terbatas.</p>}
      {!details.supporting_letters.length && !details.hidden_supporting_count && <p className="hint">Belum ada surat SIAP yang ditautkan.</p>}
      {details.signature_method && <div className="kpi-row"><span>Metode tanda tangan</span>
        <b>{details.signature_method === "DIGITAL" ? "Digital" : "Basah"}</b>
      </div>}
    </section>
  );
}
