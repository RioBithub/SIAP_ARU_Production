import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mockSignedPdf, sandboxStatus, sendSandboxSignature } from "../../lib/mekari-sign.ts";

test("Digest mencakup byte JSON yang dikirim dan header absen pada GET", async t => {
  const fixture = {
    DB_NAME: "siap_aru_sqa_v11_digest",
    SIAP_V11_STAGE: "1",
    SIAP_V11_MEKARI_MODE: "sandbox",
    MEKARI_CLIENT_ID: "fixture-client",
    MEKARI_CLIENT_SECRET: "fixture-only-hmac-test",
  };
  const previous = Object.fromEntries(Object.keys(fixture).map(key => [key, process.env[key]]));
  Object.assign(process.env, fixture);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ data: { id: "fixture-document", attributes: { signing_status: "in_progress" } } }));
  const name = "SIMULASI–Surat.pdf";
  const pdf = mockSignedPdf();
  const signer = { name: "Réndi Simulasi", email: "signer@example.invalid", annotations: [] };
  assert.equal(await sendSandboxSignature(name, pdf, signer, null), "fixture-document");
  assert.equal(await sandboxStatus("fixture-document"), "IN_PROGRESS");

  assert.equal(fetchMock.mock.callCount(), 2);
  const [send, poll] = fetchMock.mock.calls.map(({ arguments: args }) => new Request(...args));
  assert.equal(send.url, "https://sandbox-api.mekari.com/v2/esign-hmac/v1/documents/request_global_sign");
  assert.equal(send.method, "POST");
  assert.equal(send.headers.get("Content-Type"), "application/json");
  const payload = Buffer.from(await send.arrayBuffer());
  assert.equal(send.headers.get("Digest"), "SHA-256=" + createHash("sha256").update(payload).digest("base64"));
  assert.deepEqual(JSON.parse(payload.toString("utf8")), {
    filename: name, doc: pdf.toString("base64"), signers: [signer], receivers: [],
  });
  assert.equal(poll.method, "GET");
  assert.equal(poll.headers.has("Digest"), false);
});
