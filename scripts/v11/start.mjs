import { spawn } from "node:child_process";
import { cp, readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const env = process.env;
const profile = JSON.parse(await readFile(env.SIAP_V11_STAGE_PROFILE, "utf8"));
const url = new URL(profile.appUrl);
if (env.SIAP_V11_STAGE !== "1" || env.DB_HOST !== "127.0.0.1" || env.DB_NAME !== profile.schema ||
    !/^siap_aru_sqa_v11_[a-z0-9]{4,24}$/.test(profile.schema) ||
    !/^v11_stage_[a-z0-9]+$/.test(env.DB_USER ?? "") || !path.isAbsolute(env.UPLOAD_DIR ?? "") ||
    Number(env.DB_PORT) !== Number(profile.port) || url.hostname !== "127.0.0.1" ||
    url.protocol !== "http:" || !url.port || Number(url.port) === 3200 ||
    !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error("Konfigurasi staging tidak aman atau berbeda dari profil bootstrap.");

const cn = await mysql.createConnection({
  host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD,
});
try {
  const [[identity]] = await cn.query("SELECT id FROM siap_v11_stage_marker");
  if (identity.id !== profile.marker) throw new Error("Marker database staging tidak cocok.");
} finally {
  await cn.end();
}

const standalone = path.resolve(".next/standalone");
await cp("public", path.join(standalone, "public"), { recursive: true });
await cp(".next/static", path.join(standalone, ".next/static"), { recursive: true });
const app = spawn(process.execPath, ["server.js"], {
  cwd: standalone, env: { ...env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: url.port }, stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => app.kill(signal));
app.on("exit", code => { process.exitCode = code ?? 1; });
