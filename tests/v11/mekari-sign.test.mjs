import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { beforeEach } from "node:test";
import {
  configuredSandboxSigning, mockSignedPdf, sandboxAttachmentsEnabled, predictSandboxAnnotations, sandboxPdf, sandboxStatus, sendSandboxSignature,
} from "../../lib/mekari-sign.ts";

beforeEach(t => {
  const fixture = {
    DB_NAME: "siap_aru_sqa_v11_digest",
    SIAP_V11_STAGE: "1",
    SIAP_V11_MEKARI_MODE: "sandbox",
    SIAP_V11_MEKARI_ATTACHMENT_SANDBOX: "0",
    MEKARI_CLIENT_ID: "fixture-client",
    MEKARI_CLIENT_SECRET: "fixture-only-hmac-test",
    SIAP_V11_MEKARI_ALLOW_SEND: "1",
  };
  const previous = Object.fromEntries(Object.keys(fixture).map(key => [key, process.env[key]]));
  Object.assign(process.env, fixture);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
});

const signaturePlacement = {
  page: 1, position_x: 100, position_y: 700, element_width: 150, element_height: 50,
  canvas_width: 612, canvas_height: 792,
};
const firstSigner = { signer_name: "Réndi Simulasi", signer_email: "signer@example.invalid", ...signaturePlacement };
const secondSigner = {
  ...signaturePlacement, position_x: 300, signer_name: "Pemeriksa Simulasi", signer_email: "reviewer@example.invalid",
};
const pdf = mockSignedPdf();

test("HTTP 400 menyebut tahap yang ditolak tanpa meneruskan respons mentah Mekari", async t => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ message: "fixture-private@example.invalid" }, { status: 400 }));
  const cases = [
    [() => predictSandboxAnnotations("SIMULASI.pdf", pdf, firstSigner), "prediksi posisi"],
    [() => sendSandboxSignature("SIMULASI.pdf", pdf, configuredSandboxSigning(firstSigner), null), "pengajuan tanda tangan"],
    [() => sandboxStatus("fixture-document"), "pengecekan status"],
    [() => sandboxPdf("fixture-document"), "pengambilan PDF final"],
  ];
  for (const [request, stage] of cases) {
    await assert.rejects(request, error => error.status === 400 && error.message.includes(stage) &&
      !error.message.includes("fixture-private"));
  }
});

test("Digest mencakup byte JSON yang dikirim dan header absen pada GET", async t => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ data: { id: "fixture-document", attributes: { signing_status: "in_progress" } } }));
  const name = "SIMULASI–Surat.pdf";
  const signing = configuredSandboxSigning(firstSigner);
  assert.equal(await sendSandboxSignature(name, pdf, signing, null), "fixture-document");
  assert.equal((await sandboxStatus("fixture-document")).status, "IN_PROGRESS");

  assert.equal(fetchMock.mock.callCount(), 2);
  const [send, poll] = fetchMock.mock.calls.map(({ arguments: args }) => new Request(...args));
  assert.equal(send.url, "https://sandbox-api.mekari.com/v2/esign-hmac/v1/documents/request_global_sign");
  assert.equal(send.method, "POST");
  assert.equal(send.headers.get("Content-Type"), "application/json");
  const payload = Buffer.from(await send.arrayBuffer());
  assert.equal(send.headers.get("Digest"), "SHA-256=" + createHash("sha256").update(payload).digest("base64"));
  assert.deepEqual(JSON.parse(payload.toString("utf8")), {
    filename: name, doc: pdf.toString("base64"), signers: [{
      name: firstSigner.signer_name, email: firstSigner.signer_email,
      annotations: [{ type_of: "signature", ...signaturePlacement }],
    }], receivers: [],
  });
  assert.equal(poll.method, "GET");
  assert.equal(poll.headers.has("Digest"), false);
});

test("Payload multi-signer mengikuti urutan pilihan dan penempatan masing-masing", async t => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ data: { id: "fixture-document" } }));
  const signers = [secondSigner, firstSigner];
  for (const signing_order of [true, false]) {
    const signing = configuredSandboxSigning({ signers, signing_order });
    await sendSandboxSignature("SIMULASI.pdf", pdf, signing, null);
  }
  assert.equal(fetchMock.mock.callCount(), 2);
  const [ordered, parallel] = fetchMock.mock.calls.map(({ arguments: [, init] }) => JSON.parse(init.body));
  assert.equal(ordered.signing_order, true);
  assert.deepEqual(ordered.signers.map(signer => signer.order), [1, 2]);
  assert.deepEqual(ordered.signers.map(signer => signer.email), signers.map(signer => signer.signer_email));
  assert.deepEqual(ordered.signers.map(signer => signer.annotations[0].position_x), [300, 100]);
  assert.equal(parallel.signing_order, undefined);
  assert(parallel.signers.every(signer => !("order" in signer)));
});

test("Status dokumen dan progres setiap signer dipisahkan dari kredensial Mekari", async t => {
  const signers = [
    { name: "Pertama", status: "completed", signed_at: "2026-11-18T10:00:00Z", signing_url: "fixture-link" },
    { name: "Kedua", status: "your_turn", email: "tester@example.invalid", passcode: "fixture-code" },
    { name: "Ketiga", status: "awaiting" },
  ];
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ data: { id: "fixture-document", attributes: { signing_status: "in_progress", signers } } }));
  assert.deepEqual(await sandboxStatus("fixture-document"), {
    status: "IN_PROGRESS",
    signers: [
      { name: "Pertama", status: "completed" },
      { name: "Kedua", status: "your_turn" },
      { name: "Ketiga", status: "awaiting" },
    ],
  });
  fetchMock.mock.mockImplementation(async () =>
    Response.json({ data: { id: "other-document", attributes: { signing_status: "completed" } } }));
  await assert.rejects(sandboxStatus("fixture-document"), /dokumen sandbox tidak cocok/);
});

test("Email uji yang valid diterima, duplikat dan koordinat di luar halaman ditolak", () => {
  const other = configuredSandboxSigning({ signers: [firstSigner, { ...secondSigner, signer_email: "other@example.invalid" }] });
  assert.equal(other.signers[1].email, "other@example.invalid");
  assert.throws(() => configuredSandboxSigning({ signers: [firstSigner, { ...secondSigner, signer_email: "invalid-email" }] }), /Penandatangan 2/);
  assert.throws(() => configuredSandboxSigning({ signers: [firstSigner, { ...secondSigner, signer_email: "SIGNER@EXAMPLE.INVALID" }] }), /berbeda/);
  assert.throws(() => configuredSandboxSigning({ signers: [firstSigner, { ...secondSigner, position_x: 600 }] }), /di luar halaman/);
  assert.throws(() => configuredSandboxSigning({ signers: [firstSigner], signing_order: "false" }), /urutan/);
});

test("Prediksi mengirim PDF dan recipient sesuai skema serta hanya meneruskan koordinat yang valid", async t => {
  const prediction = { type_of: "signature", ...signaturePlacement };
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({
    data: { data: { suggestions: [
      { ...prediction, irrelevant: "fixture" }, prediction,
      { ...prediction, type_of: "initial" }, { ...prediction, position_y: 800 },
      { ...prediction, position_x: 300 },
    ] } }, error: false,
  }));
  const signers = [firstSigner, secondSigner];
  assert.deepEqual(await predictSandboxAnnotations("SIMULASI.pdf", pdf, { signers }), [
    prediction, { ...prediction, position_x: 300 },
  ]);
  const [url, init] = fetchMock.mock.calls[0].arguments;
  assert.equal(url.pathname, "/v2/esign-hmac/v1/documents/predict_annotations");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Digest, "SHA-256=" + createHash("sha256").update(init.body).digest("base64"));
  assert.deepEqual(JSON.parse(init.body), {
    doc: pdf.toString("base64"), filename: "SIMULASI.pdf", annotation_types: ["signature"],
    recipients: signers.map(signer => ({ name: signer.signer_name, email: signer.signer_email })),
  });
  fetchMock.mock.mockImplementation(async () => new Response(null, { status: 403 }));
  await assert.rejects(predictSandboxAnnotations("SIMULASI.pdf", pdf, { signers }), /belum memiliki akses/);
  fetchMock.mock.mockImplementation(async () => Response.json({ data: { data: { unknown_layout: {} } }, error: false }));
  assert.deepEqual(await predictSandboxAnnotations("SIMULASI.pdf", pdf, { signers }), []);
});

test("Sandbox lampiran memiliki konfigurasi sendiri di luar staging", async t => {
  process.env.DB_NAME = "aru_siap";
  process.env.SIAP_V11_STAGE = "0";
  const fake = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ data: { id: "fixture-document", attributes: { signing_status: "in_progress" } } }));
  assert.equal(sandboxAttachmentsEnabled(), false);
  await assert.rejects(sandboxStatus("fixture-document", "attachment"), /sandbox tidak aktif/);
  process.env.SIAP_V11_MEKARI_ATTACHMENT_SANDBOX = "1";
  assert.equal(sandboxAttachmentsEnabled(), true);
  assert.equal((await sandboxStatus("fixture-document", "attachment")).status, "IN_PROGRESS");
  await assert.rejects(sandboxStatus("fixture-document"), /sandbox tidak aktif/);
  assert.equal(fake.mock.callCount(), 1);
});
