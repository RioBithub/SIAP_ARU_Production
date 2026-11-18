import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { access, lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import mysql from "mysql2/promise";
import {
  assertOutsideRepository, readStageConfig, repositoryRoot, stageEnvironment, validateStageConfig,
} from "./stage-config.mjs";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("Jalankan setup di terminal interaktif agar rahasia bisa dimasukkan secara tersembunyi.");
  process.exit(1);
}

let hidden = false;
const output = new Writable({
  write(chunk, _encoding, done) { if (!hidden) process.stdout.write(chunk); done(); },
});
const prompt = createInterface({ input: process.stdin, output, terminal: true });
async function ask(label, { secret = false, fallback = "" } = {}) {
  process.stdout.write(label + (fallback ? " [" + fallback + "]" : "") + ": ");
  hidden = secret;
  try { return (await prompt.question("")) || fallback; } finally {
    hidden = false;
    if (secret) process.stdout.write("\n");
  }
}

async function writeConfig(file, config, replace = false) {
  validateStageConfig(config);
  const text = JSON.stringify(config, null, 2) + "\n";
  if (!replace) return writeFile(file, text, { mode: 0o600, flag: "wx" });
  const temporary = file + "." + randomBytes(6).toString("hex") + ".tmp";
  await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
  await rename(temporary, file);
}

async function checkMarker(config) {
  const profile = JSON.parse(await readFile(config.SIAP_V11_STAGE_PROFILE, "utf8"));
  if (profile.schema !== config.DB_NAME || Number(profile.port) !== Number(config.DB_PORT)) {
    throw new Error("Profil dan konfigurasi database staging berbeda.");
  }
  const connection = await mysql.createConnection({
    host: config.DB_HOST, port: Number(config.DB_PORT), database: config.DB_NAME,
    user: config.DB_USER, password: config.DB_PASSWORD, connectTimeout: 8000,
  });
  try {
    const [[marker]] = await connection.query("SELECT id FROM siap_v11_stage_marker");
    if (marker?.id !== profile.marker) throw new Error("Marker database staging tidak cocok.");
  } finally {
    await connection.end();
  }
}

async function availablePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3200) {
    throw new Error("Pilih port aplikasi staging antara 1024 dan 65535 yang berbeda dari 3200.");
  }
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", () => reject(new Error("Port staging sudah dipakai. Jalankan setup lagi dengan port lain.")));
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise(resolve => server.close(resolve));
  return String(port);
}

async function bootstrap(config) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/v11/bootstrap.mjs"], {
      cwd: repositoryRoot, env: stageEnvironment(config), stdio: "inherit",
    });
    child.once("error", () => reject(new Error("Bootstrap staging tidak dapat dimulai.")));
    child.once("exit", code => code === 0 ? resolve() : reject(new Error("Bootstrap staging belum selesai. Periksa pesan di terminal.")));
  });
}

async function createStage(directory) {
  console.log("Membuat schema dan akun simulasi SIAP ARU yang baru.");
  let defaultSocket = "";
  try { await access("/run/mysqld/mysqld.sock"); defaultSocket = "/run/mysqld/mysqld.sock"; } catch {}
  const socketChoice = (await ask("Socket MySQL, ketik tcp untuk TCP", { fallback: defaultSocket })).trim();
  const socketPath = socketChoice === "tcp" ? "" : socketChoice;
  const dbPort = socketPath ? undefined : Number(await ask("Port MySQL lokal", { fallback: "3306" }));
  const user = (await ask("User admin MySQL untuk membuat schema", { fallback: "root" })).trim();
  const password = await ask("Password admin MySQL, boleh kosong untuk socket auth", { secret: true });
  const appPort = await availablePort(await ask("Port web staging", { fallback: "33317" }));
  const demoPassword = await ask("Password akun simulasi, minimal 16 karakter", { secret: true });
  if (demoPassword.length < 16) throw new Error("Password akun simulasi harus minimal 16 karakter.");
  const suffix = randomBytes(6).toString("hex");
  const work = path.join(directory, "runs", suffix);
  await mkdir(work, { recursive: true, mode: 0o700 });
  console.log("Direktori data simulasi " + work);
  const config = {
    DB_HOST: "127.0.0.1", DB_PORT: "", DB_NAME: "siap_aru_sqa_v11_" + suffix,
    DB_USER: "v11_stage_" + suffix, DB_PASSWORD: randomBytes(24).toString("hex"), DB_SSL: "0",
    SIAP_V11_STAGE: "1", SIAP_V11_ENABLED: "1", SIAP_V11_STAGE_PASSWORD: demoPassword,
    SIAP_V11_STAGE_PROFILE: path.join(work, "profile.json"), UPLOAD_DIR: path.join(work, "uploads"),
    SIAP_V11_STAGE_URL: "http://127.0.0.1:" + appPort,
    SESSION_SECRET: randomBytes(40).toString("hex"), SIAP_V11_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
    SIAP_V11_MEKARI_MODE: "mock", NEXT_TELEMETRY_DISABLED: "1",
  };
  const admin = await mysql.createConnection({
    ...(socketPath ? { socketPath } : { host: "127.0.0.1", port: dbPort }),
    user, password, connectTimeout: 8000,
  });
  try {
    const [[{ port }]] = await admin.query("SELECT @@port AS port");
    config.DB_PORT = String(port);
    validateStageConfig(config);
    await admin.query("CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci", [config.DB_NAME]);
    await admin.query("CREATE USER ?@'127.0.0.1' IDENTIFIED BY ?", [config.DB_USER, config.DB_PASSWORD]);
    const [partialRevokes] = await admin.query("SHOW VARIABLES LIKE 'partial_revokes'");
    const schemaGrant = partialRevokes[0]?.Value === "ON" ? config.DB_NAME : config.DB_NAME.replace(/_/g, "\\_");
    // Escape wildcard underscores when the server interprets database grants as patterns.
    await admin.query("GRANT ALL PRIVILEGES ON ??.* TO ?@'127.0.0.1'", [
      schemaGrant, config.DB_USER,
    ]);
  } finally {
    await admin.end();
  }
  await bootstrap(config);
  return config;
}

try {
  const file = process.argv[2];
  if (!path.isAbsolute(file ?? "")) throw new Error("Gunakan path absolut file konfigurasi, misalnya /etc/siap-aru-v11/stage.json.");
  assertOutsideRepository(file);
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  assertOutsideRepository(await realpath(directory));
  let exists = false;
  try { await lstat(file); exists = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
  const config = exists ? await readStageConfig(file) : await createStage(directory);
  await checkMarker(config);
  if (!exists) await writeConfig(file, config);

  console.log("Masukkan kredensial HMAC untuk Mekari Sign Sandbox.");
  const clientId = (await ask("Client ID HMAC sandbox", { secret: true })).trim();
  const clientSecret = await ask("Client Secret HMAC sandbox", { secret: true });
  if (!/^[\w.\-]{1,150}$/.test(clientId) || !clientSecret) throw new Error("Client ID dan Client Secret sandbox wajib diisi.");
  await writeConfig(file, {
    ...config, MEKARI_CLIENT_ID: clientId, MEKARI_CLIENT_SECRET: clientSecret,
    SIAP_V11_MEKARI_MODE: "sandbox", SIAP_V11_MEKARI_ALLOW_SEND: "1",
  }, true);
  console.log("Konfigurasi sandbox tersimpan dengan izin 600 di " + file);
  console.log("Web staging " + config.SIAP_V11_STAGE_URL);
  console.log("Login Sekretariat dengan secretariat@simulasi.siap.invalid dan password simulasi yang dipilih.");
  console.log("Jalankan perintah smoke, build dan start mengikuti docs/v11/VPS-SANDBOX.md.");
} catch (error) {
  if (error.code === "ER_ACCESS_DENIED_ERROR") {
    console.error("Login admin MySQL ditolak. Periksa user/password atau pilih socket yang sesuai, lalu jalankan setup kembali.");
  } else if (error.code) {
    console.error("Setup staging belum selesai (" + error.code + "). Data yang sudah dibuat tetap tersimpan.");
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
} finally {
  prompt.close();
}
