import { createHmac, timingSafeEqual } from "node:crypto";

const BASE = "https://sandbox-api.mekari.com/v2/esign-hmac";
const MAX_PDF_SIZE = 10 * 1024 * 1024;

export function mekariMode() {
  const mode = process.env.SIAP_V11_MEKARI_MODE;
  if (process.env.SIAP_V11_STAGE !== "1" || !/^siap_aru_sqa_v11_[a-z0-9]{4,24}$/.test(process.env.DB_NAME ?? "")) return null;
  return mode === "mock" || mode === "sandbox" ? mode : null;
}

export function hmacHeaders(method: string, url: URL, config: { id: string; secret: string }, date = new Date()) {
  if (!/^[\w.\-]{1,150}$/.test(config.id) || !config.secret) throw new Error("Kredensial sandbox Mekari belum siap.");
  const dateValue = date.toUTCString();
  const signature = createHmac("sha256", config.secret)
    .update(`date: ${dateValue}\n${method.toUpperCase()} ${url.pathname}${url.search} HTTP/1.1`)
    .digest("base64");
  return {
    Date: dateValue,
    Authorization: `hmac username="${config.id}", algorithm="hmac-sha256", headers="date request-line", signature="${signature}"`,
  };
}

export class MekariError extends Error {
  readonly status: number;
  readonly retryAfter: number | null;
  constructor(status: number, retryAfter: number | null = null) {
    super(status === 424 ? "PDF final sedang disiapkan di sandbox." : status === 0
      ? "Sandbox belum memberi respons yang dapat dikonfirmasi." : "Sandbox Mekari merespons HTTP " + status + ".");
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function request(method: "GET" | "POST", route: string, body?: unknown) {
  if (mekariMode() !== "sandbox") throw new Error("Mode sandbox tidak aktif.");
  const url = new URL(BASE + route);
  const headers = hmacHeaders(method, url, {
    id: process.env.MEKARI_CLIENT_ID || "", secret: process.env.MEKARI_CLIENT_SECRET || "",
  });
  let response: Response;
  try {
    response = await fetch(url, {
      method, headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new MekariError(0);
  }
  if (!response.ok) {
    const hint = response.headers.get("Retry-After");
    const seconds = hint && /^\d+$/.test(hint) ? Number(hint) : hint ? Math.ceil((Date.parse(hint) - Date.now()) / 1000) : 0;
    await response.body?.cancel().catch(() => {});
    throw new MekariError(response.status, seconds > 0 ? Math.min(seconds, 600) : null);
  }
  return response;
}

type Annotation = {
  type_of: "signature"; page: number; position_x: number; position_y: number;
  element_width: number; element_height: number; canvas_width: number; canvas_height: number;
};

export function configuredSandboxSigner(input: Record<string, unknown>) {
  const allow = (process.env.SIAP_V11_MEKARI_TEST_RECIPIENTS || "").toLowerCase().split(",").map(email => email.trim());
  const email = typeof input.signer_email === "string" ? input.signer_email.trim().toLowerCase() : "";
  const name = typeof input.signer_name === "string" ? input.signer_name.trim().slice(0, 150) : "";
  if (process.env.SIAP_V11_MEKARI_ALLOW_SEND !== "1" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !allow.includes(email) || !name) {
    throw new Error("Pengiriman sandbox memerlukan signer simulasi yang sudah diizinkan.");
  }
  const read = (key: string, min: number, max: number) => {
    const value = input[key];
    if ((typeof value !== "number" && typeof value !== "string") || value === "" ||
        !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) {
      throw new Error("Koordinat penempatan tanda tangan tidak valid.");
    }
    return Number(value);
  };
  const annotation: Annotation = {
    type_of: "signature", page: read("page", 1, 500), position_x: read("position_x", 0, 2000),
    position_y: read("position_y", 0, 2000), element_width: read("element_width", 1, 2000),
    element_height: read("element_height", 1, 2000), canvas_width: read("canvas_width", 1, 2000),
    canvas_height: read("canvas_height", 1, 2000),
  };
  if (!Number.isInteger(annotation.page) || annotation.position_x + annotation.element_width > annotation.canvas_width ||
      annotation.position_y + annotation.element_height > annotation.canvas_height) throw new Error("Bidang tanda tangan berada di luar halaman.");
  return { name, email, annotations: [annotation] };
}

function providerId(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._-]{1,160}$/.test(value)) throw new Error("ID dokumen Mekari tidak valid.");
  return value;
}

export async function sendSandboxSignature(filename: string, pdf: Buffer, signer: ReturnType<typeof configuredSandboxSigner>, callback: string | null) {
  const response = await request("POST", "/v1/documents/request_global_sign", {
    filename, doc: pdf.toString("base64"), signers: [signer], receivers: [], ...(callback ? { callback_url: callback } : {}),
  });
  const result = await response.json();
  return providerId(result?.data?.id);
}

export function providerStatus(value: unknown) {
  const status = String(value ?? "").toUpperCase();
  if (!["IN_PROGRESS", "COMPLETED", "VOIDED", "DECLINED", "DENIED"].includes(status)) {
    throw new Error("Status dokumen sandbox tidak dikenal.");
  }
  return status;
}

export async function sandboxStatus(id: string) {
  const response = await request("GET", "/v1/documents/" + providerId(id));
  const result = await response.json();
  if (result?.data?.id !== id) throw new Error("Respons dokumen sandbox tidak cocok.");
  return providerStatus(result?.data?.attributes?.signing_status);
}

// Caller must check authoritative COMPLETED status before fetching the PDF.
export async function sandboxPdf(id: string) {
  const response = await request("GET", "/v1/documents/" + providerId(id) + "/download");
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
