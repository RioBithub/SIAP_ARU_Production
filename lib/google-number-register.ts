import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { normalizeRegisterNumber, parseRegisterDate, parseRegisterSlot, type SheetConfig } from "@/lib/aru-register";
import type { RegisterNumber } from "@/lib/correspondence-number-source";

const tokenUrl = "https://oauth2.googleapis.com/token";
const sheetsOrigin = "https://sheets.googleapis.com";
const requestOptions = () => ({ cache: "no-store" as const, redirect: "error" as const, signal: AbortSignal.timeout(6000) });

export function normalizeSheetUrl(input: unknown) {
  if (typeof input !== "string" || input.length > 2048) throw new Error("Masukkan tautan Google Spreadsheet yang valid.");
  let parsed: URL;
  try { parsed = new URL(input.trim()); }
  catch { throw new Error("Masukkan tautan Google Spreadsheet yang valid."); }
  const match = parsed?.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,128})(?:\/|$)/);
  const id = match?.[1] ?? (parsed.pathname === "/spreadsheets/copy" ? parsed.searchParams.get("copySourceId") : null);
  if (parsed?.origin !== "https://docs.google.com" || parsed.username || parsed.password ||
      !id || !/^[A-Za-z0-9_-]{20,128}$/.test(id)) throw new Error("Masukkan tautan Google Spreadsheet yang valid.");
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

function tokenAssertion(email: string, key: string) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claims = encode({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: tokenUrl, iat: now, exp: now + 3600 });
  const payload = encode({ alg: "RS256", typ: "JWT" }) + "." + claims;
  return payload + "." + createSign("RSA-SHA256").update(payload).sign(key, "base64url");
}

let token: { value: string; expiresAt: number; path: string } | undefined;
let pendingToken: Promise<string> | undefined;

async function exchangeToken(path: string) {
  try {
    const file = JSON.parse(await readFile(path, "utf8"));
    if (file.type !== "service_account" || typeof file.client_email !== "string" || typeof file.private_key !== "string") {
      throw new Error("INVALID_SERVICE_ACCOUNT");
    }
    const response = await fetch(tokenUrl, { ...requestOptions(), method: "POST", body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: tokenAssertion(file.client_email, file.private_key),
    }) });
    if (!response.ok) throw new Error("GOOGLE_TOKEN_REQUEST_FAILED");
    const payload = await response.json();
    if (typeof payload.access_token !== "string") throw new Error("GOOGLE_TOKEN_INVALID");
    token = { value: payload.access_token, expiresAt: Date.now() + 1000 * Number(payload.expires_in || 0), path };
    return token.value;
  } catch {
    throw new Error("Koneksi Google belum siap. Periksa konfigurasi service account SIAP di server.");
  }
}

async function accessToken() {
  const path = process.env.ARU_SHEETS_SERVICE_ACCOUNT_FILE;
  if (!path) throw new Error("Atur service account Google Sheets di server sebelum menggunakan sumber langsung.");
  if (token?.path === path && token.expiresAt - Date.now() > 60_000) return token.value;
  pendingToken ??= exchangeToken(path).finally(() => { pendingToken = undefined; });
  return pendingToken;
}

export async function readNumberRegister(sheetUrl: string, sheets: SheetConfig[]) {
  const spreadsheetId = normalizeSheetUrl(sheetUrl).split("/")[5];
  const api = new URL(`/v4/spreadsheets/${spreadsheetId}/values:batchGet`, sheetsOrigin);
  api.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  for (const { sheet } of sheets) api.searchParams.append("ranges", `'${sheet.replaceAll("'", "''")}'!B4:C`);
  const access = await accessToken();
  let result: { valueRanges?: { values?: unknown[][] }[] };
  try {
    const response = await fetch(api, { ...requestOptions(), headers: { Authorization: "Bearer " + access } });
    if (!response.ok) {
      if (response.status === 401) token = undefined;
      if (response.status === 400) throw new RegisterError("Nama tab pada Sheets harus mengikuti Form Persuratan ARU.");
      if (response.status === 403 || response.status === 404) {
        throw new RegisterError("Spreadsheet belum bisa dibaca. Periksa tautan, Google Sheets API, dan akses Viewer service account.");
      }
      throw new Error("REGISTER_UNAVAILABLE");
    }
    result = await response.json();
  } catch (cause) {
    if (cause instanceof RegisterError) throw cause;
    throw new Error("Google Sheets belum dapat dibaca. Coba lagi sebelum mengambil nomor.");
  }
  if (result.valueRanges?.length !== sheets.length) throw new Error("Data register Google Sheets tidak lengkap.");

  return result.valueRanges.map(({ values }, index) => {
    const config = sheets[index];
    const heading = values?.[0] ?? [];
    if (!/^(no\.?|nomor)\s+surat$/i.test(String(heading[0] ?? "").trim()) ||
        !/^tanggal\s+surat$/i.test(String(heading[1] ?? "").trim())) {
      throw new Error(`Tab "${config.sheet}" perlu kolom No. Surat dan Tanggal Surat di B4:C4.`);
    }
    const rows: RegisterNumber[] = [];
    let incompleteDates = 0;
    for (const [number, date] of values!.slice(1)) {
      const slot = parseRegisterSlot(normalizeRegisterNumber(number));
      if (!slot) continue;
      const parsed = parseRegisterDate(date).date;
      if (!parsed) incompleteDates++;
      rows.push({ seq_base: slot.base, variant: slot.variant, letter_date: parsed });
    }
    return { config, rows, incompleteDates };
  });
}

class RegisterError extends Error {}
