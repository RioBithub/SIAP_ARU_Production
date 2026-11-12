import { accounts, approveOutgoing, date, expect, issue, letterAction, outgoing, samples, tag, test } from "./helpers.mjs";

const navigation = [
  ["/dashboard", "Satu sistem untuk persuratan, Nota Dinas, disposisi, dan informasi keuangan."],
  ["/letters/incoming", "Surat Masuk"],
  ["/letters/internal", "Nota Dinas"],
  ["/letters/outgoing", "Surat Keluar"],
  ["/dispositions", "Disposisi"],
  ["/archive", "Arsip Dokumen"],
  ["/finance", "Dashboard Keuangan"],
  ["/finance/receivables", "Piutang"],
  ["/finance/payables", "Utang"],
  ["/finance/aging", "Aging & Jatuh Tempo"],
  ["/finance/bank-statement", "Rekening Koran"],
  ["/finance/bank-statement/import", "Import Rekening Koran BRI"],
  ["/finance/bank-statement/documents", "Dokumen Bank"],
  ["/admin/users", "User & Role"],
  ["/admin/number-formats", "Jenis Surat & Format Nomor"],
  ["/audit", "Audit Log"],
];
const heading = (page, name) => page.getByRole("heading", { name, exact: true }).first();
const button = (page, name) => page.getByRole("button", { name, exact: true });

test("UI-01 | Form login dengan password salah dan benar, lalu keluar", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  const email = page.locator('input[type="email"]');
  const password = page.locator('input[type="password"]');
  await email.fill(accounts.staff.email);
  await password.fill("Salah-Untuk-Tes-Saja");
  await button(page, "Masuk ke SIAP").click();
  await expect(page.locator(".login-card .error")).toBeVisible();
  await password.fill(accounts.staff.password);
  await button(page, "Masuk ke SIAP").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".user-chip")).toContainText(accounts.staff.name);
  await button(page, "Keluar").click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/letters/outgoing");
  await expect(page).toHaveURL(/\/login$/);
});

test("UI-02 | Seluruh 16 menu utama dapat dibuka di Chromium sebagai Root Admin", async ({ page, api }) => {
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await api.browserLogin(page, "root");
  await page.goto("/dashboard");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar.locator("a.nav-link")).toHaveCount(navigation.length);
  for (const [path, title] of navigation) {
    await test.step(title, async () => {
      await sidebar.locator(`a[href="${path}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(heading(page, title)).toBeVisible();
    });
  }
  expect(browserErrors).toEqual([]);
});

test("UI-03 | Navigasi layar 390 px dan pembatasan menu Staff", async ({ page, api }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await api.browserLogin(page, "staff");
  await page.goto("/dashboard");
  await page.locator(".mobile-menu").click();
  const sidebar = page.locator(".sidebar.open");
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator('a[href="/finance"], a[href="/admin/users"]')).toHaveCount(0);
  await sidebar.locator('a[href="/letters/incoming"]').click();
  await expect(heading(page, "Surat Masuk")).toBeVisible();
  await expect(page.locator(".sidebar.open")).toHaveCount(0);
  await page.goto("/finance");
  await expect(page).toHaveURL(/\/dashboard\?forbidden=1$/);
});

test("UI-04 | Sekretariat membuka antrean dan meneruskan Surat Masuk ke reviewer pilihan", async ({ page, api }) => {
  await api.browserLogin(page, "secretariat");
  await page.goto("/letters/incoming");
  await expect(button(page, "Tampilkan Semua Surat")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "DEMO Permohonan jadwal servis" });
  await button(row, "Detail").click();
  await button(page, "Registrasi & Teruskan").click();
  await page.getByRole("combobox", { name: "Teruskan kepada" }).selectOption(accounts.manager2.id);
  await page.locator("form").filter({ has: page.getByRole("combobox", { name: "Teruskan kepada" }) })
    .getByRole("button", { name: "Registrasi & Teruskan", exact: true }).click();
  await expect(page.getByText("Registrasi & Teruskan berhasil.", { exact: true })).toBeVisible();
  const { letter } = await api("manager2", `/api/letters/${samples.intake}`);
  expect(letter).toMatchObject({ status: "MANAGER_REVIEW", current_owner_user_id: accounts.manager2.id });
});

test("UI-05 | Staff membuat Nota Dinas melalui formulir dan mengajukan draf", async ({ page, api }) => {
  const subject = `Nota Dinas Chromium ${tag()}`;
  await api.browserLogin(page, "staff");
  await page.goto("/letters/internal");
  await button(page, "+ Buat Nota Dinas").click();
  const form = page.locator("form").filter({ has: page.locator('input[name="subject"]') });
  await form.locator('input[name="subject"]').fill(subject);
  await form.locator('select[name="routing_target_user_id"]').selectOption(accounts.manager.id);
  await form.locator('textarea[name="summary"]').fill("Pengajuan fiktif untuk menguji alur Nota Dinas.");
  await button(form, "Simpan Draft").click();
  const row = page.getByRole("row").filter({ hasText: subject });
  await expect(row).toBeVisible();
  await button(row, "Detail").click();
  await button(page, "Ajukan ke Manager").click();
  await button(page.locator("form"), "Ajukan ke Manager").click();
  await expect(page.getByText("Ajukan ke Manager berhasil.", { exact: true })).toBeVisible();
  const records = await api("manager", "/api/letters?direction=INTERNAL");
  expect(records.find((row) => row.subject === subject)?.status).toBe("MANAGER_REVIEW");
});

test("UI-06 | Status Terkirim dan tanggal pengiriman terlihat di detail Surat Keluar", async ({ page, api }) => {
  const letter = await outgoing(api);
  await approveOutgoing(api, letter);
  await issue(api, letter.id);
  await letterAction(api, "secretariat", letter.id, "MARK_SENT", "ISSUED", { sent_date: date });
  await api.browserLogin(page, "staff");
  await page.goto(`/letters/outgoing?letter_id=${letter.id}`);
  const detail = page.locator(".modal");
  await expect(detail.getByText("Tanggal Kirim", { exact: true })).toBeVisible();
  await expect(detail.getByText("Terkirim", { exact: true })).toBeVisible();
});

test("UI-07 | Filter tanggal Rekening Koran, perintah cetak, dan keluaran PDF", async ({ page, api }) => {
  await api.browserLogin(page, "manager");
  await page.addInitScript(() => { window.print = () => { window.printInvoked = true; }; });
  await page.goto("/finance/bank-statement");
  const filters = page.locator(".bank-filter-card");
  await filters.locator("select").selectOption(samples.bank);
  const dates = filters.locator('input[type="date"]');
  await dates.nth(0).fill("2025-01-01");
  await dates.nth(1).fill("2025-01-31");
  await button(filters, "Terapkan").click();
  const preview = page.locator(".bank-statement-print-area");
  await expect(preview).toContainText("DEMO Penerimaan");
  await expect(preview.locator(".bank-statement-summary")).toContainText("1.150.000,00");
  await page.getByRole("button", { name: /Cetak \/ Simpan PDF/ }).click();
  expect(await page.evaluate(() => window.printInvoked)).toBe(true);
  const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
});
