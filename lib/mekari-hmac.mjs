import { createHmac } from "node:crypto";

export const MEKARI_SANDBOX_BASE = "https://sandbox-api.mekari.com/v2/esign-hmac";

export function hmacHeaders(method, url, config, date = new Date()) {
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
