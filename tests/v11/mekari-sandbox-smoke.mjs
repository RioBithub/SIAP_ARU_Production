import { randomBytes } from "node:crypto";
import { hmacHeaders, MEKARI_SANDBOX_BASE } from "../../lib/mekari-sign.ts";

async function checkReadOnly(path, credentials) {
  const url = new URL(MEKARI_SANDBOX_BASE + path);
  const headers = hmacHeaders("GET", url, credentials);
  let response;
  try {
    response = await fetch(url, {
      method: "GET", headers: { ...headers, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error("Gateway Mekari sandbox tidak dapat dihubungi dari lingkungan ini.");
  }
  await response.body?.cancel().catch(() => {});
  return response.status;
}

try {
  if (process.env.SIAP_V11_STAGE !== "1") throw new Error("Jalankan perintah ini dari konfigurasi staging.");
  const credentials = { id: process.env.MEKARI_CLIENT_ID, secret: process.env.MEKARI_CLIENT_SECRET };
  if (!credentials.id || !credentials.secret) throw new Error("Client ID dan Client Secret sandbox belum tersedia di environment.");

  const profile = await checkReadOnly("/v1/profile", credentials);
  console.log("Get Profile / Quota: HTTP", profile);
  const documentsPath = "/v1/documents?page=1&limit=1";
  const valid = await checkReadOnly(documentsPath, credentials);
  console.log("List Documents: HTTP", valid);
  if (valid !== 200) throw new Error("List Documents dengan HMAC valid diharapkan mengembalikan HTTP 200.");

  const invalid = await checkReadOnly(documentsPath, { ...credentials, secret: randomBytes(32) });
  console.log("List Documents (HMAC salah): HTTP", invalid);
  if (invalid !== 401) throw new Error("List Documents dengan HMAC salah diharapkan mengembalikan HTTP 401.");
  console.log("UAT-043 PASS");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
