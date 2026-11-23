"use client";

import { useEffect, useState, type FormEvent } from "react";
import SearchableSelect from "@/components/SearchableSelect";
import { isGeneralPicRole, normalizeUnitName } from "@/lib/v11-workflow";
import NumberSourcePanel from "@/components/NumberSourcePanel";
import type { NumberSourceSettings } from "@/lib/correspondence-number-source";

type Account = { id: string; name: string; alias: string | null; email: string; role: string; unit_name: string | null };
const path = "/api/admin/correspondence-settings";

export default function CorrespondenceSettingsClient() {
  const [numbering,setNumbering] = useState<NumberSourceSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [names, setNames] = useState("");
  const [defaultRecipient, setDefaultRecipient] = useState("");
  const [managerId, setManagerId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState("");
  const [unit, setUnit] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [managerReady, setManagerReady] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const recipients = [...new Set(names.split("\n").map(name => name.trim()).filter(Boolean))];

  useEffect(() => {
    async function load() {
      try {
        const [settings, users] = await Promise.all([fetch(path), fetch("/api/users/lookup")]);
        const [config, list] = await Promise.all([settings.json(), users.json()]);
        if (!config.ok || !list.ok) throw new Error("Pengaturan belum dapat dimuat.");
        setNames(config.data.recipients.join("\n"));
        setDefaultRecipient(config.data.defaultRecipient);
        setAccounts(list.data);
        setNumbering(config.data.numbering ?? null);
        setLoaded(true);
      } catch {
        setError("Pengaturan belum dapat dimuat.");
      }
    }
    void load();
  }, []);

  useEffect(() => {
    setManagerReady(false);
    setQuery("");
    setUnit("");
    setSelected([]);
    setManual(false);
    if (!managerId) return;
    const controller = new AbortController();
    void fetch(path + "?manager_id=" + encodeURIComponent(managerId), { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!result.ok) throw new Error("Daftar PIC belum dapat dimuat.");
        if (controller.signal.aborted) return;
        setManual(result.data.delegation !== null);
        const allowed = new Set(accounts.filter(account => isGeneralPicRole(account.role)).map(account => account.id));
        setSelected((result.data.delegation as string[] | null)?.filter(id => allowed.has(id)) ?? []);
        setManagerReady(true);
      }).catch(() => { if (!controller.signal.aborted) setError("Daftar PIC belum dapat dimuat."); });
    return () => controller.abort();
  }, [accounts, managerId]);

  async function save(event: FormEvent<HTMLFormElement>, data: object) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(path, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || "Pengaturan gagal disimpan.");
      setMessage("Pengaturan tersimpan.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pengaturan gagal disimpan.");
    } finally { setBusy(false); }
  }

  const managers = accounts.filter(user => user.role === "MANAGER");
  const unitNames = new Map<string, string>();
  for (const account of accounts) {
    const key = normalizeUnitName(account.unit_name) || "__tanpa_unit";
    const label = account.unit_name?.trim() || "Tanpa unit";
    if (!unitNames.has(key)) unitNames.set(key, label);
  }
  const units = [...unitNames.entries()].sort(([, first], [, second]) => first.localeCompare(second, "id-ID"));
  const term = query.trim().toLocaleLowerCase("id-ID");
  const eligible = accounts.filter(account => isGeneralPicRole(account.role));
  const matching = eligible.filter(account => [account.name, account.alias, account.email, account.unit_name, account.role]
    .filter(Boolean).join(" ").toLocaleLowerCase("id-ID").includes(term));
  const toggle = (id: string) => setSelected(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);

  return <main className="page">
    <div className="page-head"><div><h2>Pengaturan Persuratan</h2><p>Kelola tujuan Surat Masuk, pilihan PIC, dan sumber nomor dokumen.</p></div></div>
    {message && <p className="success" role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {!loaded && !error && <p className="hint" role="status">Memuat pengaturan…</p>}
    {loaded && <div className="grid-2">
      {numbering && <NumberSourcePanel initial={numbering}/>}
      <section className="card">
        <div className="card-head"><h3>Tujuan Surat Masuk</h3></div>
        <div className="card-body">
          <form className="form-grid workflow-form" onSubmit={event =>
            save(event, { kind: "recipients", recipients, defaultRecipient })}>
            <label className="field full"><span>Daftar tujuan</span>
              <textarea className="textarea" value={names} onChange={event => setNames(event.target.value)} required/>
              <small className="hint">Tulis satu nama per baris.</small>
            </label>
            <label className="field full"><span>Tujuan default</span>
              <select className="select" value={recipients.includes(defaultRecipient) ? defaultRecipient : ""}
                onChange={event => setDefaultRecipient(event.target.value)} required>
                <option value="">Pilih tujuan default…</option>
                {recipients.map(name => <option key={name}>{name}</option>)}
              </select>
            </label>
            <div className="field full modal-actions"><button className="btn btn-primary" disabled={busy}>Simpan tujuan</button></div>
          </form>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h3>PIC untuk Disposisi Umum</h3></div>
        <div className="card-body">
          <form className="form-grid workflow-form" onSubmit={event =>
            save(event, { kind: "delegation", managerId, userIds: manual ? selected : null })}>
            <div className="field full"><SearchableSelect name="manager" label="Manager" required value={managerId}
              onChange={setManagerId} options={managers.map(user => ({ value: user.id, label: user.name, search: [user.unit_name, user.alias].filter(Boolean).join(" ") }))}/></div>
            {managerReady && <>
              <label className="field full"><span>Aturan pemilihan PIC</span>
                <select className="select" required value={manual ? "manual" : "unit"}
                  onChange={event => setManual(event.target.value === "manual")}>
                  <option value="unit">Ikuti aturan unit</option>
                  <option value="manual">Pilih akun tertentu</option>
                </select>
                <small className="hint">Verifikasi dan pembayaran tetap mengikuti kewenangan masing-masing.</small>
              </label>
              {manual && <fieldset className="field full pic-settings">
                <legend>Pilih akun PIC ({selected.length} dipilih)</legend>
                <input className="input" type="search" aria-label="Cari PIC" placeholder="Cari nama, alias, email, atau unit…"
                  value={query} onChange={event => setQuery(event.target.value)}
                  onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }}/>
                <label className="field"><span>Unit PIC</span>
                  <select className="select" value={unit} onChange={event => setUnit(event.target.value)}>
                    <option value="">Semua unit</option>
                    {units.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </label>
                <div className="pic-settings-list">
                  {units.filter(([key]) => !unit || unit === key).map(([key, label]) => {
                    const group = matching.filter(account => (normalizeUnitName(account.unit_name) || "__tanpa_unit") === key);
                    if (!group.length) return null;
                    return <div key={key}>
                      <strong>{label}</strong>
                      {group.map(account => <label key={account.id}>
                        <input type="checkbox" checked={selected.includes(account.id)} onChange={() => toggle(account.id)}/>
                        <span>{account.name}{account.alias && <small className="muted"> · {account.alias}</small>}
                          <small className="muted"> · {account.role === "STAFF" ? "Staff" : "Finance"}</small></span>
                      </label>)}
                    </div>;
                  })}
                </div>
                <small className="hint">PIC dapat dipilih dari Staff dan Finance aktif. Tambahkan atau ubah Unit akun lewat User &amp; Role.</small>
                {!matching.some(account => !unit || (normalizeUnitName(account.unit_name) || "__tanpa_unit") === unit) &&
                  <small className="hint">Belum ada Staff atau Finance aktif yang cocok.</small>}
                <small className="hint">Daftar kosong menutup penugasan umum Manager ini. Pilih aturan unit untuk mengembalikan pilihan bawaan.</small>
              </fieldset>}
              <div className="field full modal-actions"><button className="btn btn-primary" disabled={busy}>Simpan PIC</button></div>
            </>}
          </form>
        </div>
      </section>
    </div>}
  </main>;
}
