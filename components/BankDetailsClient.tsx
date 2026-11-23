"use client";

import { useEffect, useState, type FormEvent } from "react";
import { bankImportKind } from "@/lib/bank-import-kind";
import { canEditFinance } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";

const endpoint = "/api/finance/bank-statement/details";
const money = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const states = { LINKED: "Cocok", AMBIGUOUS: "Perlu diperiksa", UNMATCHED: "Belum cocok" };
type Account = { id: string; bank_name: string; account_number: string; account_name: string; currency: string; finance_locked: number };
type Detail = {
  id: string; entry_date: string; description: string; proof_no: string | null;
  debit_amount: number; credit_amount: number; balance: number; original_name: string;
  status: keyof typeof states;
  transaction: { id: string; description: string; source: string } | null;
};
type DetailImport = { id: string; original_name: string; document_id: string | null; inserted_count: number; duplicate_count: number; period_from: string; period_to: string };
type Report = { account: Account; rows: Detail[]; imports: DetailImport[] };

async function responseData<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) throw new Error(json?.error || "Permintaan rincian gagal.");
  return json.data;
}

const dateLabel = (value: string) => value.split("-").reverse().join("/");
const query = (id: string, from: string, to: string) => new URLSearchParams({ account_id: id, from, to }).toString();

export default function BankDetailsClient({ user }: { user: SessionUser }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [today] = useState(() => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date()));
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<Report | null>(null);
  const [shownQuery, setShownQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const account = accounts.find(item => item.id === accountId);
  const locked = Number(report?.account.id === accountId ? report.account.finance_locked : account?.finance_locked) === 1;
  const canUpload = canEditFinance(user.role) && (user.role === "ROOT_ADMIN" || !locked);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/finance/bank-accounts", { cache: "no-store", signal: controller.signal })
      .then(responseData<Account[]>).then(rows => setAccounts(rows.filter(row => bankImportKind(row.bank_name))))
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);

  async function load(id: string, start: string, end: string) {
    const filter = query(id, start, end);
    const next = await responseData<Report>(await fetch(endpoint + "?" + filter, { cache: "no-store" }));
    setReport(next);
    setShownQuery(filter);
    setAccounts(rows => rows.map(row => row.id === id ? { ...row, ...next.account } : row));
  }

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await load(accountId, from, to);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Laporan gagal dimuat.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    body.set("account_id", accountId);
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await responseData<{ inserted: number; duplicates: number; from: string; to: string }>(
        await fetch(endpoint, { method: "POST", body }));
      form.reset();
      setMessage(result.inserted
        ? `${result.inserted} baris ditambahkan. ${result.duplicates} baris yang sudah ada dilewati.`
        : `Semua ${result.duplicates} baris sudah ada.`);
      setFrom(result.from);
      setTo(result.to);
      await load(accountId, result.from, result.to);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Excel gagal diimpor.");
    } finally {
      setBusy(false);
    }
  }

  const matched = report?.rows.filter(row => row.status === "LINKED").length ?? 0;
  return <main className="page">
    <div className="page-head"><div>
      <h2>Rincian Rekening Koran</h2>
      <p>Impor harian Laporan Buku Bank BRI atau Mandiri dan periksa kecocokannya dengan transaksi rekening koran.</p>
    </div></div>
    {message && <div className="success" role="status" style={{ marginBottom: 12 }}>{message}</div>}
    {error && <div className="error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
    <div className="card" style={{ padding: 16, marginBottom: 14 }}>
      <form className="form-grid" onSubmit={apply}>
        <label className="field full"><span>Rekening</span>
          <select className="select" value={accountId} required disabled={busy} onChange={event => {
            setAccountId(event.target.value);
            setReport(null);
            setError("");
            setMessage("");
          }}>
            <option value="">Pilih rekening</option>
            {accounts.map(row => <option value={row.id} key={row.id}>{row.bank_name} · {row.account_number} · {row.account_name}</option>)}
          </select>
        </label>
        <label className="field"><span>Dari tanggal</span><input className="input" type="date" value={from} required disabled={busy} onChange={event => setFrom(event.target.value)}/></label>
        <label className="field"><span>Sampai tanggal</span><input className="input" type="date" value={to} required disabled={busy} onChange={event => setTo(event.target.value)}/></label>
        <div className="field full modal-actions">
          {report && <a className="btn btn-secondary" href={endpoint + "?" + shownQuery + "&export=1"}>Unduh Excel</a>}
          <button className="btn btn-primary" disabled={busy || !account}>Tampilkan</button>
        </div>
      </form>
    </div>

    {account && locked && <p className="notice" style={{ marginBottom: 14 }}>Rekening dikunci untuk Finance.</p>}
    {account && canUpload && <div className="card" style={{ padding: 16, marginBottom: 14 }}>
      <form className="form-grid" onSubmit={upload}>
        <label className="field full"><span>Excel Laporan Buku Bank</span>
          <input className="input" type="file" name="file" accept=".xls,.xlsx" required disabled={busy}/>
          <small className="hint">Maksimal 10 MB. Excel harus mencantumkan nama bank dan nomor rekening.</small>
        </label>
        <div className="field full modal-actions"><button className="btn btn-primary" disabled={busy}>{busy ? "Memproses…" : "Impor rincian"}</button></div>
      </form>
    </div>}

    {report && <>
      <div className="notice" style={{ marginBottom: 12 }}>
        <b>{report.rows.length} baris</b> · {matched} cocok · {report.rows.length - matched} perlu diperiksa
        <div>Tautan ditampilkan ketika tanggal, arah mutasi, dan nominal punya satu pasangan di kedua laporan.</div>
      </div>
      <div className="card"><div className="table-wrap"><table className="table">
        <thead><tr><th>Tanggal</th><th>Keterangan Buku Bank</th><th>No. Bukti</th><th>Debet buku</th><th>Kredit buku</th><th>Saldo buku</th><th>Rekening Koran</th></tr></thead>
        <tbody>
          {report.rows.map(row => <tr key={row.id}>
            <td>{dateLabel(row.entry_date)}</td><td>{row.description}</td><td>{row.proof_no || "–"}</td>
            <td className="mono">{money.format(row.debit_amount)}</td><td className="mono">{money.format(row.credit_amount)}</td><td className="mono">{money.format(row.balance)}</td>
            <td><span className={row.transaction ? "badge green" : "badge"}>{states[row.status]}</span>
              {row.transaction && <div>
                <a href={"/finance/bank-statement?" + query(report.account.id, row.entry_date, row.entry_date) + "#transaction-" + row.transaction.id}>{row.transaction.description}</a>
                <div><small className="muted">{row.transaction.source}</small></div>
              </div>}
            </td>
          </tr>)}
          {!report.rows.length && <tr><td colSpan={7}>Belum ada rincian untuk periode ini.</td></tr>}
        </tbody>
      </table></div></div>
      {report.imports.length > 0 && <div className="card" style={{ marginTop: 14 }}>
        <div style={{ padding: 16 }}><b>Riwayat Impor Rincian</b></div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>File sumber</th><th>Periode</th><th>Ditambahkan</th><th>Dilewati</th></tr></thead>
          <tbody>{report.imports.map(item => <tr key={item.id}>
            <td>{item.document_id ? <a href={`/api/finance/bank-documents/${item.document_id}/download`}>{item.original_name}</a> : item.original_name}</td>
            <td>{dateLabel(item.period_from)} – {dateLabel(item.period_to)}</td><td>{item.inserted_count}</td><td>{item.duplicate_count}</td>
          </tr>)}</tbody>
        </table></div>
      </div>}
    </>}
  </main>;
}
