import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import { accounts, baseURL, date, samples } from "../../scripts/sqa/config.mjs";

export { accounts, date, expect, samples };
export const tag = () => "SQA-" + randomUUID().slice(0, 8);

async function verified(response, expected, label) {
  const status = response.status();
  if (status !== expected) {
    const details = (await response.text()).slice(0, 500);
    expect(status, `${label}: ${details}`).toBe(expected);
  }
  return response;
}

export const test = base.extend({
  api: [async ({ playwright }, use) => {
    const client = await playwright.request.newContext({ baseURL });
    const sessions = new Map();
    async function signIn(email, password, expected = 200) {
      const loginClient = await playwright.request.newContext({ baseURL });
      try {
        const response = await verified(
          await loginClient.post("/api/auth/login", { data: { email, password } }),
          expected, "login",
        );
        const payload = await response.json();
        const session = response.headers()["set-cookie"]?.match(/(?:^|\s)siap_session=[^;]+/)?.[0].trim();
        if (expected === 200) expect(session).toBeTruthy();
        return { user: payload.data, session };
      } finally {
        await loginClient.dispose();
      }
    }
    async function sessionFor(role) {
      if (!role) return null;
      if (!sessions.has(role)) {
        const account = accounts[role];
        sessions.set(role, await signIn(account.email, account.password));
      }
      return sessions.get(role).session;
    }
    async function response(role, url, { expect: status = 200, session, ...options } = {}) {
      const cookie = session ?? await sessionFor(role);
      return verified(await client.fetch(url, {
        ...options,
        headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}) },
      }), status, `${options.method ?? "GET"} ${url}`);
    }
    async function api(role, url, options) {
      const result = await response(role, url, options);
      const payload = await result.json();
      return payload.data ?? payload;
    }
    api.response = response;
    api.signIn = signIn;
    api.browserLogin = async (page, role) => {
      const cookie = await sessionFor(role);
      await page.context().addCookies([{
        url: baseURL, name: "siap_session", value: cookie.slice("siap_session=".length),
      }]);
    };
    await use(api);
    await client.dispose();
  }, { scope: "worker" }],
});

export function send(method, data, status = 200) {
  return { method, data, expect: status };
}

export const post = (data, status) => send("POST", data, status);
export const put = (data, status) => send("PUT", data, status);
export const patch = (data, status) => send("PATCH", data, status);
export const del = (data, status) => send("DELETE", data, status);

export function multipart(fields, status = 200) {
  return { method: "POST", multipart: fields, expect: status };
}

export function textFile(name = "bukti-sqa.txt", value = "Bukti fiktif SQA SIAP ARU\n") {
  return { name, mimeType: "text/plain", buffer: Buffer.from(value) };
}

export function pdfFile(name, lines = ["SIAP ARU - dokumen fiktif untuk pengujian"]) {
  const escape = (text) => text.replace(/[\\()]/g, "\\$&");
  const content = `BT /F1 10 Tf 14 TL 36 760 Td ${lines.map((line, i) =>
    `${i ? "T* " : ""}(${escape(line)}) Tj`).join("\n")} ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 650 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name, mimeType: "application/pdf", buffer: Buffer.from(pdf) };
}

export async function formatFor(api, type) {
  const formats = await api("staff", "/api/admin/number-formats");
  const result = formats.find((item) => item.document_type === type && item.is_active);
  expect(result, `format untuk ${type}`).toBeDefined();
  return result.id;
}

export function incoming(api, role = "staff", fields = {}, file) {
  const data = {
    direction: "INCOMING",
    document_type: "SURAT_MASUK_UMUM",
    subject: "Permohonan vendor " + tag(),
    external_number: tag(),
    sender: "Vendor Fiktif",
    recipient: "Operasional",
    letter_date: date,
    received_date: date,
    routing_target_user_id: accounts.dirops.id,
    confidentiality: "RAHASIA",
    is_public: false,
    ...fields,
  };
  return api(role, "/api/letters", file
    ? multipart({ metadata: JSON.stringify(data), original_file: file }, 201)
    : post(data, 201));
}

export async function outgoing(api, fields = {}, role = "staff") {
  const documentType = fields.document_type ?? "SURAT_UMUM";
  const format = fields.number_format_id ?? await formatFor(api, documentType);
  return api(role, "/api/letters", post({
    direction: "OUTGOING", document_type: documentType,
    subject: "Surat keluar " + tag(), recipient: "Vendor Fiktif",
    letter_date: date, routing_target_user_id: accounts.manager.id,
    number_format_id: format, confidentiality: "RAHASIA", is_public: false,
    ...fields,
  }, 201));
}

export function internal(api, fields = {}) {
  return api("staff", "/api/letters", post({
    direction: "INTERNAL", document_type: "NOTA_DINAS", subject: "Nota dinas " + tag(),
    letter_date: date, routing_target_user_id: accounts.manager.id,
    confidentiality: "RAHASIA", is_public: false, ...fields,
  }, 201));
}

export async function letterAction(api, role, id, action, status, fields = {}, code = 200) {
  const result = await api(role, `/api/letters/${id}/actions`, post({ action, ...fields }, code));
  if (status) expect(result.status, action).toBe(status);
  return result;
}

export async function approveOutgoing(api, letter, composer = "staff", manager = "manager") {
  await letterAction(api, composer, letter.id, "SUBMIT", "MANAGER_REVIEW");
  await letterAction(api, manager, letter.id, "APPROVE", "DIRECTOR_OPS_REVIEW");
  const afterOps = await letterAction(api, "dirops", letter.id, "APPROVE");
  if (afterOps.status === "SECRETARIAT_REVIEW") {
    await letterAction(api, "secretariat", letter.id, "APPROVE", "PRESIDENT_DIRECTOR_REVIEW");
  } else {
    expect(afterOps.status).toBe("PRESIDENT_DIRECTOR_REVIEW");
  }
  await letterAction(api, "dirut", letter.id, "APPROVE", "READY_TO_ISSUE");
}

export async function issue(api, id, signature = "DIGITAL") {
  await letterAction(api, "secretariat", id, "PREPARE_ISSUE", "WAITING_SIGNATURE");
  return issuePrepared(api, id, signature);
}

export async function issuePrepared(api, id, signature = "DIGITAL") {
  const issued = await api("secretariat", `/api/letters/${id}/actions`, multipart({
    action: "ISSUE", issued_date: date, signature_method: signature,
    signed_file: pdfFile("surat-final-sqa.pdf"),
  }));
  expect(issued.status).toBe("ISSUED");
  return issued;
}

export async function approvedIncoming(api, reviewer = "dirops") {
  const letter = await incoming(api, "secretariat", { routing_target_user_id: accounts[reviewer].id });
  await letterAction(api, reviewer, letter.id, reviewer === "dirut" ? "APPROVE" : "APPROVE_FINAL", "APPROVED");
  return letter;
}

export function disposition(api, role, letterId, toUser, fields = {}) {
  return api(role, "/api/dispositions", post({
    letter_id: letterId, to_user_id: accounts[toUser].id,
    instruction: "Siapkan tindak lanjut fiktif", visibility: "PRIVATE",
    ...fields,
  }, 201));
}

export async function dispositionAction(api, role, id, action, status, fields = {}, code = 200) {
  const result = await api(role, `/api/dispositions/${id}/actions`, post({ action, ...fields }, code));
  if (status) expect(result.status, action).toBe(status);
  return result;
}
