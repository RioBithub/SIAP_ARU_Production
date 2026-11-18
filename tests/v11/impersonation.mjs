import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { chromium } from "playwright";

const env = process.env;
const profile = JSON.parse(await readFile(env.SIAP_V11_STAGE_PROFILE, "utf8"));
const app = new URL(profile.appUrl);
const accounts = profile.accounts;
assert(env.SIAP_V11_STAGE === "1" && env.DB_HOST === "127.0.0.1" && app.protocol === "http:" &&
  app.hostname === "127.0.0.1" && profile.schema === env.DB_NAME && profile.port === Number(env.DB_PORT) &&
  /^siap_aru_sqa_v11_[a-z0-9]{4,24}$/.test(profile.schema) &&
  Object.values(accounts).every(account => account.email.endsWith("@simulasi.siap.invalid")),
  "Gunakan profil staging loopback dan akun simulasi.");

const endpoint = "/api/auth/impersonation";
const switchHeaders = { "X-SIAP-Account-Switch": "1" };
const url = path => new URL(path, app).href;
const sql = await mysql.createConnection({
  host: env.DB_HOST, port: profile.port, database: profile.schema, user: env.DB_USER, password: env.DB_PASSWORD,
});
let browser;

async function call(context, path, { method = "GET", data, status = 200, headers } = {}) {
  const response = await context.request.fetch(url(path), { method, data, headers, timeout: 15_000 });
  assert.equal(response.status(), status, `${method} ${path}: ${await response.text()}`);
  return (await response.json()).data;
}

const switchApi = (context, targetUserId, expectedTargetId, status = 200, headers = switchHeaders) =>
  call(context, endpoint, { method: "POST", data: { targetUserId, expectedTargetId }, headers, status });

const signedInAs = (context, expectedId, expectedRole) => call(context, "/api/auth/me").then(user => {
  assert.equal(user.id, expectedId);
  assert.equal(user.role, expectedRole);
  return user;
});

async function login(context, account) {
  const response = await fetch(url("/api/auth/login"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: env.SIAP_V11_STAGE_PASSWORD }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert(cookie?.startsWith("siap_session=") && cookie.includes("HttpOnly") && cookie.includes("Secure"));
  // Seed the same cookie on the isolated HTTP loopback used by the API and browser tests.
  const [name, value] = cookie.split(";")[0].split("=");
  await context.addCookies([{ name, value, url: app.origin, httpOnly: true }]);
}

async function chooseAccount(page, account) {
  await page.getByRole("button", { name: "Ganti akun" }).click();
  const dialog = page.getByRole("dialog", { name: "Ganti akun" });
  await dialog.getByRole("searchbox", { name: "Cari akun" }).fill(account.email);
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    dialog.getByRole("button").filter({ has: page.getByText(account.email, { exact: true }) }).click(),
  ]);
  await page.locator(".account-mode-banner").getByText(account.email, { exact: false }).waitFor();
  const user = await signedInAs(page.context(), account.id, account.role);
  assert.equal(user.impersonatedByUserId, accounts.root.id);
  assert.equal(user.unit_name, account.unit);
}

try {
  const [[marker]] = await sql.query("SELECT id FROM siap_v11_stage_marker");
  assert.equal(marker.id, profile.marker);
  browser = await chromium.launch({
    executablePath: env.SIAP_V11_CHROMIUM, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const root = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const otherRoot = await browser.newContext();
  const staff = await browser.newContext();
  await login(root, accounts.root);
  await login(otherRoot, accounts.root);
  await login(staff, accounts.staff);
  assert.deepEqual(await call(root, "/api/staging/identity"), { marker: profile.marker, schema: profile.schema });

  const staffPage = await staff.newPage();
  await staffPage.goto(url("/dashboard"));
  assert.equal(await staffPage.getByRole("button", { name: "Ganti akun" }).count(), 0);
  await call(staff, endpoint, { status: 403 });
  await switchApi(staff, accounts.root.id, null, 403);
  await switchApi(root, accounts.staff.id, null, 403, {});
  await switchApi(root, accounts.staff.id, null, 403, { ...switchHeaders, "Sec-Fetch-Site": "cross-site" });
  console.log("PASS akses Root Admin dan perlindungan permintaan lintas situs");

  await sql.execute("UPDATE siap_users SET is_active=0 WHERE id=?", [accounts.sdm.id]);
  try {
    const list = await call(root, endpoint);
    assert(!list.some(account => account.id === accounts.sdm.id || account.id === accounts.root.id));
    assert(list.some(account => account.id === accounts.ops.id));
    assert(list.every(account => Object.keys(account).sort().join() === "email,id,name,role,unit_name"));
    await switchApi(root, accounts.sdm.id, null, 404);
  } finally {
    await sql.execute("UPDATE siap_users SET is_active=1 WHERE id=?", [accounts.sdm.id]);
  }
  console.log("PASS daftar akun aktif tanpa data kredensial");

  const page = await root.newPage();
  const secondTab = await root.newPage();
  await page.goto(url("/dashboard"));
  await secondTab.goto(url("/dashboard"));
  await secondTab.getByRole("button", { name: /Notifikasi/ }).waitFor();
  await chooseAccount(page, accounts.secretariat);
  await secondTab.locator(".account-mode-banner").getByText(accounts.secretariat.email, { exact: false }).waitFor();
  assert.equal(await page.getByRole("link", { name: /User & Role/ }).count(), 0);
  await call(root, "/api/admin/users", { status: 403 });
  await call(root, "/api/finance/payables", { status: 403 });
  await signedInAs(otherRoot, accounts.root.id, "ROOT_ADMIN");
  await signedInAs(staff, accounts.staff.id, "STAFF");
  console.log("PASS pindah ke Sekretariat, sinkronisasi antartab, dan sesi lain tetap independen");

  const letter = await call(root, "/api/letters", { method: "POST", status: 201, data: {
    direction: "INTERNAL", document_type: "NOTA_DINAS", routing_target_user_id: accounts.ops.id,
    subject: "SIMULASI Pergantian Akun " + randomUUID(),
    letter_date: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date()),
  } });
  assert.equal(letter.created_by, accounts.secretariat.id);
  const audit = (await call(otherRoot, "/api/audit?q=LETTER_CREATE")).find(event => event.entity_id === letter.id);
  assert.equal(audit.user_id, accounts.secretariat.id);
  assert(audit.impersonator_name);
  const metadata = typeof audit.metadata_json === "string" ? JSON.parse(audit.metadata_json) : audit.metadata_json;
  assert.equal(metadata.impersonatedByUserId, accounts.root.id);
  console.log("PASS tindakan persuratan memakai akun tujuan dan audit mencatat Root Admin");

  await chooseAccount(page, accounts.ops);
  await chooseAccount(page, accounts.dirops);
  await chooseAccount(page, accounts.dirut);
  await chooseAccount(page, accounts.staff);
  await page.setViewportSize({ width: 360, height: 780 });
  await chooseAccount(page, accounts.finance);
  assert(await page.locator(".topbar").evaluate(el => el.scrollWidth <= el.clientWidth));
  await call(root, "/api/finance/payables");
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    page.getByRole("button", { name: "Kembali ke Root Admin" }).click(),
  ]);
  assert.equal((await signedInAs(root, accounts.root.id, "ROOT_ADMIN")).impersonatedByUserId, undefined);
  await page.getByRole("link", { name: /User & Role/ }).waitFor({ state: "attached" });
  assert.equal(await page.locator(".account-mode-banner").count(), 0);
  console.log("PASS ganti langsung antarperan dan kembali ke Root Admin di ponsel");

  await chooseAccount(page, accounts.ops);
  await sql.execute("UPDATE siap_users SET is_active=0 WHERE id=?", [accounts.ops.id]);
  try {
    await call(root, "/api/auth/me", { status: 401 });
    await call(root, "/api/admin/users", { status: 401 });
    await page.goto(url("/admin/users"));
    await page.waitForURL("**/account/restore");
    await Promise.all([
      page.waitForURL("**/dashboard"),
      page.getByRole("button", { name: "Kembali ke akun sendiri" }).click(),
    ]);
    await signedInAs(root, accounts.root.id, "ROOT_ADMIN");
  } finally {
    await sql.execute("UPDATE siap_users SET is_active=1 WHERE id=?", [accounts.ops.id]);
  }

  await switchApi(root, accounts.secretariat.id, null);
  await sql.execute("UPDATE siap_users SET role='STAFF' WHERE id=?", [accounts.root.id]);
  try {
    await call(root, "/api/auth/me", { status: 401 });
    await switchApi(root, accounts.ops.id, accounts.secretariat.id, 403);
    await switchApi(root, null, accounts.secretariat.id);
    await signedInAs(root, accounts.root.id, "STAFF");
  } finally {
    await sql.execute("UPDATE siap_users SET role='ROOT_ADMIN' WHERE id=?", [accounts.root.id]);
  }
  console.log("PASS akun dinonaktifkan atau wewenang Root dicabut selama pergantian akun");

  const switched = await Promise.all([accounts.ops, accounts.finance].map(account => root.request.post(url(endpoint), {
    data: { targetUserId: account.id, expectedTargetId: null }, headers: switchHeaders,
  })));
  assert.deepEqual(switched.map(response => response.status()).sort(), [200, 409]);
  const winner = switched[0].ok() ? accounts.ops : accounts.finance;
  await signedInAs(root, winner.id, winner.role);
  const switchEvents = await call(otherRoot, "/api/audit?q=IMPERSONATION");
  for (const action of ["IMPERSONATION_START", "IMPERSONATION_SWITCH", "IMPERSONATION_END"]) {
    assert(switchEvents.some(event => event.action === action && event.user_id === accounts.root.id));
  }
  await call(root, "/api/auth/logout", { method: "POST" });
  await call(root, "/api/auth/me", { status: 401 });
  await switchApi(root, null, winner.id, 401);
  await signedInAs(otherRoot, accounts.root.id, "ROOT_ADMIN");
  console.log("PASS perpindahan bersamaan, audit sesi, dan logout saat memakai akun lain");
} finally {
  await browser?.close();
  await sql.end();
}
