import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { demoDate, sampleCases, sampleDocs, samplePdf } from "../../lib/staging-samples.mjs";
import { validateStageConfig } from "./stage-config.mjs";

const env = validateStageConfig(process.env);
if (env.SIAP_DEV_STAGING !== "1") throw new Error("Gunakan profil staging dev untuk memuat data latihan.");
const profile = JSON.parse(await readFile(env.SIAP_V11_STAGE_PROFILE, "utf8"));
if (!profile.dev || profile.schema !== env.DB_NAME || Number(profile.port) !== Number(env.DB_PORT) ||
    profile.appUrl !== env.SIAP_V11_STAGE_URL) throw new Error("Profil staging dev berbeda.");

const sql = await mysql.createConnection({
  host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
});
const base = new URL(profile.appUrl);
let cookie;
let target = null;
async function call(route, { body, headers = {}, status = 200 } = {}) {
  if (cookie) headers.Cookie = cookie;
  if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(new URL(route, base), {
    method: body ? "POST" : "GET", headers, redirect: "error", signal: AbortSignal.timeout(15_000),
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (response.status !== status || !json.ok) {
    throw new Error("HTTP " + response.status + " pada " + route + (json.error ? " - " + json.error : ""));
  }
  return { data: json.data, response };
}

async function switchAccount(next) {
  await call("/api/auth/impersonation", {
    body: { expectedTargetId: target, targetUserId: next }, headers: { "X-SIAP-Account-Switch": "1" },
  });
  target = next;
}

async function attach(form, key, id, date) {
  const doc = sampleDocs.find(item => item.id === id);
  if (!doc) throw new Error("Berkas simulasi tidak ditemukan.");
  form.set(key, new Blob([await samplePdf(id, date)], { type: "application/pdf" }), doc.filename);
}

try {
  const [[row]] = await sql.query("SELECT id FROM siap_v11_stage_marker");
  if (row?.id !== profile.marker) throw new Error("Marker database staging berbeda.");
  const [[lock]] = await sql.query("SELECT GET_LOCK(?,0) AS acquired", ["dev-demo-" + env.DB_NAME]);
  if (Number(lock.acquired) !== 1) throw new Error("Data latihan sedang dimuat oleh proses lain.");
  const login = await call("/api/auth/login", {
    body: { email: profile.accounts.root.email, password: env.SIAP_V11_STAGE_PASSWORD },
  });
  cookie = login.response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie?.startsWith("__Host-siap_dev_session=")) throw new Error("Sesi staging dev belum tersedia.");
  const { data: identity } = await call("/api/staging/identity");
  if (identity.marker !== profile.marker || identity.schema !== env.DB_NAME) throw new Error("Aplikasi dan database staging berbeda.");

  const date = demoDate();
  await switchAccount(profile.accounts.staff.id);
  for (const item of sampleCases) {
    if (!item.reference) continue;
    const [existing] = await sql.query(
      "SELECT id FROM siap_letters WHERE direction='INCOMING' AND external_number=? AND created_by=? LIMIT 1",
      [item.reference, profile.accounts.staff.id],
    );
    if (existing.length) {
      console.log("Sudah tersedia " + item.reference);
      continue;
    }
    const form = new FormData();
    form.set("metadata", JSON.stringify({
      direction: "INCOMING", document_type: item.invoice ? "INVOICE_MASUK" : "SURAT_MASUK_UMUM",
      routing_target_user_id: profile.accounts.ops.id, requesting_unit: "OPS",
      external_number: item.reference, subject: "[SIMULASI] " + item.title, sender: item.sender,
      recipient: "PT Aru Raharja", confidentiality: item.confidentiality, summary: item.summary,
      letter_date: date, received_date: date, received_time: "09:00", delivery_method: "FISIK",
      delivered_by: "Kurir Simulasi", received_by: "Sekretariat Simulasi",
      receipt_note: "Berkas latihan diterima lengkap.",
      ...(item.invoice && { business: { total: 45000000, due_date: demoDate(14), requires_spk: false } }),
    }));
    await attach(form, "original_file", item.original, date);
    await attach(form, "receipt_file", item.receipt, date);
    await call("/api/letters", { body: form, status: 201 });
    console.log("Ditambahkan " + item.reference);
  }
  console.log("Buka " + env.APP_URL + "/simulasi untuk bahan latihan dan nomor surat.");
} finally {
  try {
    if (cookie) await call("/api/auth/logout", { body: {} });
  } finally {
    await sql.end();
  }
}
