import { date, del, expect, multipart, patch, post, put, tag, test, textFile } from "./helpers.mjs";

const year = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Jakarta" }).format());
const base = "/api/finance";
const month = (n) => `${year}-${String(n).padStart(2, "0")}`;
const summary = (n) => `${base}/summary?month=${month(n)}`;
const monthly = (n, fields = {}) => put({
  period_month: month(n), data_date: date, income_amount: 1000, expense_amount: 300,
  budget_amount: 800, publish_status: "PUBLISHED", include_in_ytd: true, ...fields,
});
const yearly = (mode, fields = {}) => put({
  summary_year: year, calculation_mode: mode, base_income_amount: 900,
  base_expense_amount: 200, annual_budget_amount: 5000, as_of_date: date,
  publish_status: "PUBLISHED", ...fields,
});
const ledger = (fields = {}) => ({
  invoice_no: tag(), counterparty: "Mitra Fiktif SQA", invoice_date: date,
  due_date: date, amount: 1000, paid_amount: 0, ...fields,
});

test("FIN-01 | Ringkasan bulanan, publikasi, dan pembatasan akses per peran", async ({ api }) => {
  const { id } = await api("finance", `${base}/summary`, monthly(1, { publish_status: "DRAFT" }));
  expect((await api("finance", summary(1))).summary).toMatchObject({ id, profit_amount: 700, publish_status: "DRAFT" });
  expect((await api("manager", summary(1))).summary.id).toBeNull();
  await api("staff", summary(1), { expect: 403 });
  await api("manager", `${base}/summary`, { ...monthly(1), expect: 403 });
  expect(await api("finance", `${base}/summary`, monthly(1))).toEqual({ id });
  expect((await api("manager", summary(1))).summary).toMatchObject({
    id, income_amount: 1000, expense_amount: 300, budget_amount: 800, profit_amount: 700,
    publish_status: "PUBLISHED",
  });
});

test("FIN-02 | Pembatasan pengubahan periode di luar tahun berjalan", async ({ api }) => {
  await api("finance", `${base}/summary`, { ...monthly(1, { period_month: `${year - 1}-01` }), expect: 400 });
  await api("finance", `${base}/yearly`, { ...yearly("MANUAL", { summary_year: year + 1 }), expect: 400 });
});

test("FIN-03 | Ringkasan tahunan MANUAL, AUTO_MONTHLY, dan HYBRID", async ({ api }) => {
  await api("finance", `${base}/yearly`, yearly("MANUAL", { publish_status: "DRAFT" }));
  const draft = await api("finance", `${base}/yearly?year=${year}`);
  expect(draft.raw.publish_status).toBe("DRAFT");
  expect(await api("manager", `${base}/yearly?year=${year}`)).toMatchObject({
    raw: null, computed: { configured: false },
  });
  await api("finance", `${base}/summary`, monthly(1));
  await api("finance", `${base}/summary`, monthly(2, { income_amount: 2000, expense_amount: 400 }));
  await api("finance", `${base}/summary`, monthly(3, { publish_status: "DRAFT" }));
  await api("finance", `${base}/summary`, monthly(4, { include_in_ytd: false }));
  const cases = [
    ["MANUAL", {}, { income_amount: 900, expense_amount: 200, profit_amount: 700, included_months: [] }],
    ["AUTO_MONTHLY", {}, { income_amount: 3000, expense_amount: 700, profit_amount: 2300, included_months: [1, 2] }],
    ["HYBRID", { base_through_month: 1 }, { income_amount: 2900, expense_amount: 600, profit_amount: 2300, included_months: [2] }],
  ];
  for (const [mode, fields, totals] of cases) {
    await test.step(mode, async () => {
      const { computed } = await api("finance", `${base}/yearly`, yearly(mode, fields));
      expect(computed).toMatchObject({ mode, budget_amount: 5000, ...totals });
      expect((await api("finance", `${base}/yearly?year=${year}`)).computed).toMatchObject(totals);
      expect((await api("dirut", summary(2))).ytd).toMatchObject(totals);
    });
  }
});

test("FIN-04 | Penyesuaian bulanan, histori, reversal, dan penolakan reversal ganda", async ({ api }) => {
  await api("finance", `${base}/summary`, monthly(1));
  const { adjustmentId, before, after } = await api("finance", `${base}/adjustments`, post({
    period_month: month(1), metric: "REVENUE", adjustment_type: "INCREASE",
    amount: 250, data_date: date, note: "Koreksi fiktif pendapatan",
  }, 201));
  expect({ before, after }).toEqual({ before: 1000, after: 1250 });
  expect((await api("finance", summary(1))).summary.income_amount).toBe(1250);
  const reverse = `${base}/adjustments/${adjustmentId}/reverse`;
  await api("finance", reverse, post({ note: "Ulangi pencatatan fiktif" }));
  await api("finance", reverse, post({ note: "Pembatalan kedua" }, 400));
  const restored = await api("finance", summary(1));
  expect(restored.summary.income_amount).toBe(1000);
  expect(restored.adjustments).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: adjustmentId, status: "REVERSED" }),
    expect.objectContaining({ adjustment_type: "REVERSAL", reversed_adjustment_id: adjustmentId }),
  ]));
});

for (const [code, kind, label] of [["FIN-05", "receivables", "Piutang"], ["FIN-06", "payables", "Hutang"]]) {
  test(`${code} | ${label} baru, pembayaran parsial, pelunasan, dan hak hapus`, async ({ api }) => {
    const list = `${base}/${kind}`;
    const record = ledger({ paid_amount: 200 });
    await api("finance", list, post({ ...record, paid_amount: 1001 }, 400));
    const { id } = await api("finance", list, post(record, 201));
    const find = async () => (await api("manager", list)).find((row) => row.id === id);
    expect(await find()).toMatchObject({ status: "PARTIAL", invoice_no: record.invoice_no });
    expect(Number((await find()).outstanding)).toBe(800);
    await api("finance", `${list}/${id}`, patch({ paid_amount: 1000 }));
    const paid = await find();
    expect(paid.status).toBe("PAID");
    expect(Number(paid.outstanding)).toBe(0);
    expect(String(paid.invoice_date).slice(0, 10)).toBe(date);
    expect(String(paid.due_date).slice(0, 10)).toBe(date);
    await api("finance", `${list}/${id}`, del(undefined, 403));
    await api("root", `${list}/${id}`, del());
    expect(await find()).toBeUndefined();
  });
}

test("FIN-07 | Pilihan posisi ringkas atau rinci dan reversal penyesuaian posisi", async ({ api }) => {
  const url = `${base}/positions/receivables`;
  const fields = {
    as_of_date: date, outstanding_amount: 2500, due_30_amount: 1500, due_30_count: 2,
    aging_1_30_amount: 100, aging_30_60_amount: 200, aging_60_90_amount: 300, aging_90_plus_amount: 400,
  };
  await api("finance", url, put(fields));
  await api("finance", url, patch({ mode: "SUMMARY" }));
  const initial = await api("manager", url);
  expect(initial.active).toMatchObject({ outstanding_amount: 2500, overdue_amount: 1000 });
  const { adjustmentId, after } = await api("finance", `${base}/position-adjustments`, post({
    kind: "receivables", metric: "OUTSTANDING", adjustment_type: "INCREASE", amount: 500,
    data_date: date, note: "Tambahan fiktif",
  }, 201));
  expect(after).toBe(3000);
  expect((await api("manager", url)).active.outstanding_amount).toBe(3000);
  await api("finance", `${base}/position-adjustments/${adjustmentId}/reverse`, post({ note: "Batalkan penyesuaian fiktif" }));
  expect((await api("manager", url)).active.outstanding_amount).toBe(2500);
  await api("finance", url, patch({ mode: "DETAIL" }));
  const detailed = await api("manager", url);
  expect(detailed.mode).toBe("DETAIL");
  expect(detailed.active).toEqual(detailed.detail);
});

test("FIN-08 | Batas aging piutang pada 30, 31, 60, 61, 90, dan 91 hari", async ({ api }) => {
  const path = `${base}/positions/receivables`;
  const { detail: initial } = await api("finance", path);
  const today = Date.parse(`${date}T00:00:00Z`);
  const records = [30, 31, 60, 61, 90, 91].map((days) => ledger({
    invoice_date: new Date(today - 120 * 86400000).toISOString().slice(0, 10),
    due_date: new Date(today - days * 86400000).toISOString().slice(0, 10),
    amount: days,
  }));
  for (const record of records) await api("finance", `${base}/receivables`, post(record, 201));
  const { detail } = await api("finance", path);
  expect(detail.aging_1_30_amount - initial.aging_1_30_amount).toBe(30);
  expect(detail.aging_30_60_amount - initial.aging_30_60_amount).toBe(31 + 60);
  expect(detail.aging_60_90_amount - initial.aging_60_90_amount).toBe(61 + 90);
  expect(detail.aging_90_plus_amount - initial.aging_90_plus_amount).toBe(91);
});

test("FIN-09 | Lampiran ringkasan mengikuti publikasi dan dapat diunduh serta dihapus", async ({ api }) => {
  const { id } = await api("finance", `${base}/summary`, monthly(2, { publish_status: "DRAFT" }));
  const url = `${base}/attachments`;
  const proof = textFile("bukti-ringkasan-fiktif.txt");
  const attachment = await api("finance", url, multipart({ entity_type: "SUMMARY", entity_id: id, file: proof }, 201));
  const query = `${url}?entity_type=SUMMARY&entity_id=${id}`;
  const byMonth = `${url}?entity_type=SUMMARY&period_month=${month(2)}`;
  const detail = `${url}/${attachment.id}`;
  expect(await (await api.response("finance", detail)).body()).toEqual(proof.buffer);
  expect(await api("manager", byMonth)).toHaveLength(0);
  expect(await api("manager", query)).toHaveLength(0);
  await api.response("manager", detail, { expect: 404 });
  const { adjustmentId } = await api("finance", `${base}/adjustments`, post({
    period_month: month(2), metric: "BUDGET", adjustment_type: "INCREASE", amount: 100,
    data_date: date, note: "Anggaran fiktif",
  }, 201));
  const adjustmentProof = await api("finance", url, multipart({
    entity_type: "ADJUSTMENT", entity_id: adjustmentId, file: proof,
  }, 201));
  const adjustmentFile = `${url}/${adjustmentProof.id}`;
  await api.response("manager", adjustmentFile, { expect: 404 });
  await api("finance", `${base}/summary`, monthly(2));
  expect(await api("manager", query)).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: attachment.id, original_name: proof.name }),
  ]));
  expect(await (await api.response("manager", detail)).body()).toEqual(proof.buffer);
  expect(await (await api.response("manager", adjustmentFile)).body()).toEqual(proof.buffer);
  await api.response("staff", detail, { expect: 403 });
  await api("finance", detail, del());
  await api("finance", adjustmentFile, del());
  await api.response("finance", detail, { expect: 404 });
  expect(await api("finance", query)).toHaveLength(0);
});

test("FIN-10 | API pencatatan transaksi dan penganggaran lama tetap berjalan", async ({ api }) => {
  const entries = `${base}/entries`;
  const budgets = `${base}/budgets`;
  const category = tag();
  const { id } = await api("finance", entries, post({
    entry_type: "INCOME", entry_date: date, category, description: "Pendapatan fiktif", amount: 1200,
  }, 201));
  await api("finance", `${entries}/${id}`, patch({ amount: 1350 }));
  expect(Number((await api("manager", `${entries}?type=INCOME`)).find((row) => row.id === id).amount)).toBe(1350);
  const budget = await api("finance", budgets, post({ budget_year: year, category, amount: 2000 }));
  expect(await api("finance", budgets, post({ budget_year: year, category, amount: 2500 }))).toEqual(budget);
  expect(Number((await api("manager", budgets)).find((row) => row.id === budget.id).amount)).toBe(2500);
  await api("root", `${entries}/${id}`, del());
  await api("root", `${budgets}/${budget.id}`, del());
  expect((await api("finance", budgets)).some((row) => row.id === budget.id)).toBe(false);
});
