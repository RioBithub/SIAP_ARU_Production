"use client";

import { DRAFT_LIMITS, MAX_DOCUMENT_SIGNERS, SIGNATURE_POSITIONS,
  type CorrespondenceLayout, type DocumentBlock, type SignatureLine } from "@/lib/correspondence-layout";

const positionLabels: Record<SignatureLine["position"], string> = { LEFT: "Kiri", CENTER: "Tengah", RIGHT: "Kanan" };

export default function CorrespondenceLayoutFields({ layout, onChange, outgoing, disabled = false }: {
  layout: CorrespondenceLayout;
  onChange: (layout: CorrespondenceLayout) => void;
  outgoing: boolean;
  disabled?: boolean;
}) {
  function changeBlock(index: number, block: DocumentBlock) {
    onChange({ ...layout, blocks: layout.blocks.map((item, i) => i === index ? block : item) });
  }
  function moveBlock(index: number, step: number) {
    const items = [...layout.blocks];
    [items[index], items[index + step]] = [items[index + step], items[index]];
    onChange({ ...layout, blocks: items });
  }
  function addBlock(block: DocumentBlock) {
    onChange({ ...layout, blocks: [...layout.blocks, block] });
  }
  function changeSigner(index: number, patch: Partial<SignatureLine>) {
    onChange({ ...layout, signers: layout.signers.map((person, i) => i === index ? { ...person, ...patch } : person) });
  }
  const requiredSigners = outgoing && !layout.signers.length ? [{ name: "", title: "", position: "LEFT" } as const] : layout.signers;
  const updateSigner = (index: number, patch: Partial<SignatureLine>) => layout.signers.length ? changeSigner(index, patch)
    : onChange({ ...layout, signers: [{ ...requiredSigners[0], ...patch }] });

  return <fieldset className="form-grid workflow-form draft-layout field full" disabled={disabled}>
    <legend>Format PDF ARU</legend>
    {outgoing && <>
      <label className="field"><span>Tempat penulisan</span>
        <input className="input" maxLength={100} value={layout.place} onChange={e => onChange({ ...layout, place: e.target.value })}/>
      </label>
      <label className="field"><span>Lokasi atau alamat tujuan</span>
        <input className="input" maxLength={400} placeholder="di Jakarta" value={layout.address}
          onChange={e => onChange({ ...layout, address: e.target.value })}/>
      </label>
    </>}
    <label className="field full"><span>Keterangan lampiran</span>
      <input className="input" maxLength={250} placeholder="Contoh: 1 (satu) lembar" value={layout.enclosures}
        onChange={e => onChange({ ...layout, enclosures: e.target.value })}/>
    </label>
    {layout.blocks.map((block, index) => <fieldset key={index} className="draft-layout field full">
      <legend>{block.type === "TABLE" ? "Tabel" : "Paragraf"} {index + 1}</legend>
      {block.type === "TEXT"
        ? <textarea className="textarea" aria-label={`Paragraf ${index + 1}`} value={block.text} maxLength={5000} required
          onChange={e => changeBlock(index, { ...block, text: e.target.value })}/>
        : <>
          <div className="table-wrap"><table className="table draft-table"><tbody>
            {block.rows.map((row, rowIndex) => <tr key={rowIndex}>
              {row.map((value, colIndex) => <td key={colIndex}>
                <input className="input" aria-label={rowIndex === 0 ? `Judul kolom ${colIndex + 1}` : `Baris ${rowIndex}, kolom ${colIndex + 1}`}
                  placeholder={rowIndex === 0 ? `Judul ${colIndex + 1}` : undefined}
                  value={value} maxLength={rowIndex === 0 ? DRAFT_LIMITS.heading : DRAFT_LIMITS.cell} required={rowIndex === 0} onChange={e => {
                    changeBlock(index, { ...block, rows: block.rows.map((cells, r) =>
                      r === rowIndex ? cells.map((cell, c) => c === colIndex ? e.target.value : cell) : cells) });
                  }}/>
              </td>)}
              {rowIndex > 0 && block.rows.length > 2 && <td>
                <button type="button" className="btn btn-secondary" onClick={() => changeBlock(index, {
                  ...block, rows: block.rows.filter((_, i) => i !== rowIndex),
                })}>Hapus baris {rowIndex}</button>
              </td>}
            </tr>)}
          </tbody></table></div>
          <div className="attachment-actions">
            <button type="button" className="btn btn-secondary" disabled={block.rows.length > DRAFT_LIMITS.rows}
              onClick={() => changeBlock(index, { ...block, rows: [...block.rows, block.rows[0].map(() => "")] })}>Tambah baris</button>
            <button type="button" className="btn btn-secondary" disabled={block.rows[0].length === DRAFT_LIMITS.columns}
              onClick={() => changeBlock(index, { ...block, rows: block.rows.map(row => [...row, ""]) })}>Tambah kolom</button>
            {block.rows[0].length > 1 && <button type="button" className="btn btn-secondary"
              onClick={() => changeBlock(index, { ...block, rows: block.rows.map(row => row.slice(0, -1)) })}>Hapus kolom terakhir</button>}
          </div>
        </>}
      <div className="attachment-actions">
        <button type="button" className="btn btn-secondary" disabled={index === 0} onClick={() => moveBlock(index, -1)}>Naikkan</button>
        <button type="button" className="btn btn-secondary" disabled={index === layout.blocks.length - 1} onClick={() => moveBlock(index, 1)}>Turunkan</button>
        <button type="button" className="btn btn-secondary" onClick={() => onChange({
          ...layout, blocks: layout.blocks.filter((_, i) => i !== index),
        })}>Hapus blok</button>
      </div>
    </fieldset>)}
    <div className="attachment-actions field full">
      <button type="button" className="btn btn-secondary" disabled={layout.blocks.length === DRAFT_LIMITS.blocks}
        onClick={() => addBlock({ type: "TEXT", text: "" })}>Tambah paragraf</button>
      <button type="button" className="btn btn-secondary" disabled={layout.blocks.length === DRAFT_LIMITS.blocks}
        onClick={() => addBlock({ type: "TABLE", rows: [["", ""], ["", ""]] })}>Tambah tabel</button>
    </div>
    {outgoing && <label className="field full"><span>Kalimat penutup</span>
      <input className="input" maxLength={500} value={layout.closing} onChange={e => onChange({ ...layout, closing: e.target.value })}/>
    </label>}
    <fieldset className="form-grid workflow-form draft-layout field full">
      <legend>Blok tanda tangan</legend>
      {!outgoing && requiredSigners.length === 0 && <small className="hint field full">Secara bawaan PDF menyediakan ruang tanda tangan untuk pengirim Nota Dinas.</small>}
      {requiredSigners.map((person, index) => <fieldset key={index} className="form-grid draft-layout field full">
        <legend>Penandatangan {index + 1}</legend>
        <label className="field"><span>Nama</span>
          <input className="input" value={person.name} maxLength={150} onChange={e => updateSigner(index, { name: e.target.value })} required/>
        </label>
        <label className="field"><span>Jabatan</span>
          <input className="input" value={person.title} maxLength={150} onChange={e => updateSigner(index, { title: e.target.value })}/>
        </label>
        <label className="field"><span>Posisi</span>
          <select className="select" value={person.position} required onChange={e => updateSigner(index, {
            position: e.target.value as SignatureLine["position"],
          })}>{SIGNATURE_POSITIONS.map(position => <option key={position} value={position}>{positionLabels[position]}</option>)}</select>
        </label>
        {(!outgoing || requiredSigners.length > 1) && <div><button type="button" className="btn btn-secondary"
          onClick={() => onChange({ ...layout, signers: layout.signers.filter((_, i) => i !== index) })}>Hapus penandatangan</button></div>}
      </fieldset>)}
      {requiredSigners.length > 0 && <small className="hint field full">Pilih posisi yang sama untuk menempatkan penandatangan berikutnya di baris bawah.</small>}
      <div className="field full"><button type="button" className="btn btn-secondary" disabled={requiredSigners.length === MAX_DOCUMENT_SIGNERS}
        onClick={() => onChange({ ...layout, signers: [...requiredSigners, {
          name: "", title: "", position: SIGNATURE_POSITIONS[requiredSigners.length % SIGNATURE_POSITIONS.length],
        }] })}>Tambah penandatangan</button></div>
    </fieldset>
    <label className="field full"><span>Tembusan</span>
      <textarea className="textarea" value={layout.copies} maxLength={1000} onChange={e => onChange({ ...layout, copies: e.target.value })}/>
    </label>
  </fieldset>;
}
