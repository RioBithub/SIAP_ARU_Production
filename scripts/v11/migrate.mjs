import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const env = process.env;
if (env.SIAP_V11_STAGE !== "1" || env.DB_HOST !== "127.0.0.1" ||
    !/^siap_aru_sqa_v11_[a-z0-9]{4,24}$/.test(env.DB_NAME ?? "") || !/^v11_stage_[a-z0-9]+$/.test(env.DB_USER ?? "")) {
  throw new Error("Migrasi ini dijalankan melalui konfigurasi staging.");
}
const profile = JSON.parse(await readFile(env.SIAP_V11_STAGE_PROFILE, "utf8"));
if (profile.schema !== env.DB_NAME || Number(profile.port) !== Number(env.DB_PORT)) throw new Error("Profil staging berbeda.");
const connection = await mysql.createConnection({
  host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, multipleStatements: true,
});
try {
  const [[marker]] = await connection.query("SELECT id FROM siap_v11_stage_marker");
  if (marker.id !== profile.marker) throw new Error("Marker staging berbeda.");
  await connection.query(await readFile("database/migrations/2026-11-18-v11-notifications.sql", "utf8"));
  await connection.query(await readFile("database/migrations/2026-11-18-v11-mekari-attachments.sql", "utf8"));
  console.log("Migrasi notifikasi dan Sandbox lampiran staging selesai.");
} finally {
  await connection.end();
}
