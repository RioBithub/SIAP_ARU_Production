import { accounts, del, expect, patch, post, tag, test } from "./helpers.mjs";

test("SYS-01 | Health check tersambung ke database baru dan Dashboard dapat dibuka", async ({ api }) => {
  expect(await api(null, "/api/health")).toMatchObject({ status: "healthy", database: "connected" });
  expect(await api("root", "/api/dashboard/summary")).toBeTruthy();
  await api(null, "/api/dashboard/summary", { expect: 401 });
});

test("AUTH-01 | Login dan identitas untuk semua role dummy", async ({ api }) => {
  for (const [key, account] of Object.entries(accounts)) {
    expect(await api(key, "/api/auth/me")).toMatchObject({
      id: account.id, email: account.email, role: account.role, unit_name: account.unit,
    });
  }
});

test("AUTH-02 | Password kosong dan salah ditolak", async ({ api }) => {
  await api.signIn(accounts.staff.email, "", 400);
  await api.signIn(accounts.staff.email, "Password-uji-yang-salah", 401);
  await api(null, "/api/auth/me", { expect: 401 });
});

test("AUTH-03 | Logout mencabut sesi yang dipakai", async ({ api }) => {
  const { session } = await api.signIn(accounts.other.email, accounts.other.password);
  expect((await api(null, "/api/auth/me", { session })).id).toBe(accounts.other.id);
  await api(null, "/api/auth/logout", { ...post({}), session });
  await api(null, "/api/auth/me", { session, expect: 401 });
});

test("ADM-01 | Admin buat akun, ubah unit dan role, reset password, lalu nonaktifkan", async ({ api }) => {
  const email = `${tag().toLowerCase()}@siap-test.invalid`;
  const first = "Sqa-User-Before-2026!";
  const second = "Sqa-User-After-2026!";
  const { id } = await api("root", "/api/admin/users", post({
    name: "Staf Uji Pengguna", email, password: first, role: "STAFF", unit_name: "Operasional",
  }, 201));
  const signed = await api.signIn(email, first);
  expect(signed.user.role).toBe("STAFF");
  await api("root", `/api/admin/users/${id}`, patch({
    role: "FINANCE", unit_name: "Keuangan", password: second,
  }));
  await api.signIn(email, first, 401);
  expect((await api.signIn(email, second)).user).toMatchObject({ role: "FINANCE", unit_name: "Keuangan" });
  await api("root", `/api/admin/users/${id}`, del());
  await api.signIn(email, second, 401);
  expect((await api("root", "/api/admin/users")).find((user) => user.id === id).is_active).toBe(0);
  expect((await api("root", "/api/audit?q=USER_DISABLE")).some((event) => event.entity_id === id)).toBe(true);
});

test("ADM-02 | Admin kelola jenis surat, format, dan penomoran awal", async ({ api }) => {
  const code = tag().replace("-", "_").toUpperCase();
  const type = await api("root", "/api/admin/document-types", post({
    code, name: "Jenis Uji", direction: "OUTGOING",
  }, 201));
  await api("root", `/api/admin/document-types/${type.id}`, patch({
    name: "Jenis Uji Revisi", secretariat_review_required: true,
  }));
  const typeRows = await api("staff", "/api/admin/document-types?direction=OUTGOING&active=1");
  expect(typeRows.find((row) => row.id === type.id)).toMatchObject({ name: "Jenis Uji Revisi", secretariat_review_required: 1 });
  const format = await api("root", "/api/admin/number-formats", post({
    code, name: "Seri uji", document_type: type.code, pattern: "{seq}/SQA/{year}", sequence_start: 31,
  }, 201));
  await api("root", `/api/admin/number-formats/${format.id}`, patch({ sequence_start: 41 }));
  expect((await api("staff", "/api/admin/number-formats")).find((row) => row.id === format.id)).toMatchObject({ sequence_start: 41 });
  await api("root", "/api/admin/number-formats", post({
    code: tag(), name: "Format tanpa nomor", document_type: type.code, pattern: "SQA",
  }, 400));
  const systemType = typeRows.find((row) => row.code === "SURAT_UMUM");
  await api("root", `/api/admin/document-types/${systemType.id}`, patch({ is_active: false }, 400));
  await api("root", `/api/admin/number-formats/${format.id}`, patch({ is_active: false }));
  await api("root", `/api/admin/document-types/${type.id}`, patch({ is_active: false }));
  expect((await api("staff", "/api/admin/document-types?direction=OUTGOING&active=1"))
    .some((row) => row.id === type.id)).toBe(false);
});

test("ADM-03 | Staf tidak berhak mengubah konfigurasi, audit, atau data keuangan", async ({ api }) => {
  await api("staff", "/api/admin/users", { expect: 403 });
  await api("staff", "/api/admin/document-types", post({ name: "Uji" }, 403));
  await api("staff", "/api/admin/number-formats", post({ name: "Uji" }, 403));
  await api("staff", "/api/audit", { expect: 403 });
  await api("staff", "/api/finance/summary", { expect: 403 });
  await api("manager", "/api/finance/summary", { method: "PUT", data: {}, expect: 403 });
  await api("manager", "/api/finance/bank-accounts", post({}, 403));
});

test("ADM-04 | Lookup akun aktif dan Audit Log dapat ditelusuri oleh Root Admin", async ({ api }) => {
  const users = await api("staff", "/api/users/lookup");
  expect(users.some((item) => item.id === accounts.manager.id)).toBe(true);
  await api("root", "/api/auth/me");
  expect(await api("root", "/api/audit?q=LOGIN")).not.toHaveLength(0);
});
