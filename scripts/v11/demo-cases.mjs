import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { fixturePdf } from "../../tests/v11/fixture-pdf.mjs";

const env = process.env;
const profile = JSON.parse(await readFile(env.SIAP_V11_STAGE_PROFILE, "utf8"));
const url = new URL(profile.appUrl);
if (env.SIAP_V11_STAGE !== "1" || env.DB_HOST !== "127.0.0.1" || env.SIAP_V11_ENABLED !== "1" ||
    !/^v11_stage_[a-z0-9]+$/.test(env.DB_USER ?? "") ||
    !/^siap_aru_sqa_v11_[a-z0-9]{4,24}$/.test(env.DB_NAME ?? "") || profile.schema !== env.DB_NAME ||
    Number(profile.port) !== Number(env.DB_PORT) || url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
    !Object.values(profile.accounts).every(account => account.email.endsWith("@simulasi.siap.invalid"))) {
  throw new Error("Data demo hanya dibuat pada profil simulasi lokal.");
}
const sql = await mysql.createConnection({
  host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD,
});
const sessions = new Map();
const file = path.join(path.dirname(env.SIAP_V11_STAGE_PROFILE), "demo-pak-nor.json");
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date());
const addDays = days => new Date(Date.parse(today + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const receipt = {
  received_date: today, received_time: "09:00", delivery_method: "FISIK",
  delivered_by: "Kurir Simulasi", received_by: "Sekretariat Simulasi", receipt_note: "Dokumen fiktif untuk demo Pak Nor",
};

async function call(role, route, body, allowed = [200]) {
  if (!sessions.has(role)) {
    const account = profile.accounts[role];
    const login = await fetch(new URL("/api/auth/login", url), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: account.email, password: env.SIAP_V11_STAGE_PASSWORD }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!login.ok) throw new Error("Login akun simulasi " + role + " gagal.");
    sessions.set(role, login.headers.get("set-cookie")?.split(";")[0]);
  }
  const headers = { Cookie: sessions.get(role) };
  if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(new URL(route, url), {
    method: body ? "POST" : "GET", headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!allowed.includes(response.status) || !result.ok) throw new Error("Langkah demo gagal pada " + route.split("?")[0] + " (HTTP " + response.status + ").");
  return result.data;
}
function form(fields, attachmentKey, filename, text) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
  data.set(attachmentKey, new Blob([fixturePdf(text)], { type: "application/pdf" }), filename);
  return data;
}
async function document(subject) {
  const [rows] = await sql.query(
    "SELECT id,status FROM siap_letters WHERE subject=? AND created_by=? ORDER BY created_at LIMIT 1",
    [subject, profile.accounts.staff.id],
  );
  return rows[0];
}
async function incoming(sender, number, subject, business) {
  let row = await document(subject);
  if (!row) {
    row = await call("staff", "/api/letters", form({ metadata: JSON.stringify({
      direction: "INCOMING", document_type: business ? "INVOICE_MASUK" : "SURAT_MASUK_UMUM",
      subject, sender, external_number: number, letter_date: today, requesting_unit: "OPS",
      routing_target_user_id: profile.accounts.ops.id, ...receipt, ...(business ? { business } : {}),
    }) }, "original_file", "SIMULASI-" + (business ? "invoice.pdf" : "surat.pdf"), [
      "SIMULASI - DATA FIKTIF", sender, number, subject, business ? "Nilai tagihan Rp 45.000.000" : "Dokumen untuk demonstrasi",
    ]), [201]);
  }
  const state = await call("secretariat", "/api/letters/" + row.id);
  if (state.letter.status === "SECRETARIAT_INTAKE") {
    await call("secretariat", "/api/letters/" + row.id + "/actions",
      form({ action: "REGISTER_INCOMING", routing_target_user_id: profile.accounts.ops.id, ...receipt },
        "receipt_file", "SIMULASI-bukti-terima.pdf", ["SIMULASI - BUKTI TERIMA", sender, number]));
  }
  return row.id;
}
async function toDirectors(id) {
  for (const [role, status] of [["ops", "MANAGER_REVIEW"], ["dirops", "DIRECTOR_OPS_REVIEW"]]) {
    const row = await call(role, "/api/letters/" + id);
    if (row.letter.status === status) await call(role, "/api/letters/" + id + "/actions", { action: "APPROVE" });
  }
}
async function task(role, letter, recipient, instruction, options = {}) {
  const [existing] = await sql.query(
    "SELECT id,status FROM siap_dispositions WHERE letter_id=? AND from_user_id=? AND to_user_id=? AND instruction=? LIMIT 1",
    [letter, profile.accounts[role].id, profile.accounts[recipient].id, instruction],
  );
  return existing[0] || call(role, "/api/dispositions", {
    letter_id: letter, to_user_id: profile.accounts[recipient].id, instruction, ...options,
  }, [201]);
}

try {
  const [[marker]] = await sql.query("SELECT id FROM siap_v11_stage_marker");
  if (marker.id !== profile.marker) throw new Error("Marker database demo berbeda.");
  const [[lock]] = await sql.query("SELECT GET_LOCK(?,0) AS acquired", ["demo-" + env.DB_NAME]);
  if (Number(lock.acquired) !== 1) throw new Error("Penyiapan demo sedang dijalankan proses lain.");
  const identity = await call("root", "/api/staging/identity");
  if (identity.marker !== profile.marker || identity.schema !== env.DB_NAME) throw new Error("Web dan database staging berbeda.");
  let previous;
  try { previous = JSON.parse(await readFile(file, "utf8")); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (previous) {
    if (previous.schema !== env.DB_NAME || previous.marker !== profile.marker) throw new Error("Daftar demo berasal dari staging yang berbeda.");
    console.log("Data demo sudah tersedia. Gunakan tautan pada " + file);
  } else {
    const offer = await incoming("PT ABC", "012/ABC/XI/2026", "SIMULASI DEMO - Penawaran Jasa Pengamanan PT ABC");
    await toDirectors(offer);
    const responseTask = await task("dirut", offer, "ops", "SIMULASI Tindak lanjuti penawaran PT ABC dan buat surat tanggapan dalam 2 hari.",
      { due_date: addDays(2), result_requirement: "OUTGOING_LETTER" });
    const responseDetail = await call("ops", "/api/dispositions/" + responseTask.id);
    if (["UNSEEN", "SEEN"].includes(responseDetail.disposition.status)) {
      await call("ops", "/api/dispositions/" + responseTask.id + "/actions", { action: "START" });
    }
    const draftTask = await task("ops", offer, "staff", "SIMULASI Susun surat balasan untuk PT ABC.",
      { parent_id: responseTask.id, due_date: addDays(2), result_requirement: "OUTGOING_LETTER" });
    const draftDetail = await call("staff", "/api/dispositions/" + draftTask.id);
    if (["UNSEEN", "SEEN"].includes(draftDetail.disposition.status)) {
      await call("staff", "/api/dispositions/" + draftTask.id + "/actions", { action: "START" });
    }
    const invoice = await incoming("CV Sinar Jaya", "INV/115", "SIMULASI DEMO - Invoice Pengadaan ATK CV Sinar Jaya", {
      total: "45000000", due_date: addDays(14), requires_spk: false,
    });
    const invoiceDetail = await call("staff", "/api/letters/" + invoice);
    for (const document of invoiceDetail.v11.payment_documents?.documents ?? []) {
      if (document.attachment || document.linked) continue;
      await call("staff", "/api/letters/" + invoice + "/payment-documents",
        form({ document_code: document.code }, "file", "SIMULASI-" + document.code + ".pdf", [
          "SIMULASI - LAMPIRAN PERSYARATAN INVOICE", document.code, "CV Sinar Jaya / INV/115",
        ]));
    }
    const project = await incoming("PT XYZ", "SIMULASI/XYZ/XI/2026", "SIMULASI DEMO - Permintaan Kerjasama Proyek Pengadaan PT XYZ");
    await toDirectors(project);
    const projectTask = await task("dirut", project, "ops", "SIMULASI Survei proyek PT XYZ, delegasikan ke Staff dan ajukan laporan kembali.");
    const outgoingSubject = "SIMULASI DEMO - Surat Balasan Direksi kepada PT ABC";
    let outgoing = await document(outgoingSubject);
    if (!outgoing) {
      outgoing = await call("staff", "/api/letters", form({ metadata: JSON.stringify({
        direction: "OUTGOING", document_type: profile.format.document_type, number_format_id: profile.format.id,
        routing_target_user_id: profile.accounts.ops.id, subject: outgoingSubject, recipient: "PT ABC",
        letter_date: today, source_disposition_id: draftTask.id,
      }) }, "original_file", "SIMULASI-balasan-PT-ABC.pdf", [
        "SIMULASI - SURAT BALASAN", "Kepada PT ABC", "Tanggapan atas Penawaran Jasa Pengamanan", "Naskah untuk demo SIAP ARU",
      ]), [201]);
    }
    const manifest = {
      schema: env.DB_NAME, marker: profile.marker,
      createdAt: new Date().toISOString(),
      cases: [
        { number: 1, name: "Penawaran PT ABC", href: "/letters/incoming?letter_id=" + offer, task: responseTask.id, due: addDays(2) },
        { number: 2, name: "Invoice CV Sinar Jaya Rp45.000.000", href: "/letters/incoming?letter_id=" + invoice },
        { number: 3, name: "Proyek PT XYZ", href: "/letters/incoming?letter_id=" + project, task: projectTask.id },
        { number: 4, name: "Surat balasan PT ABC", href: "/letters/outgoing?letter_id=" + outgoing.id, task: draftTask.id },
      ],
    };
    await writeFile(file, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    console.log("Empat kasus demo tersedia. Tautan tersimpan di " + file);
    for (const item of manifest.cases) console.log(item.number + ". " + item.name + " " + new URL(item.href, url));
  }
} finally {
  await sql.end();
}
