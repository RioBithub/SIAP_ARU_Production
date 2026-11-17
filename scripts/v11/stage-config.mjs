import { readFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export function assertOutsideRepository(file) {
  const relative = path.relative(repositoryRoot, path.resolve(file));
  if (!relative || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))) {
    throw new Error("Simpan konfigurasi dan data staging di luar direktori repository.");
  }
}

export function validateStageConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      !Object.values(config).every(value => typeof value === "string")) {
    throw new Error("Format konfigurasi staging tidak valid.");
  }
  const port = Number(config.DB_PORT);
  if (config.SIAP_V11_STAGE !== "1" || config.DB_HOST !== "127.0.0.1" ||
      !/^siap_aru_sqa_v11_[a-z0-9]{4,24}$/.test(config.DB_NAME ?? "") ||
      !/^v11_stage_[a-z0-9]+$/.test(config.DB_USER ?? "") || !config.DB_PASSWORD ||
      !Number.isInteger(port) || port < 1 || port > 65535 ||
      (config.SESSION_SECRET?.length ?? 0) < 32) {
    throw new Error("Konfigurasi harus memakai schema dan user staging dengan koneksi loopback.");
  }
  for (const key of ["UPLOAD_DIR", "SIAP_V11_STAGE_PROFILE"]) {
    if (!path.isAbsolute(config[key] ?? "")) throw new Error("Path data staging harus absolut.");
    assertOutsideRepository(config[key]);
  }
  let url;
  try { url = new URL(config.SIAP_V11_STAGE_URL); } catch { throw new Error("URL staging tidak valid."); }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.port === "3200" ||
      url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("URL staging harus berupa http://127.0.0.1 pada port tersendiri.");
  }
  return config;
}

export async function readStageConfig(file) {
  if (!path.isAbsolute(file ?? "")) throw new Error("Masukkan path absolut file konfigurasi staging.");
  assertOutsideRepository(file);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) ||
      (process.getuid && stat.uid !== process.getuid())) {
    throw new Error("Konfigurasi staging harus berupa file privat milik user ini dengan izin 600.");
  }
  assertOutsideRepository(await realpath(file));
  let config;
  try { config = JSON.parse(await readFile(file, "utf8")); } catch {
    throw new Error("File konfigurasi staging belum berisi JSON yang valid.");
  }
  return validateStageConfig(config);
}

export function stageEnvironment(config) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(DB_|MEKARI_|SIAP_V11_|SESSION_SECRET$|UPLOAD_DIR$|PORT$|HOSTNAME$|NODE_ENV$)/.test(key)) delete env[key];
  }
  const allowed = /^(DB_|MEKARI_|SIAP_V11_|SESSION_SECRET$|UPLOAD_DIR$|NEXT_TELEMETRY_DISABLED$)/;
  for (const [key, value] of Object.entries(config)) if (allowed.test(key)) env[key] = value;
  return env;
}
