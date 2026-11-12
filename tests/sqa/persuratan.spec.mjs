import XLSX from "xlsx";
import {
  accounts, approveOutgoing, date, expect, formatFor, incoming, internal, issue, issuePrepared, letterAction,
  multipart, outgoing, patch, pdfFile, post, samples, tag, test, textFile,
} from "./helpers.mjs";

const spkIn = "SURAT_PERINTAH_KERJA_MASUK";
const spkOut = "SURAT_PERINTAH_KERJA";
const invoiceIn = "INVOICE_MASUK";
const invoiceOut = "INVOICE_KELUAR";

test("IN-01 | Surat legacy meneruskan jalur Manager walaupun Sekretariat aktif", async ({ api }) => {
  const path = `/api/letters/${samples.legacy}`;
  expect((await api("manager", path)).letter.uses_secretariat).toBe(0);
  await letterAction(api, "manager", samples.legacy, "APPROVE", "DIRECTOR_OPS_REVIEW");
  await letterAction(api, "dirops", samples.legacy, "APPROVE", "PRESIDENT_DIRECTOR_REVIEW");
  await letterAction(api, "dirut", samples.legacy, "APPROVE", "APPROVED");
});

test("IN-02 | Sekretariat registrasi, ubah tujuan review, dan menerima pengembalian", async ({ api }) => {
  const letter = await incoming(api);
  expect(letter.status).toBe("SECRETARIAT_INTAKE");
  const queue = "/api/letters?direction=INCOMING&queue=secretariat";
  expect((await api("secretariat", queue)).some((item) => item.id === letter.id)).toBe(true);
  await api("staff", queue, { expect: 403 });
  await letterAction(api, "staff", letter.id, "REGISTER_INCOMING", null, {}, 400);
  await api("secretariat", `/api/letters/${letter.id}`, patch({ subject: "Surat diverifikasi Sekretariat" }));
  await letterAction(api, "secretariat", letter.id, "REGISTER_INCOMING", "PRESIDENT_DIRECTOR_REVIEW",
    { routing_target_user_id: accounts.dirut.id });
  await letterAction(api, "dirut", letter.id, "RETURN", "SECRETARIAT_INTAKE", { comment: "Periksa tujuan." });
  await letterAction(api, "secretariat", letter.id, "REGISTER_INCOMING", "DIRECTOR_OPS_REVIEW",
    { routing_target_user_id: accounts.dirops.id });
  await letterAction(api, "dirops", letter.id, "APPROVE_FINAL", "APPROVED");
});

test("IN-03 | Registrasi langsung oleh Sekretariat dan penyelesaian oleh reviewer tujuan", async ({ api }) => {
  const letter = await incoming(api, "secretariat", { routing_target_user_id: accounts.manager2.id });
  expect(letter.status).toBe("MANAGER_REVIEW");
  await letterAction(api, "manager", letter.id, "APPROVE_FINAL", null, {}, 404);
  await letterAction(api, "manager2", letter.id, "APPROVE_FINAL", "APPROVED");
  await letterAction(api, "root", letter.id, "COMPLETE", "COMPLETED");
});

test("ND-01 | Nota Dinas dikembalikan, direvisi, ditanggapi, lalu disetujui", async ({ api }) => {
  const letter = await internal(api, { routing_target_user_id: accounts.manager2.id });
  await letterAction(api, "staff", letter.id, "SUBMIT", "MANAGER_REVIEW");
  await letterAction(api, "manager2", letter.id, "RETURN", "RETURNED_STAFF", { comment: "Tambahkan peserta." });
  await api("other", `/api/letters/${letter.id}`, patch({ summary: "Perubahan fiktif dari staf lain" }, 403));
  await api("staff", `/api/letters/${letter.id}`, patch({ summary: "Peserta lengkap, data fiktif." }));
  await letterAction(api, "staff", letter.id, "RESPONSE", "RETURNED_STAFF", { comment: "Sudah dilengkapi." });
  await letterAction(api, "staff", letter.id, "SUBMIT", "MANAGER_REVIEW");
  await letterAction(api, "manager2", letter.id, "APPROVE_FINAL", "APPROVED");
  const detail = await api("staff", `/api/letters/${letter.id}`);
  expect(detail.letter.summary).toBe("Peserta lengkap, data fiktif.");
  expect(detail.actions.some((action) => action.action === "RESPONSE")).toBe(true);
});

test("ND-02 | Nota Dinas dapat diteruskan berjenjang sampai Dirut", async ({ api }) => {
  const letter = await internal(api);
  await letterAction(api, "staff", letter.id, "SUBMIT", "MANAGER_REVIEW");
  await letterAction(api, "manager", letter.id, "APPROVE", "DIRECTOR_OPS_REVIEW");
  await letterAction(api, "dirops", letter.id, "APPROVE", "PRESIDENT_DIRECTOR_REVIEW");
  await letterAction(api, "dirut", letter.id, "APPROVE", "APPROVED");
});

test("ND-03 | Draf Nota Dinas lama hanya bisa dibaca dan dilampiri pengguna berwenang", async ({ api }) => {
  const path = `/api/letters/${samples.internal}`;
  expect((await api("other", path)).letter.status).toBe("DRAFT");
  await api("staff", path, { expect: 403 });
  const file = textFile("lampiran-nota-dinas-fiktif.txt");
  await api("staff", `${path}/attachments`, multipart({ file }, 400));
  const stored = await api("other", `${path}/attachments`, multipart({ file }, 201));
  await api.response("other", `/api/attachments/${stored.id}`);
  await api.response("staff", `/api/attachments/${stored.id}`, { expect: 403 });
});

test("OUT-01 | Reservasi nomor khusus, varian duplikat, pembatalan, dan filter", async ({ api }) => {
  const subject = tag();
  const first = await outgoing(api, { subject, custom_number_base: 800 });
  const second = await outgoing(api, { custom_number_base: 800 });
  expect((await api("staff", `/api/letters/${first.id}`)).letter.display_number).toBe("800");
  expect((await api("staff", `/api/letters/${second.id}`)).letter.display_number).toBe("800.1");
  await letterAction(api, "staff", first.id, "CANCEL", "CANCELLED", { comment: "Draf fiktif dibatalkan." });
  const third = await outgoing(api, { custom_number_base: 800 });
  expect((await api("staff", `/api/letters/${third.id}`)).letter.display_number).toBe("800.2");
  const filtered = await api("staff", `/api/letters?direction=OUTGOING&status=CANCELLED&q=${subject}`);
  expect(filtered.map((letter) => letter.id)).toEqual([first.id]);
});

test("OUT-02 | Cek Sekretariat, revisi berjenjang, ACC, tanda tangan, terbit, dan kirim", async ({ api }) => {
  const type = await api("root", "/api/admin/document-types", post({ name: tag(), direction: "OUTGOING" }, 201));
  await api("root", `/api/admin/document-types/${type.id}`, patch({ secretariat_review_required: true }));
  const format = await api("root", "/api/admin/number-formats", post({
    code: tag(), name: "Seri cek Sekretariat", document_type: type.code, pattern: "SQA/{seq}/{year}",
  }, 201));
  const letter = await outgoing(api, { document_type: type.code, number_format_id: format.id });
  await letterAction(api, "staff", letter.id, "SUBMIT", "MANAGER_REVIEW");
  await letterAction(api, "manager", letter.id, "APPROVE", "DIRECTOR_OPS_REVIEW");
  await letterAction(api, "dirops", letter.id, "RETURN_PREVIOUS", "MANAGER_REVIEW", { comment: "Periksa isi." });
  await letterAction(api, "manager", letter.id, "APPROVE", "DIRECTOR_OPS_REVIEW");
  await letterAction(api, "dirops", letter.id, "APPROVE", "SECRETARIAT_REVIEW");
  await letterAction(api, "secretariat", letter.id, "RETURN_PREVIOUS", "DIRECTOR_OPS_REVIEW", { comment: "Cek lampiran." });
  await letterAction(api, "dirops", letter.id, "APPROVE", "SECRETARIAT_REVIEW");
  await letterAction(api, "secretariat", letter.id, "APPROVE", "PRESIDENT_DIRECTOR_REVIEW");
  await letterAction(api, "dirut", letter.id, "RETURN", "RETURNED_STAFF", { comment: "Rapikan perihal." });
  await api("staff", `/api/letters/${letter.id}`, patch({ subject: "Draf direvisi" }));
  await approveOutgoing(api, letter);

  await letterAction(api, "staff", letter.id, "PREPARE_ISSUE", null, {}, 400);
  await issue(api, letter.id);
  await letterAction(api, "secretariat", letter.id, "MARK_SENT", null, { sent_date: "2000-01-01" }, 400);
  await letterAction(api, "secretariat", letter.id, "MARK_SENT", "ISSUED", { sent_date: date });
  expect((await api("staff", "/api/letters?direction=OUTGOING&status=SENT")).some((row) => row.id === letter.id)).toBe(true);
  const detail = await api("staff", `/api/letters/${letter.id}`);
  expect(String(detail.letter.sent_date).slice(0, 10)).toBe(date);
  expect(detail.attachments.some((file) => file.original_name === "surat-final-sqa.pdf")).toBe(true);
});

test("OUT-03 | Dirut menolak Surat Keluar dengan alasan", async ({ api }) => {
  const letter = await outgoing(api);
  await letterAction(api, "staff", letter.id, "SUBMIT", "MANAGER_REVIEW");
  await letterAction(api, "manager", letter.id, "APPROVE", "DIRECTOR_OPS_REVIEW");
  await letterAction(api, "dirops", letter.id, "APPROVE", "PRESIDENT_DIRECTOR_REVIEW");
  await letterAction(api, "dirut", letter.id, "REJECT", null, {}, 400);
  await letterAction(api, "dirut", letter.id, "REJECT", "REJECTED", { comment: "Penolakan fiktif." });
  await letterAction(api, "root", letter.id, "PREPARE_ISSUE", null, {}, 400);
});

test("OUT-04 | Sumber Surat Masuk atau Nota Dinas dapat ditautkan dan diganti saat draf", async ({ api }) => {
  const source = await incoming(api);
  const alternate = await internal(api);
  const letter = await outgoing(api, { source_letter_id: source.id });
  expect((await api("staff", `/api/letters/${letter.id}`)).sourceLetter.id).toBe(source.id);
  await api("staff", `/api/letters/${letter.id}`, patch({ source_letter_id: alternate.id }));
  expect((await api("staff", `/api/letters/${letter.id}`)).sourceLetter.id).toBe(alternate.id);
  expect(await api("staff", `/api/letters/references?kind=source&id=${alternate.id}`)).toHaveLength(1);
  expect(await api("other", `/api/letters/references?kind=source&id=${alternate.id}`)).toHaveLength(0);
});

test("OUT-05 | Surat alur lama dapat diterbitkan penyusun setelah ACC", async ({ api }) => {
  let letter;
  await api("root", `/api/admin/users/${accounts.secretariat.id}`, patch({ is_active: false }));
  try {
    letter = await outgoing(api);
  } finally {
    await api("root", `/api/admin/users/${accounts.secretariat.id}`, patch({ is_active: true }));
  }
  expect(letter.uses_secretariat).toBe(0);
  await approveOutgoing(api, letter);
  await letterAction(api, "staff", letter.id, "ISSUE", "ISSUED", { issued_date: date });
});

test("ARS-01 | Unggah, cari arsip, unduh, dan batas akses lampiran surat rahasia", async ({ api }) => {
  const letter = await outgoing(api);
  const name = tag() + ".txt";
  const file = textFile(name);
  const path = `/api/letters/${letter.id}/attachments`;
  const attachment = await api("staff", path, multipart({ kind: "ADDITIONAL", file }, 201));
  const results = await api("staff", `/api/archive?q=${name}`);
  expect(results.some((row) => row.id === attachment.id)).toBe(true);
  const download = await api.response("staff", `/api/attachments/${attachment.id}`);
  expect(await download.body()).toEqual(file.buffer);
  expect(await api("other", `/api/archive?q=${name}`)).toHaveLength(0);
  await api.response("other", `/api/attachments/${attachment.id}`, { expect: 403 });
  await api("other", `/api/letters/${letter.id}`, { expect: 403 });
});

test("XLS-01 | Import Excel lama, pengulangan tanpa duplikasi, dan ekspor register", async ({ api }) => {
  const subject = "Impor Excel " + tag();
  const name = "Surat keluar- Bag. umum";
  const workbook = XLSX.utils.book_new();
  const data = [["Register uji"], [], [], ["", "Nomor", "Tanggal", "Penginput", "Tujuan", "Perihal", "File"],
    ["", "375", date, "Staf Uji", "Vendor Fiktif", subject, ""],
    ["", "376", "tanggal keliru", "Staf Uji", "Vendor Fiktif", "Baris ditolak", ""]];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), name);
  const file = { name: "register-sqa.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) };
  const url = "/api/letters/outgoing-excel";
  expect(await api("root", url, multipart({ file }))).toMatchObject({ inserted: 1, skipped: 1 });
  expect(await api("root", url, multipart({ file }))).toMatchObject({ inserted: 0, updated: 1 });
  await api("staff", url, multipart({ file }, 403));
  const exported = XLSX.read(await (await api.response("root", url)).body());
  expect(XLSX.utils.sheet_to_json(exported.Sheets[name], { header: 1 }).flat()).toContain(subject);
});

test("SPK-01 | SPK Masuk wajib berkas asli dan menyimpan surat pendukung", async ({ api }) => {
  const support = await incoming(api);
  const metadata = { direction: "INCOMING", document_type: spkIn, subject: tag(),
    external_number: tag(), sender: "Vendor Fiktif", letter_date: date, routing_target_user_id: accounts.dirops.id };
  await api("staff", "/api/letters", post(metadata, 400));
  const spk = await incoming(api, "staff", {
    document_type: spkIn, business: { supporting_letter_ids: [support.id] },
  }, pdfFile("spk-masuk-fiktif.pdf"));
  const detail = await api("staff", `/api/letters/${spk.id}`);
  expect(detail.business.supporting_letters.map((item) => item.id)).toEqual([support.id]);
  expect(detail.attachments.some((file) => file.original_name === "spk-masuk-fiktif.pdf")).toBe(true);
});

test("SPK-02 | SPK Keluar, cetak naskah, tanda tangan basah, dan lampiran final", async ({ api }) => {
  const spk = await outgoing(api, { document_type: spkOut });
  await approveOutgoing(api, spk);
  await letterAction(api, "secretariat", spk.id, "PREPARE_ISSUE", "WAITING_SIGNATURE");
  const preview = await api.response("secretariat", `/print/letters/${spk.id}`);
  expect(await preview.text()).toContain("Surat Perintah Kerja");
  await issuePrepared(api, spk.id, "BASAH");
  const detail = await api("staff", `/api/letters/${spk.id}`);
  expect(detail.business.signature_method).toBe("BASAH");
});

test("INV-01 | Invoice Masuk dengan dan tanpa rujukan SPK", async ({ api }) => {
  const spk = await incoming(api, "staff", { document_type: spkIn }, pdfFile("spk-ref.pdf"));
  const invoice = await incoming(api, "staff", {
    document_type: invoiceIn, business: { total: "950000.50", requires_spk: true, spk_reference_id: spk.id },
  }, pdfFile("invoice-masuk.pdf"));
  const detail = await api("staff", `/api/letters/${invoice.id}`);
  expect(detail.business.invoice).toMatchObject({ requires_spk: true, spk_reference: { id: spk.id } });
  expect(Number(detail.business.invoice.total)).toBe(950000.5);
  const optional = await incoming(api, "staff", {
    document_type: invoiceIn, business: { total: "150000" },
  }, pdfFile("invoice-tanpa-spk.pdf"));
  expect((await api("staff", `/api/letters/${optional.id}`)).business.invoice.spk_reference).toBeNull();
});

test("INV-02 | Invoice Keluar menghitung item, mencetak, dan diterbitkan", async ({ api }) => {
  const invoice = await outgoing(api, {
    document_type: invoiceOut, business: { items: [
      { description: "Jasa fiktif", quantity: "2.5", unit_price: "100000.00" },
      { description: "Transport fiktif", quantity: "1", unit_price: "75000.50" },
    ] },
  });
  const detail = await api("staff", `/api/letters/${invoice.id}`);
  expect(Number(detail.business.invoice.total)).toBe(325000.5);
  expect(detail.business.invoice.items.map((item) => Number(item.total))).toEqual([250000,75000.5]);
  const preview = await api.response("staff", `/print/letters/${invoice.id}`);
  expect(await preview.text()).toContain("Transport fiktif");
  await approveOutgoing(api, invoice);
  await issue(api, invoice.id);
});

test("INV-03 | Validasi rincian dan SPK wajib pada Invoice Keluar", async ({ api }) => {
  const number_format_id = await formatFor(api, invoiceOut);
  const data = { direction: "OUTGOING", document_type: invoiceOut, subject: tag(), recipient: "Vendor Fiktif",
    letter_date: date, routing_target_user_id: accounts.manager.id, number_format_id };
  await api("staff", "/api/letters", post({ ...data, business: { items: [] } }, 400));
  const items = [{ description: "Jasa fiktif", quantity: "1", unit_price: "10000" }];
  await api("staff", "/api/letters", post({ ...data, business: { items, requires_spk: true } }, 400));
});
