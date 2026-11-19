import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { chromium } from "playwright";
import XLSX from "xlsx";
import { fixturePdf } from "./fixture-pdf.mjs";
import { hmacHeaders, mockSignedPdf } from "../../lib/mekari-sign.ts";

const env = process.env;
const profile = JSON.parse(await readFile(env.SIAP_V11_STAGE_PROFILE, "utf8"));
const base = new URL(profile.appUrl);
if (env.SIAP_V11_STAGE !== "1" || env.DB_HOST !== "127.0.0.1" || base.protocol !== "http:" ||
    base.hostname !== "127.0.0.1" || profile.schema !== env.DB_NAME || !/^siap_aru_sqa_v11_[a-z0-9]{4,24}$/.test(profile.schema) ||
    !Object.values(profile.accounts).every(account => account.email.endsWith("@simulasi.siap.invalid"))) {
  throw new Error("UAT hanya boleh dijalankan pada profil staging lokal yang terisolasi.");
}
const sql = await mysql.createConnection({
  host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
});
const [[marker]] = await sql.query("SELECT id FROM siap_v11_stage_marker");
assert.equal(marker.id, profile.marker);
const out = env.SIAP_V11_UAT_OUTPUT;
assert(out && path.isAbsolute(out));
await mkdir(out, { recursive: true });
const runId = randomUUID().slice(0, 7).toUpperCase();
const d = new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Jakarta"}).format(new Date());
const date = new Date(d + "T00:00:00Z");
const old = new Date(date.getTime()-7*86400000).toISOString().slice(0,10);
const due = new Date(date.getTime()+14*86400000).toISOString().slice(0,10);
const roles = profile.accounts;
const result = [];
const state = {};
const sessions = new Map();
const pdf = mockSignedPdf();

function file(form, key, name = "SIMULASI-dokumen.pdf", bytes = pdf) {
  form.append(key, new Blob([bytes], { type: "application/pdf" }), name);
  return form;
}
function multipart(fields, attachments) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  for (const key of attachments) file(form, key);
  return form;
}
async function call(role, url, { method = "GET", body, status = 200, raw = false } = {}) {
  const headers = {};
  if (role) {
    const cookie = sessions.get(role);
    assert(cookie, "Akun simulasi belum login " + role);
    headers.Cookie = cookie;
  }
  if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(new URL(url, base), {
    method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25_000),
  });
  if (raw && response.status === status) return { response, bytes: Buffer.from(await response.arrayBuffer()) };
  const data = await response.json().catch(() => ({}));
  const allowed = Array.isArray(status) ? status : [status];
  assert(allowed.includes(response.status),
    `${method} ${url.split("?")[0]}: HTTP ${response.status}, diharapkan ${allowed.join("/")}` +
    (data.error ? " · " + String(data.error).slice(0, 180) : ""));
  if (response.ok) assert.notEqual(data.ok, false);
  return data.data ?? data;
}
const post = (role, url, body, status = 200) => call(role, url, { method: "POST", body, status });
const detail = (role, id) => call(role, "/api/letters/" + id);
const taskDetail = (role, id) => call(role, "/api/dispositions/" + id);
const letterAction = (role, id, action, fields = {}, files = [], status = 200) =>
  post(role, "/api/letters/" + id + "/actions", files.length ? multipart({ action, ...fields }, files) : { action, ...fields }, status);
const taskAction = (role, id, action, fields = {}, files = [], status = 200) =>
  post(role, "/api/dispositions/" + id + "/actions", files.length ? multipart({ action, ...fields }, files) : { action, ...fields }, status);
const subject = label => "SIMULASI " + runId + " " + label;
const letterForm = (data, files = ["original_file"]) => multipart({ metadata: JSON.stringify(data) }, files);

const receipt = {
  received_date: d, received_time: "10:23", delivery_method: "FISIK",
  delivered_by: "Kurir Simulasi", received_by: "Petugas Simulasi", receipt_note: "Dokumen uji",
};
async function incoming(label, { type = "SURAT_MASUK_UMUM", manager = "ops", unit = "OPS", business, actor = "staff",
  receiptFile = false, confidentiality = "BIASA" } = {}) {
  return post(actor, "/api/letters", letterForm({
    direction: "INCOMING", document_type: type, routing_target_user_id: roles[manager].id,
    subject: subject(label), external_number: runId + "-" + label, sender: "Vendor Fiktif " + runId,
    letter_date: old, requesting_unit: unit, ...receipt, business, confidentiality,
  }, receiptFile ? ["original_file", "receipt_file"] : ["original_file"]), 201);
}
async function register(id, manager = "ops", withProof = true, fields = {}, status = 200) {
  return letterAction("secretariat", id, "REGISTER_INCOMING",
    { routing_target_user_id: roles[manager].id, ...receipt, ...fields }, withProof ? ["receipt_file"] : [], status);
}
async function assign(role, letter, target, options = {}, status = 201) {
  return post(role, "/api/dispositions", { letter_id: letter, to_user_id: roles[target].id,
    instruction: subject("Instruksi"), ...options }, status);
}
async function start(role, id) { return taskAction(role, id, "START"); }
async function submit(role, id, note = "Laporan simulasi", files = [], fields = {}, status = 200) {
  return taskAction(role, id, "SUBMIT_RESULT", { note, ...fields }, files, status);
}
async function verify(id, approve = true) {
  const { id: task } = await assign("ops", id, "staff", { purpose: "INVOICE_VERIFY" });
  await start("staff", task);
  await submit("staff", task, "Pekerjaan dan lampiran terverifikasi", ["files"]);
  if (approve) await taskAction("ops", task, "APPROVE_RESULT");
  return task;
}
async function outgoing(label, fields = {}) {
  return post("staff", "/api/letters", letterForm({
    direction: "OUTGOING", document_type: profile.format.document_type, number_format_id: profile.format.id,
    routing_target_user_id: roles.ops.id, subject: subject(label), recipient: "Penerima Simulasi", letter_date: old,
    ...fields,
  }), 201);
}
async function approveOut(id, prepare = true) {
  const states = [];
  for (const [role, step] of [["staff", "SUBMIT"], ["ops", "APPROVE"], ["dirops", "APPROVE"], ["dirut", "APPROVE"]]) {
    states.push((await letterAction(role, id, step)).status);
  }
  assert.deepEqual(states, ["MANAGER_REVIEW", "DIRECTOR_OPS_REVIEW", "PRESIDENT_DIRECTOR_REVIEW", "READY_TO_ISSUE"]);
  if (prepare) assert.equal((await letterAction("secretariat", id, "PREPARE_ISSUE")).status, "WAITING_SIGNATURE");
}
const payDocuments = ["BPK", "NOTA", "KONTRAK", "SPK", "MARGIN", "PESANAN", "REKENING"];
const payFile = (role, id, code, status = 200) =>
  post(role, "/api/letters/" + id + "/payment-documents", multipart({ document_code: code }, ["file"]), status);
const payRecipient = (role, id, recipient, status = 200) =>
  post(role, "/api/letters/" + id + "/payment-documents", multipart({ recipient_type: recipient }, []), status);
async function fillPayDocs(role, id, codes) {
  for (const code of codes) await payFile(role, id, code);
}

const pay = (ref, amount) => ({
  payment_amount: String(amount), payment_date: d, payment_payee: "Vendor Fiktif",
  payment_account: "SIMULASI-REKENING", payment_reference: ref, bookkeeping_note: "Pencatatan simulasi",
});
async function test(n, run) {
  const id = "UAT-" + String(n).padStart(3, "0");
  try {
    const finding = await run();
    const status = finding?.skip ? "SKIP" : "PASS";
    const evidence = finding?.skip || finding;
    result.push({ id, status, evidence });
    console.log(id, status, evidence);
  } catch (error) {
    const fullMessage = String(error?.message || "Gagal").replace(/\[[0-9;]*m/g, "");
    const evidence = fullMessage.split("\n").filter(Boolean).slice(0, 4).join(" ").slice(0, 500);
    await writeFile(path.join(out, id + "-error.txt"), fullMessage.slice(0, 8000));
    result.push({ id, status: "FAIL", evidence });
    console.log(id, "FAIL", evidence);
  }
}

try {
  for (const [key, account] of Object.entries(roles)) {
    const login = await fetch(new URL("/api/auth/login", base), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: account.email, password: env.SIAP_V11_STAGE_PASSWORD }), signal: AbortSignal.timeout(25_000),
    });
    assert.equal(login.status, 200, "Login akun " + key);
    assert.equal((await login.json()).data.role, account.role);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert(cookie?.startsWith("siap_session="));
    sessions.set(key, cookie);
  }
  await test(1, async () => {
    const [[db]] = await sql.query("SELECT DATABASE() name, @@port port");
    assert.equal(db.name, profile.schema);
    assert.equal(Number(db.port), Number(env.DB_PORT));
    const row = await incoming("isolasi");
    const [[attachment]] = await sql.query("SELECT storage_path FROM siap_attachments WHERE letter_id=?", [row.id]);
    assert(attachment.storage_path.startsWith(env.UPLOAD_DIR + path.sep));
    assert((await readFile(attachment.storage_path)).equals(pdf));
    return "Koneksi loopback, marker DB, unggahan SIMULASI di direktori staging terpisah.";
  });
  await test(2, async () => {
    await post(null, "/api/letters", {}, 401);
    await letterAction(null, profile.legacy, "APPROVE", {}, [], 401);
    return "POST create/approve tanpa cookie: 401.";
  });
  await test(3, async () => {
    const users = await call("staff", "/api/users/lookup");
    assert.deepEqual(users.filter(u => u.v11_scope).map(u => u.id).sort(), [roles.ops.id, roles.ksu.id].sort());
    const legacy = await detail("gedung", profile.legacy);
    assert.equal(legacy.letter.routing_target_user_id, roles.gedung.id);
    assert(!legacy.v11);
    await post("staff", "/api/letters", {
      direction: "INTERNAL", document_type: "NOTA_DINAS", routing_target_user_id: roles.gedung.id,
      subject: subject("jalur tidak aktif"), letter_date: old,
    }, 400);
    return "Dua Manager resmi; riwayat Manager Gedung tetap diakses dan akun tetap aktif.";
  });
  await test(4, async () => {
    state.general = (await incoming("scope")).id;
    await register(state.general);
    await assign("ops", state.general, "staffkeu", {}, 400);
    return "POST disposisi lintas Manager ditolak.";
  });
  await test(5, async () => {
    const row = await incoming("invoice", { type: "INVOICE_MASUK", business: { total: "100000", due_date: due } });
    state.invoice = row.id;
    assert.equal(row.status, "SECRETARIAT_INTAKE");
    assert.equal((await detail("staff", row.id)).v11.received_time, "10:23:00");
    return "Invoice asli dan waktu WIB masuk antrean Sekretariat.";
  });
  await test(6, async () => {
    await register(state.invoice, "ops", false, {}, 400);
    assert.equal((await detail("secretariat", state.invoice)).letter.status, "SECRETARIAT_INTAKE");
    return "Bukti terima kosong ditolak; status tidak bergeser.";
  });
  await test(7, async () => {
    await register(state.invoice);
    const found = await detail("ops", state.invoice);
    assert.equal(found.v11.received_time, "10:23:00");
    assert.equal(found.v11.delivered_by, receipt.delivered_by);
    assert.equal(found.v11.received_by, receipt.received_by);
    assert.equal(found.v11.delivery_method, "FISIK");
    state.receipt = found.v11.receipt_attachment_id;
    assert(state.receipt);
    assert((await call("ops", "/api/attachments/" + state.receipt, { raw: true })).bytes.equals(pdf));
    assert(found.actions.some(a => a.action === "REGISTER_INCOMING" && a.actor_user_id === roles.secretariat.id));
    return "Tanggal, jam, pengantar, penerima dan audit sesuai; bukti terlindungi.";
  });
  await test(8, async () => {
    const row = await incoming("jalur-direksi");
    await register(row.id, "dirut", true, {}, 400);
    assert.equal((await detail("secretariat", row.id)).letter.status, "SECRETARIAT_INTAKE");
    return "Sekretariat tidak dapat melompat ke Dirut.";
  });
  await test(9, async () => {
    const value = (await detail("ops", state.invoice)).letter;
    assert.equal(value.current_owner_user_id, roles.ops.id);
    assert.equal(value.status, "MANAGER_REVIEW");
    await call("ksu", "/api/letters/" + state.invoice, { status:403 });
    return "Manager Operasional adalah reviewer pertama.";
  });
  await test(10, async () => {
    const row = await incoming("unit-sdm", { manager: "ksu", unit: "SDM", actor: "sdm" });
    await register(row.id, "ops", true, {}, 400);
    await register(row.id, "ksu");
    assert.equal((await detail("ksu", row.id)).letter.current_owner_user_id, roles.ksu.id);
    return "Unit SDM wajib melalui Manager Keuangan, SDM & Umum.";
  });
  await test(11, async () => {
    const spk = await incoming("spk", { type: "SURAT_PERINTAH_KERJA_MASUK" });
    await register(spk.id);
    await letterAction("ops", spk.id, "APPROVE_FINAL");
    state.spk = spk.id;
    const row = await incoming("invoice-spk", { type: "INVOICE_MASUK",
      business: { total: "120000", due_date: due, requires_spk: true, spk_reference_id: spk.id } });
    assert.equal((await detail("staff", row.id)).business.invoice.spk_reference.id, spk.id);
    return "Invoice merujuk satu SPK terdaftar lewat skema business documents yang sama.";
  });
  await test(12, async () => {
    const invoice = (await detail("staff", state.invoice)).business.invoice;
    assert.equal(invoice.requires_spk, false);
    assert.equal(invoice.has_spk_reference, false);
    return "Invoice tanpa kewajiban SPK berhasil diregistrasi.";
  });
  await test(13, async () => {
    for (const step of ["APPROVE", "APPROVE_FINAL"]) await letterAction("ops", state.invoice, step, {}, [], 400);
    assert.equal((await detail("ops", state.invoice)).letter.status, "MANAGER_REVIEW");
    return "Eskalasi dan ACC final ditolak sebelum verifikasi.";
  });
  await test(14, async () => {
    state.verify = await verify(state.invoice);
    const doc = await detail("ops", state.invoice);
    assert.equal(doc.v11.verified, true);
    assert.equal(doc.letter.status, "MANAGER_REVIEW");
    const task = await taskDetail("ops", state.verify);
    assert.equal(task.disposition.status, "COMPLETED");
    assert(task.sourceActions.some(action => action.action === "REGISTER_INCOMING"));
    assert(task.sourceAttachments.some(file => file.id === doc.originalId && file.source_kind === "ORIGINAL"));
    assert(task.sourceAttachments.some(file => file.id === state.receipt && file.source_kind === "RECEIPT"));
    return "Staff verifikasi bukti dan Manager ACC. Invoice asli dan bukti terima ikut tampil tanpa unggah ulang.";
  });
  await test(15, async () => {
    await assign("ops", state.invoice, "finance", { purpose: "INVOICE_VERIFY" }, 400);
    await assign("ops", state.invoice, "finance", {}, 400);
    return "Finance ditolak sebagai verifikator maupun penerima umum invoice.";
  });
  await test(16, async () => {
    await letterAction("ops", state.invoice, "RETURN", { comment: "Perbarui nominal dan SPK simulasi." });
    await call("staff", "/api/letters/" + state.invoice, { method: "PATCH", body: {
      business: { total: "110000", due_date: due, requires_spk: true, spk_reference_id: state.spk },
    } });
    await register(state.invoice, "ops", false);
    const invoice = await detail("ops", state.invoice);
    assert.equal(invoice.v11.invoice_revision, 2);
    assert.equal(invoice.v11.verified, false);
    await letterAction("ops", state.invoice, "APPROVE_FINAL", {}, [], 400);
    state.verify = await verify(state.invoice, false);
    return "Nominal/SPK baru menaikkan revisi, bukti lama tetap tersimpan dan tidak berlaku.";
  });
  await test(17, async () => {
    await taskAction("ops", state.verify, "RETURN_RESULT", { note: "Lengkapi bukti simulasi." });
    const returned = await taskDetail("staff", state.verify);
    assert.equal(returned.disposition.status, "IN_PROGRESS");
    assert.equal(returned.disposition.current_owner_user_id, roles.staff.id);
    assert(returned.actions.some(a => a.action === "RETURN_RESULT" && a.note.includes("Lengkapi")));
    await submit("staff", state.verify, "Bukti dilengkapi", ["files"]);
    await taskAction("ops", state.verify, "APPROVE_RESULT");
    return "Return hasil kembali ke Staff, alasan tercatat, hasil kedua diterima.";
  });
  await test(18, async () => {
    await letterAction("ops", state.invoice, "APPROVE");
    await letterAction("dirops", state.invoice, "APPROVE");
    await letterAction("dirut", state.invoice, "APPROVE");
    const invoice = await detail("ksu", state.invoice);
    assert.equal(invoice.letter.status, "APPROVED");
    assert.equal(invoice.v11.payment.status, "OPEN");
    assert.equal(Number(invoice.v11.payment.paid), 0);
    return "ACC Direksi memindahkan approval saja; nominal bayar masih nol.";
  });
  await test(19, async () => {
    const missing = await assign("ksu", state.invoice, "finance", { purpose: "INVOICE_PAYMENT" }, 400);
    assert.match(missing.error, /BPK Pengajuan/);
    await payFile("sdm", state.invoice, "BPK", 403);
    const spk = (await detail("ksu", state.invoice)).v11.payment_documents.documents.find(doc => doc.code === "SPK");
    assert.equal(spk.linked, true);
    await fillPayDocs("staff", state.invoice, payDocuments.filter(code => code !== "SPK"));
    assert.deepEqual((await detail("ksu", state.invoice)).v11.payment_documents.missing, []);
    state.paymentTask = (await assign("ksu", state.invoice, "finance", { purpose: "INVOICE_PAYMENT" })).id;
    const task = await taskDetail("finance", state.paymentTask);
    assert.equal(task.disposition.purpose, "INVOICE_PAYMENT");
    assert.equal(task.disposition.visibility, "PRIVATE");
    await start("finance", state.paymentTask);
    return "Invoice dengan SPK tertaut diblokir bila berkas lain kurang. Finance mendapat instruksi privat begitu lengkap.";
  });
  await test(20, async () => {
    await submit("finance", state.paymentTask, "Pembayaran parsial pertama", ["files"], pay(runId + "-PAY1", 40000));
    const task = await taskDetail("ksu", state.paymentTask);
    assert.equal(task.payments.length, 1);
    assert.equal(task.payments[0].status, "PENDING");
    assert(task.payments[0].bookkeeping_note);
    assert(task.payments[0].evidence_id);
    const invoice = await detail("ksu", state.invoice);
    assert(invoice.v11.payment.payable_id);
    assert.equal(Number(invoice.v11.payment.paid), 0);
    return "Bukti dan pencatatan tersimpan pending; tautan buku utang tersedia.";
  });
  await test(21, async () => {
    await taskAction("ksu", state.paymentTask, "APPROVE_RESULT");
    const invoice = await detail("ksu", state.invoice);
    assert.equal(Number(invoice.v11.payment.paid), 40000);
    assert.equal(Number(invoice.v11.payment.outstanding), 70000);
    assert.equal(invoice.v11.payment.status, "PARTIAL");
    await call("finance", "/api/finance/payables/" + invoice.v11.payment.payable_id,
      { method: "PATCH", body: { paid_amount: 110000 }, status: 409 });
    return "Rp40.000 di-ACC, sisa Rp70.000; buku utang menolak perubahan langsung.";
  });
  await test(22, async () => {
    state.paymentTask2 = (await assign("ksu", state.invoice, "finance", { purpose: "INVOICE_PAYMENT" })).id;
    await start("finance", state.paymentTask2);
    await submit("finance", state.paymentTask2, "Duplikat", ["files"], pay(runId + "-PAY1", 70000), 400);
    await submit("finance", state.paymentTask2, "Lebih bayar", ["files"], pay(runId + "-OVER", 70001), 400);
    const fields = pay(runId + "-PAY2", 70000);
    await Promise.all([1, 2].map(() => submit("finance", state.paymentTask2, "Pelunasan", ["files"], fields, [200, 400])));
    const [[rows]] = await sql.query("SELECT COUNT(*) count FROM siap_v11_payments WHERE letter_id=?", [state.invoice]);
    assert.equal(Number(rows.count), 2);
    return "Referensi berulang dan lebih bayar ditolak; dua submit paralel menghasilkan satu pelunasan pending.";
  });
  await test(23, async () => {
    await letterAction("ksu", state.invoice, "COMPLETE", {}, [], 400);
    await taskAction("ksu", state.paymentTask2, "APPROVE_RESULT");
    const openTask = await assign("ksu", state.invoice, "it");
    await letterAction("ksu", state.invoice, "COMPLETE", {}, [], 400);
    await taskAction("ksu", openTask.id, "CANCEL_TASK", { note: "Dibatalkan dalam simulasi." });
    await letterAction("ksu", state.invoice, "COMPLETE");
    assert.equal((await detail("ksu", state.invoice)).letter.status, "COMPLETED");
    return "Closing ditolak sebelum ACC dan saat tugas aktif. Lunas setelah ACC dan tugas terminal.";
  });
  await test(24, async () => {
    const row = await incoming("invoice-no-spb", { type: "INVOICE_MASUK", business: { total: "70000", due_date: due } });
    await register(row.id);
    assert.equal((await detail("ops", row.id)).v11.spb_attachment_id, null);
    await verify(row.id);
    await letterAction("ops", row.id, "APPROVE_FINAL");
    await payFile("staff", row.id, "SPB", 400);
    await fillPayDocs("staff", row.id, payDocuments.filter(code => code !== "SPK"));
    const blocked = await assign("ksu", row.id, "finance", { purpose: "INVOICE_PAYMENT" }, 400);
    assert.match(blocked.error, /Surat Perintah Kerja/);
    await payFile("staff", row.id, "SPK");
    await assign("ksu", row.id, "finance", { purpose: "INVOICE_PAYMENT" });
    return "Invoice tanpa rujukan tetap butuh berkas SPK sebelum Finance. SPB dikecualikan.";
  });
  await test(25, async () => {
    const row = await post("staff", "/api/letters", {
      direction: "INTERNAL", document_type: "NOTA_DINAS", persekot: true, subject: subject("Persekot"),
      letter_date: old, routing_target_user_id: roles.ops.id, persekot_checklist: ["SPB", "BPK"],
    }, 201);
    state.persekot = row.id;
    await letterAction("staff", row.id, "SUBMIT", {}, [], 400);
    return "Centang SPB tanpa PDF tidak cukup untuk pengajuan.";
  });
  await test(26, async () => {
    await call("staff", "/api/letters/" + state.persekot, { method: "PATCH",
      body: letterForm({ persekot_checklist: ["BPK", "SPK", "MARGIN"] }, ["spb_file"]) });
    await letterAction("staff", state.persekot, "SUBMIT");
    const note = await detail("ops", state.persekot);
    assert(note.v11.spb_attachment_id);
    assert.deepEqual(note.v11.persekot_checklist, ["BPK", "SPK", "MARGIN"]);
    assert.equal(note.letter.status, "MANAGER_REVIEW");
    await letterAction("ops", state.persekot, "APPROVE_FINAL");
    const blocked = await assign("ksu", state.persekot, "finance", { purpose: "REQUEST_PAYMENT" }, 400);
    assert.match(blocked.error, /BPK Pengajuan/);
    await payRecipient("staff", state.persekot, "VENDOR");
    await fillPayDocs("staff", state.persekot, payDocuments.filter(code => code !== "REKENING"));
    const missingAccount = await assign("ksu", state.persekot, "finance", { purpose: "REQUEST_PAYMENT" }, 400);
    assert.match(missingAccount.error, /Rekening Penerima/);
    await payFile("staff", state.persekot, "REKENING");
    await assign("ksu", state.persekot, "finance", {}, 400);
    const task = await assign("ksu", state.persekot, "finance", { purpose: "REQUEST_PAYMENT" });
    await start("finance", task.id);
    await submit("finance", task.id, "Bayar simulasi", [], {}, 400);
    await submit("finance", task.id, "Bayar simulasi", ["files"]);
    await taskAction("ksu", task.id, "APPROVE_RESULT");

    const request = await post("staff", "/api/letters", {
      direction: "INTERNAL", document_type: "NOTA_DINAS", payment_request: true, subject: subject("Nonpersekot"),
      letter_date: old, routing_target_user_id: roles.ops.id,
    }, 201);
    await letterAction("staff", request.id, "SUBMIT");
    await letterAction("ops", request.id, "APPROVE_FINAL");
    await payRecipient("staff", request.id, "NON_VENDOR");
    await fillPayDocs("staff", request.id, payDocuments.filter(code => !["REKENING", "KONTRAK"].includes(code)));
    await payFile("staff", request.id, "SPB", 400);
    const blockedRequest = await assign("ksu", request.id, "finance", { purpose: "REQUEST_PAYMENT" }, 400);
    assert.match(blockedRequest.error, /Kontrak Perjanjian/);
    await payFile("staff", request.id, "KONTRAK");
    assert.deepEqual((await detail("ksu", request.id)).v11.payment_documents.missing, []);
    await assign("ksu", request.id, "finance", { purpose: "REQUEST_PAYMENT" });
    return "Persekot butuh SPB serta rekening vendor. Nonpersekot tetap butuh berkas dasar tanpa SPB; rekening dikecualikan untuk nonvendor.";
  });
  await test(27, async () => {
    state.hierarchy = (await incoming("hirarki")).id;
    await register(state.hierarchy);
    for (const role of ["ops", "dirops", "dirut"]) await letterAction(role, state.hierarchy, "APPROVE");
    await assign("dirut", state.hierarchy, "staff", {}, 400);
    return "Dirut tidak bisa membuat tugas Staff langsung.";
  });
  await test(28, async () => {
    const id = state.hierarchy;
    const a = await assign("dirut", id, "dirops");
    await start("dirops", a.id);
    const b = await assign("dirops", id, "ops", { parent_id: a.id });
    await assign("ops", id, "staff", {}, 400);
    await start("ops", b.id);
    const c = await assign("ops", id, "staff");
    assert.equal(c.parent_id, b.id);
    const linked = await taskDetail("staff", c.id);
    assert.equal(linked.parent.id, b.id);
    const parent = await taskDetail("dirops", b.id);
    assert.equal(parent.children[0].id, c.id);
    assert.deepEqual(linked.sourceAttachments, parent.sourceAttachments);
    assert.equal(linked.sourceAttachments.length, 2);
    for (const file of linked.sourceAttachments) {
      assert((await call("staff", "/api/attachments/" + file.id, { raw: true })).bytes.equals(pdf));
      await call("staffkeu", "/api/attachments/" + file.id, { status: 403 });
    }
    assert.equal(linked.attachments.length, 0);
    await start("staff", c.id);
    for (const [owner, reviewer, task, expected] of [
      ["staff", "ops", c, "REVIEW_MANAGER"], ["ops", "dirops", b, "REVIEW_DIROPS"], ["dirops", "dirut", a, "REVIEW_DIRUT"],
    ]) {
      assert.equal((await submit(owner, task.id)).status, expected);
      assert.equal((await taskAction(reviewer, task.id, "APPROVE_RESULT")).status,"COMPLETED");
    }
    assert.equal((await taskDetail("ops", c.id)).disposition.parent_id, b.id);
    assert.equal((await taskDetail("dirops", b.id)).disposition.parent_id, a.id);
    assert.equal((await detail("dirut", id)).letter.status, "APPROVED");
    return "Dirut → Dirops → Manager → Staff. Manager otomatis meneruskan tugas aktif, lampiran asal dapat dibuka, dan hasil naik per tahap.";
  });
  await test(29, async () => {
    state.parent = (await assign("dirops", state.hierarchy, "ops")).id;
    await start("ops", state.parent);
    state.child1 = (await assign("ops", state.hierarchy, "staff", { parent_id: state.parent })).id;
    await submit("ops", state.parent, "Induk belum selesai", [], {}, 400);
    await taskAction("dirops", state.parent, "CANCEL_TASK", { note: "Anak masih aktif." }, [], 400);
    return "Induk tidak dapat mengirim hasil atau dibatalkan saat anak aktif.";
  });
  await test(30, async () => {
    const other = await assign("dirut", state.hierarchy, "ops");
    const ambiguous = await assign("ops", state.hierarchy, "it", {}, 400);
    assert.match(ambiguous.error, /beberapa disposisi aktif/);
    const child2 = await assign("ops", state.hierarchy, "it", { parent_id: state.parent });
    await taskAction("dirut", other.id, "CANCEL_TASK", { note: "Simulasi jalur lain selesai diuji." });
    await start("staff", state.child1);
    await submit("staff", state.child1);
    await taskAction("ops", state.child1, "APPROVE_RESULT");
    await submit("ops", state.parent, "Anak kedua belum selesai", [], {}, 400);
    await start("it", child2.id);
    await submit("it", child2.id);
    await taskAction("ops", child2.id, "APPROVE_RESULT");
    await submit("ops", state.parent);
    await taskAction("dirops", state.parent, "APPROVE_RESULT");
    return "Dua anak. Satu selesai belum cukup; parent selesai setelah kedua hasil di-ACC.";
  });
  await test(31, async () => {
    state.reviewTask = (await assign("ops", state.general, "staff", { result_requirement: "OUTGOING_LETTER" })).id;
    assert.equal((await detail("ops", state.general)).letter.status, "MANAGER_REVIEW");
    return "Reviewer membuat tugas ketika review tanpa persetujuan otomatis.";
  });
  await test(32, async () => {
    await assign("ksu", state.general, "sdm", {}, 403);
    return "Pengguna yang bukan reviewer tidak dapat membuat tugas review.";
  });
  await test(33, async () => {
    const row = await outgoing("alur-keluar");
    await letterAction("dirut", row.id, "APPROVE", {}, [], [400, 404]);
    await approveOut(row.id, false);
    assert.equal((await detail("secretariat", row.id)).letter.current_role, "SECRETARIAT");
    return "Draf → Manager terpilih → Dirops → Dirut → antrean Sekretariat.";
  });
  await test(34, async () => {
    const row = await outgoing("revisi-keluar");
    await letterAction("staff", row.id, "SUBMIT");
    await letterAction("ops", row.id, "APPROVE");
    await letterAction("dirops", row.id, "RETURN_PREVIOUS", { comment: "Tidak tersedia untuk V11." }, [], 400);
    await letterAction("dirops", row.id, "RETURN", { comment: "Revisi isi surat simulasi." });
    await call("staff", "/api/letters/" + row.id, { method: "PATCH", body: { summary: "Isi hasil revisi" } });
    assert.equal((await letterAction("staff", row.id, "SUBMIT")).status, "MANAGER_REVIEW");
    return "Return Dirops membawa alasan ke penyusun; pengajuan ulang dimulai di Manager.";
  });
  await test(35, async () => {
    const seq = 400000 + parseInt(runId.slice(0, 4), 16);
    const [a,b] = await Promise.all(["ledger-A","ledger-B"].map(label => outgoing(label, { custom_number_base: seq })));
    assert.notEqual(a.letter_number,b.letter_number);
    await Promise.all([a.id,b.id].map(id => approveOut(id, false)));
    await Promise.all([a.id,b.id].map(id => letterAction("secretariat", id, "PREPARE_ISSUE")));
    state.manual = a.id;
    state.mock = b.id;
    return "Reservasi custom paralel memakai variant berbeda; finalisasi memakai nomor yang sama.";
  });
  await test(36, async () => {
    await letterAction("secretariat", state.manual, "ISSUE", { issued_date: d, signature_method: "MEKARI_MANUAL" }, ["signed_file"]);
    const out = await detail("staff", state.manual);
    assert.equal(out.v11.signature_provenance, "MEKARI_MANUAL");
    assert((await call("staff", "/api/attachments/" + out.v11.signature_attachment_id, { raw: true })).bytes.equals(pdf));
    return "Surat terbit dengan provenance unggah PDF Mekari manual.";
  });
  await test(37, async () => {
    for (const name of ["SIMULASI.exe", "SIMULASI-palsu.pdf"]) {
      const data = multipart({ action: "ISSUE", signature_method: "DIGITAL", issued_date: d }, []);
      file(data, "signed_file", name, Buffer.from("bukan PDF"));
      await post("secretariat", "/api/letters/" + state.mock + "/actions", data, 400);
    }
    assert.equal((await detail("secretariat", state.mock)).letter.status, "WAITING_SIGNATURE");
    return "Backend menolak ekstensi .exe dan isi non-PDF dengan ekstensi .pdf.";
  });
  await test(38, async () => {
    const fields = { sent_date: d, dispatch_channel: "EMAIL", dispatch_recipient: "Penerima Simulasi" };
    await letterAction("secretariat", state.manual, "MARK_SENT", fields, [], 400);
    await letterAction("secretariat", state.manual, "MARK_SENT", fields, ["dispatch_file"]);
    const row = await detail("secretariat", state.manual);
    assert.equal(row.letter.status,"ISSUED");
    assert(row.letter.sent_date && row.v11.dispatch_attachment_id);
    assert.equal(row.v11.dispatch_channel, "EMAIL");
    return "Status ISSUED dan tanggal kirim terpisah, dengan kanal, penerima dan bukti.";
  });
  await test(39, async () => {
    await start("staff", state.reviewTask);
    await submit("staff", state.reviewTask, "Surat salah", [], { result_letter_id: state.manual }, 400);
    const row = await outgoing("surat-hasil", { source_disposition_id: state.reviewTask });
    await approveOut(row.id);
    await letterAction("secretariat", row.id, "ISSUE", { issued_date: d, signature_method: "DIGITAL" }, ["signed_file"]);
    await submit("staff", state.reviewTask, "Surat hasil", [], { result_letter_id: row.id });
    await taskAction("ops", state.reviewTask, "APPROVE_RESULT");
    assert.equal((await detail("ops", state.general)).letter.status,"MANAGER_REVIEW");
    const followUp = await assign("ops", row.id, "staff");
    const { sourceActions } = await taskDetail("staff", followUp.id);
    assert(sourceActions.some(action => action.action === "CREATE_OUTGOING"));
    assert(sourceActions.some(action => action.action === "ISSUE" && action.to_status === "ISSUED"));
    return "Surat hasil yang terkait diterima. Riwayat draf dan penerbitan ikut tampil pada disposisi Surat Keluar.";
  });
  await test(40, async () => {
    const nota = await post("ops", "/api/letters", {
      direction: "INTERNAL", document_type: "NOTA_DINAS", letter_date: old, subject: subject("Nota dari Manager"),
      routing_target_user_id: roles.dirut.id,
    }, 201);
    assert.equal((await letterAction("ops", nota.id, "SUBMIT")).status,"PRESIDENT_DIRECTOR_REVIEW");
    await letterAction("dirut", nota.id, "APPROVE");
    const task = await assign("ops", nota.id, "staff");
    const { sourceActions } = await taskDetail("staff", task.id);
    assert(sourceActions.some(action => action.action === "CREATE_INTERNAL"));
    assert(sourceActions.some(action => action.action === "APPROVE" && action.to_status === "APPROVED"));
    return "Riwayat pembuatan Nota Dinas oleh Manager dan persetujuan Dirut tampil pada disposisinya.";
  });
  await test(41, async () => {
    await call("sdm", "/api/attachments/" + state.receipt, { status: 403 });
    const task = await taskDetail("ksu", state.paymentTask);
    await call("ops", "/api/attachments/" + task.payments[0].evidence_id, { status: 403 });
    return "Bukti penerimaan dan bukti bayar menolak user di luar ACL.";
  });
  await test(42, async () => {
    const doc = await detail("ksu", state.invoice);
    assert(doc.actions.some(a => a.action === "REGISTER_INCOMING" && a.created_at && a.actor_name));
    assert(doc.actions.some(a => a.action === "COMPLETE" && a.actor_user_id === roles.ksu.id));
    const task = await taskDetail("ksu", state.paymentTask2);
    assert(task.actions.some(a => a.action === "APPROVE_RESULT" && a.from_status === "REVIEW_MANAGER"));
    assert.equal(task.payments[0].status, "APPROVED");
    assert(task.payments[0].evidence_id);
    return "Riwayat penerimaan, review, disposisi dan bukti bayar memuat actor, waktu dan transisi.";
  });
  await test(43, async () => {
    const url = new URL("https://sandbox-api.mekari.com/v2/esign-hmac/v1/documents?page=1&limit=20");
    const date = new Date("2026-11-17T07:00:00Z");
    const config = { id: "fixture-client", secret: "fixture-only-hmac-test" };
    const expected = createHmac("sha256", config.secret).update(
      "date: Tue, 17 Nov 2026 07:00:00 GMT\nGET /v2/esign-hmac/v1/documents?page=1&limit=20 HTTP/1.1",
    ).digest("base64");
    assert(hmacHeaders("GET", url, config, date).Authorization.includes(expected));
    assert.notEqual(hmacHeaders("GET", url, config, date).Authorization,
      hmacHeaders("GET", new URL(url.origin + url.pathname), config, date).Authorization);
    return { skip: "Sandbox eksternal: kredensial/scope belum tersedia. Tes lokal HMAC full path + query lulus." };
  });
  await test(44, async () => {
    const doc = await detail("secretariat", state.mock);
    const source = doc.attachments.find(a => a.attachment_kind === "ORIGINAL");
    const url = "/api/letters/" + state.mock + "/signing";
    const job = await post("secretariat", url, { action: "START", attachment_id: source.id }, 201);
    const same = await post("secretariat", url, { action: "START", attachment_id: source.id });
    assert.equal(job.id, same.id);
    state.sign = job.id;
    const body = { data: { id: "mock-" + job.id, attributes: { signing_status: "completed" } } };
    const token = createHmac("sha256", env.SIAP_V11_WEBHOOK_SECRET).update("mekari-signing:" + job.id).digest("hex");
    const webhook = "/api/webhooks/mekari/" + job.id;
    await post(null, webhook + "?token=invalid", body, 403);
    assert.equal((await post(null, webhook + "?token=" + token, body)).duplicate, false);
    assert.equal((await post(null, webhook + "?token=" + token, body)).duplicate, true);
    assert.equal((await call("secretariat", url)).status, "IN_PROGRESS");
    return "Mock: token salah 403, dua webhook hanya satu event, status belum berubah tanpa polling.";
  });
  await test(45, async () => {
    const url = "/api/letters/" + state.mock + "/signing";
    const done = await post("secretariat", url, { action: "REFRESH" });
    assert.equal(done.status,"COMPLETED");
    const again = await post("secretariat", url, { action: "REFRESH" });
    assert.equal(again.final_attachment_id,done.final_attachment_id);
    assert((await call("secretariat", "/api/attachments/" + done.final_attachment_id, { raw: true })).bytes.equals(pdf));
    await call("sdm", "/api/attachments/" + done.final_attachment_id, { status: 403 });
    await letterAction("secretariat", state.mock, "ISSUE", { signature_method: "MEKARI_API", issued_date: d });
    assert.equal((await detail("secretariat", state.mock)).v11.signature_provenance, "MEKARI_MOCK");
    return { skip: "Signing eksternal belum dijalankan. Mock lulus: polling, PDF terproteksi, idempoten, provenance dan penerbitan." };
  });
  await test(46, async () => {
    const payable = await post("finance", "/api/finance/payables", {
      counterparty: "SIMULASI Finance existing", invoice_no: runId + "-LEGACY-UTANG",
      invoice_date: old, due_date: due, amount: 90000,
    }, 201);
    await call("finance", "/api/finance/payables/" + payable.id, { method: "PATCH", body: { paid_amount: 10000 } });
    assert.equal(Number((await call("finance", "/api/finance/payables")).find(p => p.id === payable.id).outstanding),80000);
    const bank = await post("finance", "/api/finance/bank-accounts", {
      bank_name: "SIMULASI BANK", account_name: "SIMULASI rekening", account_number: "SIM-" + runId,
      opening_balance: 100000, opening_balance_date: old,
    }, 201);
    await post("finance", "/api/finance/bank-transactions", {
      bank_account_id: bank.id, transaction_at: d + " 10:00:00", description: "SIMULASI credit", credit_amount: 25000,
    }, 201);
    const stmt = await call("finance", "/api/finance/bank-statement?account_id=" + bank.id + "&from=" + old + "&to=" + d);
    assert.equal(Number(stmt.opening_balance), 100000);
    assert.equal(Number(stmt.closing_balance), 125000);
    const accountNo = "00000000" + String(parseInt(runId,16)).padStart(9,"0");
    const importedAccount = await post("finance", "/api/finance/bank-accounts", {
      bank_name: "BRI Simulasi", account_name: "SIMULASI Impor BRI", account_number: accountNo,
      opening_balance: 1000000, opening_balance_date: "2025-01-01",
    }, 201);
    const report = fixturePdf([
      "LAPORAN TRANSAKSI FINANSIAL",
      "STATEMENT OF FINANCIAL TRANSACTION",
      "No. Rekening : " + accountNo,
      "Tanggal Laporan : 31/01/2025",
      "Periode Transaksi : 01/01/2025 - 31/01/2025",
      "Opening Balance   Total Debit   Total Credit   Closing Balance",
      "1,000,000.00     50,000.00     200,000.00     1,150,000.00",
      "04/01/2025 10:00:00  PENERIMAAN  TL0001  0.00  200,000.00  1,200,000.00",
      "05/01/2025 10:00:00  BIAYA  TL0002  50,000.00  0.00  1,150,000.00",
    ]);
    const importBody = () => file(multipart({ account_id: importedAccount.id },[]), "file", "SIMULASI-BRI.pdf", report);
    const imported = await post("finance", "/api/finance/bank-statement/import-bri", importBody(), 201);
    assert.equal(Number(imported.inserted_count),2);
    assert.equal(Number(imported.closing_balance),1150000);
    await post("finance", "/api/finance/bank-statement/import-bri", importBody(), 409);
    return "Utang manual, saldo Rekening Koran, impor BRI fiktif dan deduplikasi lulus.";
  });
  await test(47, async () => {
    const rows = await Promise.all([state.manual, state.mock].map(id => detail("root", id)));
    assert(rows.every(doc => doc.letter.is_backdated && doc.letter.status === "ISSUED"));
    const [ledger] = await sql.query("SELECT rendered_number,status,seq_base,variant FROM siap_number_ledger WHERE letter_id IN (?,?)", [state.manual, state.mock]);
    assert.equal(new Set(ledger.map(r => r.rendered_number)).size, 2);
    assert(ledger.every(row => row.status === "ISSUED" && row.seq_base === ledger[0].seq_base));
    const [columns] = await sql.query("SHOW FULL COLUMNS FROM siap_letters");
    const externalCollation = columns.find(column => column.Field === "external_number").Collation;
    const letterCollation = columns.find(column => column.Field === "letter_number").Collation;
    assert.match(externalCollation, /^utf8mb4_\w+$/);
    const mixed = letterCollation === "utf8mb4_general_ci" ? "utf8mb4_unicode_ci" : "utf8mb4_general_ci";
    const setCollation = value => sql.query(`ALTER TABLE siap_letters MODIFY external_number
      VARCHAR(255) CHARACTER SET utf8mb4 COLLATE ${value} NULL`);
    await setCollation(mixed);
    try {
      for (const { letter } of rows) {
        const params = new URLSearchParams({ for_disposition: "1", limit: "1", q: letter.display_number });
        const [match] = await call("root", "/api/letters?" + params);
        assert.equal(match?.id, letter.id);
      }
      const known = (await detail("ops", state.hierarchy)).letter;
      const hits = await call("ops", "/api/letters?for_disposition=1&q=" + encodeURIComponent(known.external_number));
      assert.equal(hits[0]?.id, known.id);
      assert((await call("ops", "/api/letters?for_disposition=1&q=r")).length > 0);
    } finally {
      await setCollation(externalCollation);
    }
    return "Nomor eksternal dan varian ditemukan dengan kolasi kolom nomor yang berbeda.";
  });
  await test(48, async () => {
    const build = JSON.parse(await readFile(env.SIAP_V11_BUILD_CHECK_FILE, "utf8"));
    assert.deepEqual(build, { ci: 0, typecheck: 0, build: 0 });
    return "npm ci, npm run typecheck, npm run build masing-masing exit 0.";
  });
  await test(49, async () => {
    assert.equal(profile.migrationReapplied, true);
    assert.equal((await detail("gedung", profile.legacy)).letter.current_owner_user_id, roles.gedung.id);
    if (!profile.restoreVerified) return { skip: "Migrasi dan reaplikasi lulus; jalankan restore-check sebelum UAT untuk bukti backup." };
    return "Migrasi dua kali; baris lama identik; backup berhasil dipulihkan dan cocok pada "+profile.restoredTables+" tabel.";
  });
  await test(50, async () => {
    const browser = await chromium.launch({ executablePath: env.SIAP_V11_CHROMIUM || undefined, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage"] });
    async function pageFor(role, mobile) {
      const context = await browser.newContext({ viewport: mobile ? { width:390,height:844 } : { width:1440,height:960 } });
      const cookie = sessions.get(role).split("=");
      await context.addCookies([{ name: cookie[0], value: cookie[1], url: base.origin }]);
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on("pageerror", error => console.log("Browser error:", error.message.slice(0, 100)));
      return page;
    }
    try {
      const row = await incoming("demo-ui-mobile", { receiptFile: true });
      const mobile = await pageFor("secretariat", true);
      await mobile.goto(new URL("/letters/incoming?letter_id=" + row.id, base).href);
      const registration = mobile.getByRole("button", { name: "Registrasi & Teruskan", exact: true });
      await registration.waitFor({state:"visible"});
      await registration.evaluate(el=>el.scrollIntoView({block:"center", inline:"nearest"}));
      await registration.click();
      const receiptInput = mobile.locator('input[name="receipt_file"]');
      await receiptInput.waitFor({ state: "visible" });
      assert.equal(await receiptInput.getAttribute("required"), null);
      const receiptPreview = mobile.getByRole("dialog").last().getByRole("button", { name: "Pratinjau", exact: true });
      await receiptPreview.click();
      const preview = mobile.getByRole("dialog").last();
      await preview.locator(".pdf-page canvas").waitFor({ state: "visible" });
      await mobile.screenshot({ path: path.join(out, "00-preview-bukti-serah-terima.png") });
      await preview.getByRole("button", { name: "Tutup dialog" }).click();
      assert(await mobile.locator('input[name="received_time"]').isVisible());
      const managerOptions = await mobile.getByRole("combobox", { name: "Teruskan kepada" }).locator("option").allTextContents();
      assert.deepEqual(managerOptions.slice(1).sort(), ["Manager Keuangan, SDM & Umum", "Manager Operasional"].sort());
      assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await mobile.screenshot({ path: path.join(out, "01-penerimaan-mobile.png") });
      const registrationFile = "SIMULASI-Catatan-Registrasi.pdf";
      await mobile.getByRole("dialog").last().locator('input[type="file"]:not([name])').setInputFiles({
        name: registrationFile, mimeType: "application/pdf", buffer: pdf,
      });
      const save = mobile.getByRole("button", { name: "Registrasi & Teruskan", exact: true }).last();
      await Promise.all([mobile.waitForResponse(res => res.url().endsWith("/actions") && res.request().method()==="POST" && res.ok()), save.click()]);
      await mobile.getByRole("button", { name: "Terapkan", exact: true }).click();
      await mobile.getByRole("row").filter({ hasText: subject("demo-ui-mobile") }).waitFor();
      const desktop = await pageFor("ops", false);
      await desktop.goto(new URL("/dispositions?letter_id=" + row.id, base).href);
      const documentSearch = desktop.getByRole("combobox", { name: /^Dokumen\b/ });
      const documentId = desktop.locator('input[name="letter_id"]');
      const matches = desktop.getByRole("listbox", { name: "Hasil pencarian dokumen" });
      await desktop.locator(`input[name="letter_id"][value="${row.id}"]`).waitFor({ state: "attached" });
      assert((await documentSearch.inputValue()).includes(subject("demo-ui-mobile")));
      await desktop.getByRole("button", { name: "Batal", exact: true }).click();
      await desktop.getByRole("button", { name: "+ Buat Disposisi", exact: true }).click();
      assert.equal(await documentSearch.inputValue(), "");

      await desktop.route(url => url.pathname === "/api/letters" &&
        url.searchParams.get("for_disposition") === "1" && url.searchParams.get("q") === "r",
      route => route.fulfill({ status: 502, body: "" }), { times: 1 });
      await documentSearch.fill("r");
      await desktop.getByRole("alert").filter({ hasText: "Pencarian dokumen belum tersedia." }).waitFor();
      await desktop.getByRole("button", { name: "Coba Lagi", exact: true }).click();
      await matches.waitFor();
      assert.equal(await documentSearch.inputValue(), "r");

      await documentSearch.fill(runId + "-dokumen-tidak-ada");
      await desktop.getByText("Tidak ada dokumen yang cocok.", { exact: true }).waitFor();
      assert.equal(await documentId.inputValue(), "");
      assert.equal(await documentSearch.evaluate(input => input.validity.valid), false);

      await desktop.setViewportSize({ width: 390, height: 844 });
      const match = matches.getByRole("option", { name: new RegExp(subject("demo-ui-mobile")) });
      await documentSearch.fill("demo-ui-mobile");
      await match.waitFor();
      assert(await matches.evaluate(list => list.scrollWidth <= list.clientWidth + 1));
      await match.click();
      assert.equal(await documentId.inputValue(), row.id);
      await matches.waitFor({ state: "hidden" });

      await desktop.setViewportSize({ width: 1440, height: 960 });
      await documentSearch.fill(row.external_number);
      await match.waitFor();
      assert.equal(await documentId.inputValue(), "");
      await documentSearch.press("ArrowDown");
      await documentSearch.press("Enter");
      assert.equal(await documentId.inputValue(), row.id);
      assert.equal(await documentSearch.evaluate(input => input.validity.valid), true);
      await matches.waitFor({ state: "hidden" });
      await desktop.getByRole("combobox", { name: "Diteruskan kepada" }).selectOption(roles.staff.id);
      await desktop.locator('textarea[name="instruction"]').fill("SIMULASI tindak lanjut dari UI");
      await desktop.screenshot({ path: path.join(out, "02-disposisi-desktop.png") });
      const taskResponse = await Promise.all([
        desktop.waitForResponse(res => res.url().endsWith("/api/dispositions") && res.request().method()==="POST" && res.ok()),
        desktop.getByRole("button", {name:"Kirim Disposisi",exact:true}).click(),
      ]);
      const { data: task } = await taskResponse[0].json();
      assert.equal((await taskDetail("ops", task.id)).disposition.letter_id, row.id);
      const staff = await pageFor("staff", true);
      await staff.goto(new URL("/dispositions?disposition_id=" + task.id, base).href);
      const taskDialog=staff.getByRole("dialog");
      await taskDialog.getByRole("heading", { name: "Riwayat Disposisi", exact: true }).waitFor();
      const sourceHistory = taskDialog.locator("details").filter({
        hasText: "Riwayat Surat Masuk Asal",
      });
      const registered = sourceHistory.locator(".timeline-row").filter({ hasText: "Surat Diregistrasi" });
      assert.equal(await sourceHistory.getAttribute("open"), null);
      assert.equal(await registered.isVisible(), false);
      await sourceHistory.locator("summary").click();
      await registered.getByText(registrationFile, { exact: true }).waitFor();
      assert(await taskDialog.getByText(/^Disposisi dibuat/).isVisible());
      assert(await sourceHistory.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await staff.screenshot({ path: path.join(out, "02b-riwayat-dokumen-asal-mobile.png") });
      await registered.getByRole("button", { name: "Pratinjau", exact: true }).click();
      const historyPreview = taskDialog.last();
      await historyPreview.locator(".pdf-page canvas").waitFor();
      await historyPreview.getByRole("button", { name: "Tutup dialog" }).click();
      const sourceFiles = taskDialog.locator("section").filter({
        has: staff.getByRole("heading", { name: "Lampiran Surat Asal", exact: true }),
      });
      await sourceFiles.getByText("Bukti serah terima", { exact: false }).waitFor();
      await sourceFiles.getByRole("button", { name: "Pratinjau" }).first().click();
      const sourcePreview = taskDialog.last();
      await sourcePreview.locator(".pdf-page canvas").waitFor();
      await sourcePreview.getByRole("button", { name: "Tutup dialog" }).click();
      const startButton=taskDialog.getByRole("button", { name: "Mulai", exact: true });
      await startButton.evaluate(el=>el.scrollIntoView({block:"center"}));
      await startButton.click();
      const resultButton=taskDialog.getByRole("button", { name: "Kirim Hasil", exact: true });
      await resultButton.evaluate(el=>el.scrollIntoView({block:"center"}));
      await resultButton.click();
      assert(await staff.locator('textarea[name="note"]').isVisible());
      assert(await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await staff.screenshot({ path: path.join(out, "03-hasil-tugas-mobile.png") });
      const fin = await pageFor("ksu", false);
      await fin.goto(new URL("/letters/incoming?letter_id=" + state.invoice, base).href);
      const paid = fin.getByText("Bayar di-ACC", { exact: true });
      await paid.evaluate(el=>el.scrollIntoView({block:"center"}));
      await fin.screenshot({ path: path.join(out, "04-invoice-lunas.png") });
      await desktop.goto(new URL("/dispositions?disposition_id=" + task.id, base).href);
      const downloaded = desktop.waitForEvent("download");
      await desktop.getByRole("link", { name: "Unduh Riwayat (.xlsx)", exact: true }).click();
      assert.match((await downloaded).suggestedFilename(), /^riwayat-disposisi-BIASA-.*\.xlsx$/);

      const parentInstruction = subject("Tugas Dirops untuk pengujian delegasi UI");
      const childInstruction = subject("Delegasi UI ke Staff");
      const rootTask = await assign("dirops", state.hierarchy, "ops", { instruction: parentInstruction });
      await start("ops", rootTask.id);
      await desktop.goto(new URL("/dispositions?disposition_id=" + rootTask.id, base).href);
      await desktop.getByRole("button", { name: "Teruskan ke PIC", exact: true }).click();
      const delegateDialog = desktop.getByRole("dialog", { name: "Teruskan Disposisi" });
      assert.equal(await delegateDialog.locator('input[name="letter_id"]').inputValue(), state.hierarchy);
      await delegateDialog.getByRole("combobox", { name: "Diteruskan kepada" }).selectOption(roles.staff.id);
      await delegateDialog.locator('textarea[name="instruction"]').fill(childInstruction);
      await delegateDialog.getByRole("button", { name: "Kirim Disposisi", exact: true }).click();
      await desktop.getByRole("button", { name: "Buka Delegasi", exact: true }).click();
      await desktop.getByRole("button", { name: "Buka Tugas Asal", exact: true }).waitFor();
      const childRow = desktop.getByRole("row").filter({ hasText: childInstruction });
      assert(await childRow.evaluate((row, expected) => row.previousElementSibling?.textContent?.includes(expected), parentInstruction));

      const cleanup = await incoming("hapus-permanen-ui");
      const admin = await pageFor("root", false);
      await admin.goto(new URL("/letters/incoming", base).href);
      const rowFor = () => admin.getByRole("row").filter({ hasText: subject("hapus-permanen-ui") });
      await rowFor().getByRole("button", { name: "Pindah ke Sampah", exact: true }).click();
      const dialog = admin.getByRole("dialog");
      await dialog.getByLabel("Alasan").fill("SIMULASI pindah ke Sampah");
      await dialog.getByRole("button", { name: "Pindah ke Sampah", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await admin.getByRole("button", { name: "Sampah", exact: true }).click();
      await rowFor().getByRole("button", { name: "Hapus Permanen", exact: true }).click();
      await dialog.getByLabel("Alasan").fill("SIMULASI hapus permanen dari browser");
      await dialog.getByLabel("Ketik HAPUS PERMANEN").fill("HAPUS PERMANEN");
      await dialog.getByRole("button", { name: "Hapus Permanen", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await rowFor().waitFor({ state: "hidden" });
      await call("root", "/api/letters/" + cleanup.id, { status: 404 });
      return "Chromium 390/1440 px: riwayat disposisi tampil utama, riwayat surat dapat dibuka dan lampiran proses dapat dipratinjau.";
    } finally {
      await browser.close();
    }
  });

  await test(51, async () => {
    const config = "/api/admin/correspondence-settings";
    assert.equal((await call("staff", config)).defaultRecipient, "PT Aru Raharja");
    const row = await incoming("tujuan-default");
    assert.equal((await detail("staff", row.id)).letter.recipient, "PT Aru Raharja");
    const patch = body => call("root", config, { method: "PATCH", body });
    await call("staff", config, { method: "PATCH", body: { kind: "recipients" }, status: 403 });
    try {
      await patch({ kind: "recipients", recipients: ["PT Aru Raharja", "PT Aru Raharja - SIMULASI"],
        defaultRecipient: "PT Aru Raharja - SIMULASI" });
      const other = await incoming("tujuan-diatur");
      assert.equal((await detail("secretariat", other.id)).letter.recipient, "PT Aru Raharja - SIMULASI");
    } finally {
      await patch({ kind: "recipients", recipients: ["PT Aru Raharja"], defaultRecipient: "PT Aru Raharja" });
    }
    return "Tujuan default Surat Masuk dan perubahan melalui Root Admin terverifikasi.";
  });
  await test(52, async () => {
    const row = await outgoing("undo-persetujuan");
    await letterAction("staff", row.id, "SUBMIT");
    const approval = await letterAction("ops", row.id, "APPROVE");
    const request = { approval_id: approval.actionId, comment: "SIMULASI koreksi reviewer" };
    assert.equal((await detail("ops", row.id)).approvalId, approval.actionId);
    assert(!((await detail("dirops", row.id)).approvalId));
    await letterAction("dirops", row.id, "UNDO_APPROVAL", request, [], 400);
    const restored = await letterAction("ops", row.id, "UNDO_APPROVAL", request, []);
    assert.equal(restored.status, "MANAGER_REVIEW");
    const returned = await detail("ops", row.id);
    assert.equal(returned.letter.current_owner_user_id, roles.ops.id);
    assert(returned.actions.some(action => action.action === "UNDO_APPROVAL" && action.comment.includes(request.comment)));
    await letterAction("ops", row.id, "UNDO_APPROVAL", request, [], 400);
    const next = await letterAction("ops", row.id, "APPROVE");
    await letterAction("dirops", row.id, "APPROVE");
    await letterAction("ops", row.id, "UNDO_APPROVAL", { ...request, approval_id: next.actionId }, [], 400);
    const final = await letterAction("dirut", row.id, "APPROVE");
    await letterAction("secretariat", row.id, "PREPARE_ISSUE");
    await letterAction("root", row.id, "UNDO_APPROVAL", { ...request, approval_id: final.actionId }, [], 400);
    return "Persetujuan Surat Keluar dapat dikoreksi sekali oleh reviewer; otorisasi, aksi berikutnya, dan tahap tanda tangan memblokir koreksi lama.";
  });
  await test(53, async () => {
    const f = profile.format;
    const preview = () => call("staff", "/api/admin/number-formats/preview?" +
      new URLSearchParams({ format_id: f.id, date: d, base: "654321" }));
    const estimate = await preview();
    assert.equal((await preview()).rendered, estimate.rendered);
    const row = await outgoing("versi-draf", { custom_number_base: "654321", letter_date: d });
    const original = await detail("staff", row.id);
    assert.equal(original.letter.letter_number, estimate.rendered);
    await letterAction("staff", row.id, "SUBMIT");
    await letterAction("ops", row.id, "RETURN", { comment: "SIMULASI revisi versi" });
    const revision = file(multipart({ kind: "ORIGINAL" }, []), "file", "SIMULASI-revisi.pdf",
      fixturePdf(["Draft revisi untuk pengujian"]));
    await post("staff", "/api/letters/" + row.id + "/attachments", revision, 201);
    const revised = await detail("staff", row.id);
    assert.notEqual(revised.originalId, original.originalId);
    assert(revised.attachments.some(file => file.id === original.originalId));
    assert(revised.attachments.some(file => file.id === revised.originalId && file.original_name === "SIMULASI-revisi.pdf"));
    assert.equal((await letterAction("staff", row.id, "SUBMIT")).status, "MANAGER_REVIEW");
    return "Perkiraan nomor cocok dengan ledger; draft revisi menjadi dokumen utama dan versi terdahulu tetap tersedia.";
  });
  await test(54, async () => {
    const row = await incoming("pic-konfigurasi");
    await register(row.id);
    const config = "/api/admin/correspondence-settings";
    assert.equal((await call("ops", config)).delegation, null);
    await assign("ops", row.id, "staffkeu", { due_date: due, due_time: "13:45" }, 400);
    const choose = userIds => call("root", config, {
      method: "PATCH", body: { kind: "delegation", managerId: roles.ops.id, userIds },
    });
    try {
      await choose([roles.staffkeu.id]);
      assert.deepEqual((await call("ops", config)).delegation, [roles.staffkeu.id]);
      await assign("ops", row.id, "staff", {}, 400);
      await assign("ops", row.id, "staffkeu", { due_time: "13:45" }, 400);
      const task = await assign("ops", row.id, "staffkeu", { due_date: due, due_time: "13:45", priority: "HIGH" });
      assert.equal((await taskDetail("staffkeu", task.id)).disposition.due_time, "13:45:00");
      const alert = (await call("staffkeu", "/api/notifications")).items.find(item => item.href.endsWith(task.id));
      assert.equal(alert.due_time, "13:45:00");
      assert.equal(alert.actor_name, "SIMULASI Manager Operasional");
      assert.equal(alert.event_status, "UNSEEN");
      const found = await call("ops", "/api/letters?for_disposition=1&q=" + encodeURIComponent("pic-konfigurasi"));
      assert(found.some(letter => letter.id === row.id));
    } finally { await choose(null); }
    const payRequest = await post("staff", "/api/letters", {
      direction: "INTERNAL", document_type: "NOTA_DINAS", payment_request: true, subject: subject("Finance-return"),
      letter_date: old, routing_target_user_id: roles.ops.id,
    }, 201);
    await letterAction("staff", payRequest.id, "SUBMIT");
    await letterAction("ops", payRequest.id, "APPROVE_FINAL");
    await payRecipient("staff", payRequest.id, "NON_VENDOR");
    await fillPayDocs("staff", payRequest.id, payDocuments.filter(code => code !== "REKENING"));
    const request = await assign("ksu", payRequest.id, "finance", { purpose: "REQUEST_PAYMENT" });
    assert.equal((await taskDetail("finance", request.id)).paymentDocuments.missing.length, 0);
    await taskAction("finance", request.id, "RETURN_TASK", {}, [], 400);
    await taskAction("finance", request.id, "RETURN_TASK", { note: "SIMULASI bukti perlu diperbarui" });
    assert.equal((await taskDetail("ksu", request.id)).disposition.status, "RETURNED");
    assert.equal((await detail("ksu", payRequest.id)).letter.status, "APPROVED");
    await assign("ksu", payRequest.id, "finance", { purpose: "REQUEST_PAYMENT" });
    return "PIC khusus, pencarian server, tenggat WIB, dan pengembalian Finance ke KSU dengan alasan lulus.";
  });
  await test(55, async () => {
    const row = await incoming("sampah", { receiptFile: true });
    await register(row.id, "ops", false);
    const task = await assign("ops", row.id, "staff");
    const record = await detail("secretariat", row.id);
    assert.equal((await call("secretariat", "/api/attachments/" + record.v11.receipt_attachment_id + "?preview=1", { raw: true }))
      .response.headers.get("content-type"), "application/pdf");
    await call("staffkeu", "/api/attachments/" + record.originalId + "?preview=1", { status: 403 });
    await post("secretariat", "/api/letters/" + row.id + "/trash", { operation: "trash", reason: "SIMULASI" }, 403);
    const issued = await detail("root", state.manual);
    const drafts = await outgoing("hapus-draf");
    for (const id of [row.id, issued.letter.id, drafts.id, state.invoice]) {
      await post("root", "/api/letters/" + id + "/trash", { operation: "trash", reason: "SIMULASI tinjau Sampah" });
      await call("root", "/api/letters/" + id, { status: 404 });
    }
    await call("secretariat", "/api/attachments/" + record.originalId + "?preview=1", { status: [403,404] });
    await call("staff", "/api/dispositions/" + task.id, { status: 404 });
    await taskAction("staff", task.id, "START", {}, [], 400);
    const trash = await call("root", "/api/letters?trash=1");
    assert([row.id, issued.letter.id, drafts.id, state.invoice].every(id => trash.some(letter => letter.id === id)));
    await call("staff", "/api/letters?trash=1", { status: 403 });
    for (const id of [row.id, issued.letter.id, drafts.id, state.invoice]) {
      await post("root", "/api/letters/" + id + "/trash", { operation: "restore", reason: "SIMULASI pulihkan surat" });
    }
    assert.equal((await detail("root", state.manual)).letter.letter_number, issued.letter.letter_number);
    assert.equal((await detail("ksu", state.invoice)).v11.payment.status, "PAID");
    assert.equal((await taskDetail("staff", task.id)).disposition.status, "UNSEEN");
    return "Sampah Root menyembunyikan surat draf, diproses, terbit, dan selesai; pemulihan mempertahankan lampiran, tugas, nomor, dan saldo.";
  });
  await test(56, async () => {
    const before = (await call("ksu", "/api/notifications")).unread;
    assert(before > 0);
    await call("staffkeu", "/api/notifications", { method: "PATCH", body: { all: true } });
    assert.equal((await call("ksu", "/api/notifications")).unread, before);
    await call("ksu", "/api/notifications", { method: "PATCH", body: { all: true } });
    assert.equal((await call("ksu", "/api/notifications")).unread, 0);
    assert((await call("ksu", "/api/notifications")).items.every(item => item.read_at));
    return "Tandai semua telah dibaca bekerja hanya untuk notifikasi akun aktif.";
  });
  await test(57, async () => {
    const sheet = (workbook, name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "" });
    const report = async (role, id) => {
      const { bytes, response } = await call(role, "/api/dispositions/" + id + "/export", { raw: true });
      assert.match(response.headers.get("content-type"), /spreadsheetml/);
      assert.match(response.headers.get("cache-control"), /no-store/);
      return XLSX.read(bytes, { type: "buffer" });
    };
    const reference = "=SIMULASI Teks, bukan formula";
    const approvalNote = "SIMULASI catatan review surat asal";
    const secret = await incoming("ekspor-rahasia", { confidentiality: "RAHASIA" });
    await register(secret.id);
    await letterAction("ops", secret.id, "APPROVE", { comment: approvalNote });
    const parent = await assign("dirops", secret.id, "ops", { visibility: "PUBLIC", due_date: due, due_time: "13:45" });
    assert.equal((await taskDetail("ops", parent.id)).disposition.visibility, "ROUTE");
    await start("ops", parent.id);
    const child = await assign("ops", secret.id, "staff", { parent_id: parent.id, visibility: "PRIVATE" });
    assert.deepEqual((await taskDetail("dirops", parent.id)).children, []);
    await start("staff", child.id);
    await submit("staff", child.id, reference, ["files"]);
    assert.equal(sheet(await report("dirops", parent.id), "Tugas").length, 2, "Jangan ekspor tugas turunan privat bagi Dirops.");
    const full = await report("ops", parent.id);
    assert.equal(sheet(full, "Ringkasan").find(row => row[0] === "Sifat surat")[1], "RAHASIA");
    assert.equal(sheet(full, "Tugas").length, 3);
    assert.match(sheet(full, "Tugas")[1][9], /13:45 WIB/);
    assert(sheet(full, "Lampiran").some(row => row[0] === "1.1" && row[2] === "SIMULASI-dokumen.pdf"));
    assert.equal(sheet(full, "Lampiran").filter(row => row[0] === "Surat asal").length, 2);
    const sourceLog = sheet(full, "Riwayat Dokumen Asal");
    const registrationIndex = sourceLog.findIndex(row => row[2] === "Surat Diregistrasi");
    assert(registrationIndex > 0);
    assert.match(sourceLog[registrationIndex][1], /WIB$/);
    assert.deepEqual(sourceLog[registrationIndex].slice(5, 7), ["SECRETARIAT_INTAKE", "MANAGER_REVIEW"]);
    assert(sourceLog.some(row => row[7].includes(approvalNote)));
    assert(sheet(full, "Lampiran").some(row => row[0] === "Surat asal" && row[1] === registrationIndex));
    const log = sheet(full, "Log Proses");
    const resultIndex = log.findIndex(row => row[8] === reference);
    assert(resultIndex > 0);
    assert.equal(log[resultIndex][3], "Hasil dikirim");
    assert.match(log[resultIndex][2], /WIB$/);
    const resultCell = full.Sheets["Log Proses"]["I" + (resultIndex + 1)];
    assert.equal(resultCell.t, "s");
    assert.equal(resultCell.f, undefined);

    // Simulate an old PUBLIC disposition linked to a confidential letter.
    await sql.execute("UPDATE siap_dispositions SET visibility='PUBLIC' WHERE id=?", [parent.id]);
    await call("staffkeu", "/api/dispositions/" + parent.id, { status: 404 });
    await call("staffkeu", "/api/dispositions/" + parent.id + "/export", { status: 404 });
    for (const confidentiality of ["BIASA", "PENTING"]) {
      const row = await incoming("ekspor-" + confidentiality, { confidentiality });
      await register(row.id);
      const task = await assign("ops", row.id, "staff");
      const sheetRows = sheet(await report("staff", task.id), "Ringkasan");
      assert.equal(sheetRows.find(row => row[0] === "Sifat surat")[1], confidentiality);
      if (confidentiality === "BIASA") {
        await sql.execute("UPDATE siap_dispositions SET visibility='PUBLIC' WHERE id=?", [task.id]);
        await call("staffkeu", "/api/letters/" + row.id, { status: 403 });
        const publicTask = await taskDetail("staffkeu", task.id);
        assert(publicTask.actions.some(action => action.action === "CREATE"));
        assert.deepEqual(publicTask.sourceActions, []);
        assert.deepEqual(publicTask.sourceAttachments, []);
        const publicWorkbook = await report("staffkeu", task.id);
        assert.equal(sheet(publicWorkbook, "Riwayat Dokumen Asal").length, 1);
        assert.equal(sheet(publicWorkbook, "Lampiran").length, 1);
      }
    }
    const [[audit]] = await sql.query(
      "SELECT user_id FROM siap_audit_logs WHERE action='DISPOSITION_EXPORT' AND entity_id=? ORDER BY id DESC LIMIT 1", [parent.id],
    );
    assert.equal(audit.user_id, roles.ops.id);
    return "Excel memuat riwayat disposisi dan dokumen asal, termasuk kaitan lampiran. Akses PUBLIC tidak membocorkan riwayat surat.";
  });
  await test(58, async () => {
    const reason = "SIMULASI uji penghapusan permanen";
    const request = { operation: "purge", reason, confirmation: "HAPUS PERMANEN" };
    const row = await incoming("purge-aktif", { receiptFile: true });
    await register(row.id, "ops", false);
    const task = await assign("ops", row.id, "staff");
    await start("staff", task.id);
    await post("staff", "/api/dispositions/" + task.id + "/attachments", multipart({}, ["file"]), 201);
    const url = "/api/letters/" + row.id + "/trash";
    await post("root", url, request, 409);
    await post("root", url, { operation: "trash", reason });
    await post("ops", url, request, 403);
    await post("root", url, { ...request, confirmation: "HAPUS" }, 400);
    const [activeFiles] = await sql.query("SELECT id,storage_path FROM siap_attachments WHERE letter_id=?", [row.id]);
    assert(activeFiles.length >= 3);
    const [a,b] = await Promise.all([post("root", url, request, [200,404]), post("root", url, request, [200,404])]);
    assert.equal([a,b].filter(item=>item.pending===0).length, 1);
    for (const file of activeFiles) {
      await call("root", "/api/attachments/" + file.id, { status: 404 });
      await assert.rejects(readFile(file.storage_path), { code: "ENOENT" });
    }
    await call("root", "/api/dispositions/" + task.id + "/export", { status: 404 });
    await post("root", url, { operation: "restore", reason }, 404);
    const [[audit]] = await sql.query("SELECT COUNT(*) total FROM siap_audit_logs WHERE action='LETTER_PURGE' AND entity_id=?", [row.id]);
    assert.equal(audit.total, 1);
    const [[actions]] = await sql.query("SELECT COUNT(*) total FROM siap_disposition_actions WHERE disposition_id=?", [task.id]);
    assert.equal(actions.total, 0);

    const issued = await detail("root", state.mock);
    const [signedFiles] = await sql.query("SELECT storage_path FROM siap_attachments WHERE letter_id=?", [state.mock]);
    const [[number]] = await sql.query("SELECT id,status FROM siap_number_ledger WHERE letter_id=?", [state.mock]);
    await post("root", "/api/letters/" + state.mock + "/trash", { operation: "trash", reason });
    await sql.execute("UPDATE siap_v11_signing SET status='IN_PROGRESS' WHERE letter_id=?", [state.mock]);
    assert.match((await post("root", "/api/letters/" + state.mock + "/trash", request, 409)).error, /tanda tangan/);
    await sql.execute("UPDATE siap_v11_signing SET status='COMPLETED' WHERE letter_id=?", [state.mock]);
    await post("root", "/api/letters/" + state.mock + "/trash", request);
    const [[kept]] = await sql.query("SELECT letter_id,rendered_number,status FROM siap_number_ledger WHERE id=?", [number.id]);
    assert.equal(kept.letter_id, null);
    assert.equal(kept.rendered_number, issued.letter.letter_number);
    assert.equal(kept.status, "ISSUED");
    for (const file of signedFiles) await assert.rejects(readFile(file.storage_path), { code: "ENOENT" });
    return "Root menghapus surat aktif dan terbit. Catatan audit dan nomor terbit tetap tersedia. Surat, tugas, bukti, dan pekerjaan tanda tangan selesai terhapus.";
  });
  await test(59, async () => {
    const reason = "SIMULASI proteksi dan retry hapus";
    const request = { operation: "purge", reason, confirmation: "HAPUS PERMANEN" };
    const invoice = "/api/letters/" + state.invoice + "/trash";
    await post("root", invoice, { operation: "trash", reason });
    assert.match((await post("root", invoice, request, 409)).error, /Finance/);
    await post("root", invoice, { operation: "restore", reason });
    assert.equal((await detail("ksu", state.invoice)).v11.payment.status, "PAID");

    const raw = await incoming("purge-retry");
    const route = "/api/letters/" + raw.id + "/trash";
    const [[file]] = await sql.query("SELECT storage_path FROM siap_attachments WHERE letter_id=?", [raw.id]);
    assert(file.storage_path.startsWith(env.UPLOAD_DIR + path.sep));
    const pendingUrl = "/api/admin/letter-purge-files";
    const testPath = file.storage_path + ".simulasi";
    await rename(file.storage_path, testPath);
    await mkdir(file.storage_path);
    try {
      await post("root", route, { operation: "trash", reason });
      assert.equal((await post("root", route, request)).pending, 1);
      assert.equal((await call("root", pendingUrl)).pending, 1);
      await post("staff", pendingUrl, {}, 403);
    } finally {
      await rmdir(file.storage_path);
      await rename(testPath, file.storage_path);
    }
    assert.equal((await post("root", pendingUrl)).pending, 0);
    await assert.rejects(readFile(file.storage_path), { code: "ENOENT" });
    return "Dokumen terhubung Finance terlindungi. Jika penyimpanan gagal, pembersihan berkas dapat diulang setelah purge sudah tercatat.";
  });
} finally {
  await sql.end();
  await writeFile(path.join(out, "uat.json"), JSON.stringify({ runId, db: profile.version, cases: result }, null, 2));
}
const totals = Object.fromEntries(["PASS","FAIL","SKIP"].map(status => [status,result.filter(row=>row.status===status).length]));
console.log(JSON.stringify(totals));
if (totals.FAIL || result.length !== 59) process.exitCode=1;
