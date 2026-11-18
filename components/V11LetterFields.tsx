"use client";

import { DELIVERY_METHODS, REQUESTING_UNITS, jakartaDate, type RequestingUnit } from "@/lib/v11-workflow";
import { formatInvoiceAmount } from "@/lib/business-documents";
import AttachmentActions from "@/components/AttachmentActions";
import StatusBadge from "@/components/StatusBadge";

export function UnitField({ value = "" }: { value?: RequestingUnit | "" }) {
  return <label className="field">
    <span>Unit Pemohon</span>
    <select className="select" name="requesting_unit" defaultValue={value} required>
      <option value="">Pilih unit pemohon</option>
      {Object.entries(REQUESTING_UNITS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
    </select>
  </label>;
}

export function ReceiptFields({ initial, register = false, upload = false }: {
  initial?: { received_time?: string; delivery_method?: string; delivered_by?: string; received_by?: string;
    receipt_note?: string; receipt_attachment_id?: string; date?: string };
  register?: boolean; upload?: boolean;
}) {
  return <>
    {register && <label className="field"><span>Tanggal Diterima</span><input className="input"
      type="date" name="received_date" defaultValue={initial?.date || jakartaDate()} max={jakartaDate()} required/></label>}
    <label className="field"><span>Jam Diterima (WIB)</span><input className="input" type="time"
      name="received_time" defaultValue={initial?.received_time?.slice(0, 5)} required={register}/></label>
    <label className="field"><span>Cara Penerimaan</span><select className="select" name="delivery_method"
      defaultValue={initial?.delivery_method || ""} required={register}>
      <option value="">Pilih cara penerimaan</option>
      {Object.entries(DELIVERY_METHODS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
    </select></label>
    <label className="field"><span>Nama Pengantar / Pengirim</span><input className="input"
      name="delivered_by" defaultValue={initial?.delivered_by || ""} maxLength={255} required={register}/></label>
    <label className="field"><span>Nama Penerima di ARU</span><input className="input"
      name="received_by" defaultValue={initial?.received_by || ""} maxLength={255} required={register}/></label>
    <label className="field full"><span>Catatan Penerimaan</span><textarea className="textarea"
      name="receipt_note" defaultValue={initial?.receipt_note || ""} maxLength={1000}/></label>
    {upload && <label className="field full"><span>Bukti Serah Terima</span><input className="input" type="file"
      name="receipt_file" accept=".pdf,.png,.jpg,.jpeg" required={register && !initial?.receipt_attachment_id}/>
      <small className="hint">{initial?.receipt_attachment_id
        ? "Bukti sudah tersedia. Pilih file jika perlu memperbaruinya."
        : "PDF atau gambar. Bukti wajib saat Sekretariat meregistrasi surat."}</small>
    </label>}
  </>;
}

export function PersekotFields({ proof }: { proof?: string }) {
  return <label className="field full" data-need={proof?"Opsional":"Wajib saat diajukan"}>
    <span>SPB Persekot {proof ? "(sudah ada)" : ""}</span>
    <input className="input" type="file" name="spb_file" accept=".pdf"/>
    <small className="hint">Setelah draf tersimpan, unggah dokumen lain melalui Persyaratan sebelum Finance.</small>
  </label>;
}

function Evidence({ id, label, files }: { id?: string; label: string; files: {id:string;original_name:string}[] }) {
  const file=files.find(file=>file.id===id);
  return id ? <AttachmentActions id={id} name={file?.original_name||label} downloadLabel={"Unduh "+label}/> : null;
}

export function WorkflowSummary({ data, date, files=[] }: { data: any; date?: string; files?: {id:string;original_name:string}[] }) {
  if (!data) return null;
  return <div className="kpi-list" style={{ marginTop: 12 }}>
    {data.requesting_unit && <>
      <div className="kpi-row"><span>Unit Pemohon</span><b>{REQUESTING_UNITS[data.requesting_unit as RequestingUnit]}</b></div>
      <div className="kpi-row"><span>Penerimaan</span><b>{date?.slice(0, 10)} {data.received_time?.slice(0, 5)} WIB</b></div>
      <div className="kpi-row"><span>Pengantar / penerima</span><b>{data.delivered_by || "—"} / {data.received_by || "—"}</b></div>
      {data.delivery_method && <div className="kpi-row"><span>Cara menerima</span>
        <b>{DELIVERY_METHODS[data.delivery_method as keyof typeof DELIVERY_METHODS]}</b></div>}
      {data.receipt_note && <div className="kpi-row"><span>Catatan penerimaan</span><b>{data.receipt_note}</b></div>}
      <Evidence id={data.receipt_attachment_id} label="bukti penerimaan" files={files}/>
    </>}
    {data.payment && <>
      <div className="kpi-row"><span>Verifikasi revisi {data.invoice_revision}</span>
        <StatusBadge status={data.verification_status || (data.verified ? "APPROVED" : "WAITING_VERIFICATION")}/></div>
      <div className="kpi-row"><span>Bayar di-ACC</span><b>{formatInvoiceAmount(data.payment.paid)}</b></div>
      <div className="kpi-row"><span>Sisa tagihan</span><b>{formatInvoiceAmount(data.payment.outstanding)}</b></div>
    </>}
    {data.signature_provenance && <div className="kpi-row"><span>Sumber Tanda Tangan</span><div>
      {({ MEKARI_MANUAL: "PDF Mekari diunggah manual", MEKARI_MOCK: "Simulasi Mekari", MEKARI_SANDBOX: "Mekari sandbox" } as Record<string, string>)[data.signature_provenance] || data.signature_provenance}
      {" · "}<Evidence id={data.signature_attachment_id} label="PDF final" files={files}/>
    </div></div>}
    {data.dispatch_channel && <div className="kpi-row"><span>Pengiriman</span><div>
      {DELIVERY_METHODS[data.dispatch_channel as keyof typeof DELIVERY_METHODS]} ke {data.dispatch_recipient}
      {" · "}<Evidence id={data.dispatch_attachment_id} label="bukti kirim" files={files}/>
    </div></div>}
  </div>;
}
