import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { hmacHeaders, MEKARI_SANDBOX_BASE } from "./mekari-hmac.mjs";

export { hmacHeaders, MEKARI_SANDBOX_BASE } from "./mekari-hmac.mjs";
const MAX_PDF_SIZE = 10 * 1024 * 1024;
const SEND_SIGNATURE_ROUTE = "/v1/documents/request_global_sign";
const MAX_ERROR_BYTES = 16 * 1024;
export const MEKARI_PILOT_JOB_MODE = "sandbox-test";

export function sandboxAttachmentsEnabled() {
  return process.env.SIAP_DEV_STAGING !== "1" && process.env.SIAP_V11_MEKARI_MODE === "sandbox" &&
    process.env.SIAP_V11_MEKARI_ATTACHMENT_SANDBOX === "1";
}

export function mekariMode() {
  if (process.env.SIAP_DEV_STAGING === "1") return null;
  const mode = process.env.SIAP_V11_MEKARI_MODE;
  if (process.env.SIAP_V11_STAGE !== "1" || !/^siap_aru_sqa_v11_[a-z0-9]{4,24}$/.test(process.env.DB_NAME ?? "")) return null;
  return mode === "mock" || mode === "sandbox" ? mode : null;
}

export function sandboxCredentials() {
  const id = process.env.MEKARI_CLIENT_ID || "";
  const secret = process.env.MEKARI_CLIENT_SECRET || "";
  if (!/^[\w.\-]{1,150}$/.test(id) || !secret) throw new Error("Kredensial sandbox Mekari belum siap.");
  return { id, secret };
}

export class MekariError extends Error {
  readonly status: number;
  readonly retryAfter: number | null;
  readonly rejection?: MekariRejection;
  constructor(status: number, retryAfter: number | null = null, message?: string, rejection?: MekariRejection) {
    super(message ?? (status === 424 ? "PDF final sedang disiapkan di sandbox." : status === 0
      ? "Sandbox belum memberi respons yang dapat dikonfirmasi." : "Sandbox Mekari merespons HTTP " + status + "."));
    this.status = status;
    this.retryAfter = retryAfter;
    this.rejection = rejection;
  }
}

type MekariRejection = {
  code: string | null;
  reason: "QUOTA" | "VALIDATION" | null;
  fields: string[];
};

const validationFields: Record<string, string> = {
  doc: "PDF sumber", filename: "nama file", template_id: "templat", receivers: "penerima salinan",
  signers: "data penandatangan", "signers.name": "nama penandatangan", "signers.email": "email penandatangan",
  signing_order: "urutan tanda tangan", "signers.order": "urutan tanda tangan",
  "signers.annotations": "posisi tanda tangan", "signers.annotations.type_of": "jenis kolom tanda tangan",
  "signers.annotations.page": "halaman tanda tangan",
  "signers.annotations.position_x": "posisi kotak tanda tangan", "signers.annotations.position_y": "posisi kotak tanda tangan",
  "signers.annotations.element_width": "ukuran kotak tanda tangan", "signers.annotations.element_height": "ukuran kotak tanda tangan",
  "signers.annotations.canvas_width": "ukuran halaman PDF", "signers.annotations.canvas_height": "ukuran halaman PDF",
  callback_url: "konfigurasi callback Mekari",
};

function objectFields(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function readErrorBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get("Content-Length")) > MAX_ERROR_BYTES) return null;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_ERROR_BYTES) return null;
      chunks.push(part.value);
    }
    return objectFields(JSON.parse(Buffer.concat(chunks, size).toString("utf8")));
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function readSendRejection(response: Response): Promise<MekariRejection> {
  const body = await readErrorBody(response);
  const data = objectFields(body?.data);
  const code = typeof body?.code === "string" && body.code.length === 7 && /^MSN-\d{3}$/.test(body.code) ? body.code : null;
  const validation = response.status === 400 || response.status === 422;
  // The documented quota variant has no stable code. Its exact, known wording
  // only affects the displayed hint. Retry decisions use the HTTP status.
  const quota = response.status === 400 && [data?.message, body?.message].some(
    message => typeof message === "string" && /^quota is insufficient\.?$/i.test(message.trim()),
  );
  const fields = new Set<string>();
  if (validation && !quota) {
    for (const key of Object.keys(objectFields(data?.params) ?? {})) {
      const path = key.replace(/\[([a-z_]+|\d+)\]/g, ".$1").replace(/\.\d+(?=\.|$)/g, "");
      if (Object.hasOwn(validationFields, path)) fields.add(validationFields[path]);
    }
  }
  return { code, reason: quota ? "QUOTA" : fields.size ? "VALIDATION" : null, fields: [...fields] };
}

function sendRejectionMessage(status: number, rejection: MekariRejection) {
  let hint: string;
  switch (status) {
    case 400:
    case 422:
      hint = rejection.reason === "QUOTA" ? "Kuota tanda tangan Sandbox tidak mencukupi. Periksa kuota akun sebelum mengirim ulang."
        : rejection.fields.length ? `Periksa kolom yang ditandai Mekari: ${rejection.fields.join(", ")}.`
          : "Mekari belum memberi rincian yang dapat ditampilkan. Periksa kuota, PDF, data penandatangan, dan penempatan tanda tangan.";
      break;
    case 401:
      hint = "Minta admin memeriksa konfigurasi autentikasi HMAC Sandbox.";
      break;
    case 403:
      hint = "Minta admin memeriksa kredensial dan akses akun ke pengiriman tanda tangan Sandbox.";
      break;
    case 404:
      hint = "Minta admin memeriksa konfigurasi layanan Sandbox.";
      break;
    default:
      hint = "Periksa daftar dokumen di akun Mekari Sandbox sebelum mengajukan ulang.";
  }
  const prefix = [400, 401, 403, 404, 422].includes(status)
    ? "Mekari menolak pengajuan tanda tangan"
    : "Mekari belum mengonfirmasi pengajuan tanda tangan";
  return `${prefix} (HTTP ${status}). ${hint}${rejection.code ? ` Kode Mekari ${rejection.code}.` : ""}`;
}

export function sandboxSendFailure(error: unknown) {
  const vendor = error instanceof MekariError ? error : null;
  const httpStatus = vendor?.status || null;
  const rejection = vendor?.rejection;
  const status = httpStatus !== null && [400, 401, 403, 404, 422].includes(httpStatus) ? "FAILED" : "RECONCILE";
  return {
    status, httpStatus, providerCode: rejection?.code ?? null, reason: rejection?.reason ?? null,
    invalidFields: rejection?.fields ?? [],
    message: vendor && httpStatus !== null ? vendor.message
      : "Status pengajuan belum dapat dipastikan. Periksa daftar dokumen di akun Mekari Sandbox sebelum mengajukan ulang.",
  };
}

export function sandboxErrorStatus(error: unknown) {
  return error instanceof MekariError && [401, 403, 404].includes(error.status) ? 424 : 400;
}

function badRequestMessage(route: string) {
  if (route === "/v1/documents/predict_annotations") {
    return "Mekari menolak prediksi posisi (HTTP 400). Gunakan Atur Posisi di PDF untuk menempatkan kotak tanda tangan.";
  }
  if (route.endsWith("/download")) return "Mekari menolak pengambilan PDF final (HTTP 400).";
  return "Mekari menolak pengecekan status dokumen (HTTP 400).";
}

export function canRetrySandboxJob(status: unknown, providerId: unknown, finalAttachmentId: unknown) {
  return status === "FAILED" && providerId == null && finalAttachmentId == null;
}

async function request(method: "GET" | "POST", route: string, options: { body?: unknown; timeoutMs?: number; scope?: "attachment" } = {}) {
  const { body, timeoutMs = 12_000, scope } = options;
  if (scope === "attachment" ? !sandboxAttachmentsEnabled() : mekariMode() !== "sandbox") throw new Error("Mode sandbox tidak aktif.");
  const url = new URL(MEKARI_SANDBOX_BASE + route);
  const headers = hmacHeaders(method, url, sandboxCredentials());
  const payload = JSON.stringify(body);
  const payloadHeaders = payload === undefined ? undefined : {
    "Content-Type": "application/json",
    Digest: "SHA-256=" + createHash("sha256").update(payload, "utf8").digest("base64"),
  };
  let response: Response;
  try {
    response = await fetch(url, {
      method, headers: { ...headers, ...payloadHeaders }, body: payload,
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new MekariError(0);
  }
  if (!response.ok) {
    const hint = response.headers.get("Retry-After");
    const seconds = hint && /^\d+$/.test(hint) ? Number(hint) : hint ? Math.ceil((Date.parse(hint) - Date.now()) / 1000) : 0;
    const retryAfter = seconds > 0 ? Math.min(seconds, 600) : null;
    if (route === SEND_SIGNATURE_ROUTE) {
      const rejection = await readSendRejection(response);
      throw new MekariError(response.status, retryAfter, sendRejectionMessage(response.status, rejection), rejection);
    }
    await response.body?.cancel().catch(() => {});
    const message = response.status === 400 ? badRequestMessage(route) : undefined;
    throw new MekariError(response.status, retryAfter, message);
  }
  return response;
}

export type SignatureAnnotation = {
  type_of: "signature"; page: number; position_x: number; position_y: number;
  element_width: number; element_height: number; canvas_width: number; canvas_height: number;
};

function signatureAnnotation(input: Record<string, unknown>): SignatureAnnotation {
  const read = (key: string, min: number, max: number) => {
    const value = input[key];
    if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim()) ||
        !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) {
      throw new Error("Koordinat penempatan tanda tangan tidak valid.");
    }
    return Number(value);
  };
  const annotation: SignatureAnnotation = {
    type_of: "signature", page: read("page", 1, 500), position_x: read("position_x", 0, 2000),
    position_y: read("position_y", 0, 2000), element_width: read("element_width", 1, 2000),
    element_height: read("element_height", 1, 2000), canvas_width: read("canvas_width", 1, 2000),
    canvas_height: read("canvas_height", 1, 2000),
  };
  if (!Number.isInteger(annotation.page) || annotation.position_x + annotation.element_width > annotation.canvas_width ||
      annotation.position_y + annotation.element_height > annotation.canvas_height) throw new Error("Bidang tanda tangan berada di luar halaman.");
  return annotation;
}

function configuredSandboxRecipients(input: Record<string, unknown>) {
  const entries = input.signers === undefined ? [input] : input.signers;
  if (!Array.isArray(entries) || !entries.length) throw new Error("Tambahkan minimal satu penandatangan.");
  const seen = new Set<string>();
  return entries.map((entry: unknown, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Data penandatangan tidak valid.");
    const fields = entry as Record<string, unknown>;
    const email = typeof fields.signer_email === "string" ? fields.signer_email.trim().toLowerCase() : "";
    const name = typeof fields.signer_name === "string" ? fields.signer_name.trim().slice(0, 150) : "";
    if (!name || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
      throw new Error(`Penandatangan ${index + 1} memerlukan nama dan alamat email yang valid.`);
    }
    if (seen.has(email)) throw new Error("Setiap penandatangan harus memakai email yang berbeda.");
    seen.add(email);
    return { name, email, fields };
  });
}

export function configuredSandboxSigning(input: Record<string, unknown>) {
  if (process.env.SIAP_V11_MEKARI_ALLOW_SEND !== "1") {
    throw new Error("Pengiriman sandbox belum diaktifkan.");
  }
  if (input.signing_order !== undefined && typeof input.signing_order !== "boolean") {
    throw new Error("Mode urutan tanda tangan tidak valid.");
  }
  const signers = configuredSandboxRecipients(input).map(({ name, email, fields }, index) => {
    try {
      return { name, email, annotations: [signatureAnnotation(fields)] };
    } catch (error) {
      throw new Error(`Penandatangan ${index + 1}: ${(error as Error).message}`);
    }
  });
  return { signers, signing_order: input.signing_order === true };
}

export async function predictSandboxAnnotations(filename: string, pdf: Buffer, input: Record<string, unknown>, scope?: "attachment") {
  const recipients = configuredSandboxRecipients(input).map(({ name, email }) => ({ name, email }));
  let response: Response;
  try {
    response = await request("POST", "/v1/documents/predict_annotations", {
      body: { doc: pdf.toString("base64"), filename, recipients, annotation_types: ["signature"] },
      timeoutMs: 45_000, scope,
    });
  } catch (error) {
    if (error instanceof MekariError && error.status === 403) {
      throw new Error("Akun Sandbox belum memiliki akses prediksi. Gunakan Atur Posisi di PDF untuk menempatkan kotak tanda tangan.");
    }
    if (error instanceof MekariError && error.status === 422) {
      throw new Error("Mekari belum bisa memprediksi posisi tanda tangan untuk PDF ini.");
    }
    throw error;
  }
  const result = await response.json().catch(() => {
    throw new Error("Respons prediksi dari Mekari tidak dapat dibaca.");
  });
  if (result?.error === true) throw new Error("Mekari belum bisa memprediksi posisi tanda tangan untuk PDF ini.");

  // Mekari exposes the AI's raw result in data.data without a fixed schema.
  // Keep only complete signature coordinates accepted by the signing endpoint.
  const suggestions = new Map<string, SignatureAnnotation>();
  const pending: unknown[] = [result?.data?.data];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    const fields = value as Record<string, unknown>;
    if ("position_x" in fields && (fields.type_of === undefined || fields.type_of === "signature")) {
      try {
        const annotation = signatureAnnotation(fields);
        const key = JSON.stringify(annotation);
        suggestions.set(key, annotation);
      } catch {
        // The operator can position fields manually when predictions are incomplete.
      }
    }
    for (const child of Object.values(value).reverse()) {
      if (child && typeof child === "object") pending.push(child);
    }
  }
  return Array.from(suggestions.values());
}

function providerId(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._-]{1,160}$/.test(value)) throw new Error("ID dokumen Mekari tidak valid.");
  return value;
}

export async function sendSandboxSignature(filename: string, pdf: Buffer, signing: ReturnType<typeof configuredSandboxSigning>, callback: string | null, scope?: "attachment") {
  const signers = signing.signing_order ? signing.signers.map((signer, index) => ({ ...signer, order: index + 1 })) : signing.signers;
  const response = await request("POST", SEND_SIGNATURE_ROUTE, {
    scope,
    body: {
      filename, doc: pdf.toString("base64"), signers, receivers: [],
      ...(signing.signing_order ? { signing_order: true } : {}),
      ...(callback ? { callback_url: callback } : {}),
    },
  });
  const result = await response.json().catch(() => { throw new MekariError(0); });
  return providerId(result?.data?.id);
}

export function providerStatus(value: unknown) {
  const status = String(value ?? "").trim().toUpperCase();
  if (!["IN_PROGRESS", "COMPLETED", "VOIDED", "DECLINED", "DENIED"].includes(status)) {
    throw new Error("Status dokumen sandbox tidak dikenal.");
  }
  return status;
}

const SIGNER_STATUSES = ["awaiting", "your_turn", "completed"] as const;
type SignerStatus = typeof SIGNER_STATUSES[number] | "unknown";
export type SandboxProgress = { status: string; signers: { name: string; status: SignerStatus }[] };

export function sandboxPollDelay(nextPollAt: Date | null) {
  return nextPollAt ? Math.max(0, Math.ceil((new Date(nextPollAt).getTime() - Date.now()) / 1000)) : 0;
}

export async function sandboxStatus(id: string, scope?: "attachment"): Promise<SandboxProgress> {
  const response = await request("GET", "/v1/documents/" + providerId(id), { scope });
  const result = await response.json().catch(() => { throw new MekariError(0); });
  if (result?.data?.id !== id) throw new Error("Respons dokumen sandbox tidak cocok.");
  const attributes = result.data.attributes;
  const signers: unknown[] = Array.isArray(attributes?.signers) ? attributes.signers : [];
  return {
    status: providerStatus(attributes?.signing_status),
    // Provider entries can contain one-time signing links and passcodes. Return display fields only.
    signers: signers.map((signer, index) => {
      const fields = signer && typeof signer === "object" ? signer as Record<string, unknown> : null;
      const status = SIGNER_STATUSES.find(value => value === fields?.status) ?? "unknown";
      const name = typeof fields?.name === "string" ? fields.name.trim().slice(0, 150) : "";
      return { status, name: name || `Penandatangan ${index + 1}` };
    }),
  };
}

// Caller must check authoritative COMPLETED status before fetching the PDF.
export async function sandboxPdf(id: string, scope?: "attachment") {
  const response = await request("GET", "/v1/documents/" + providerId(id) + "/download", { scope });
  if (Number(response.headers.get("Content-Length")) > MAX_PDF_SIZE || !response.body) {
    throw new Error("Berkas final sandbox melebihi batas atau kosong.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_PDF_SIZE) throw new Error("Berkas final sandbox melebihi 10 MB.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

function callbackToken(id: string) {
  const secret = process.env.SIAP_V11_WEBHOOK_SECRET || "";
  if (secret.length < 32) return null;
  return createHmac("sha256", secret).update("mekari-signing:" + id).digest("hex");
}

export function callbackUrl(id: string) {
  const base = process.env.SIAP_V11_MEKARI_CALLBACK_BASE_URL;
  if (!base) return null;
  const token = callbackToken(id);
  const origin = new URL(base);
  if (!token || origin.protocol !== "https:" || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Origin callback staging HTTPS tidak valid.");
  const webhook = new URL("/api/webhooks/mekari/" + id, origin);
  webhook.searchParams.set("token", token);
  return webhook.toString();
}

export function callbackAuthorized(id: string, token: string) {
  const expected = callbackToken(id);
  return Boolean(expected && /^[a-f0-9]{64}$/.test(token) &&
    timingSafeEqual(Buffer.from(expected!), Buffer.from(token)));
}

export function mockSignedPdf() {
  const stream = "BT /F1 18 Tf 50 700 Td (SIMULASI MEKARI SIGN - BUKAN TANDA TANGAN RIIL) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let text = "%PDF-1.5\n";
  const offsets: number[] = [];
  for (const [i, object] of objects.entries()) {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = text.length;
  text += "xref\n0 6\n0000000000 65535 f \n" + offsets.map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("");
  return Buffer.from(text + `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF\n`, "ascii");
}
