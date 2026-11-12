import { spawn } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { appPort, database, db, repoRoot, uploadDirectory } from "./config.mjs";

const build = process.argv[2] === "build";
const standalone = path.join(repoRoot, ".next", "standalone");
if (!build) {
  const connection = await mysql.createConnection({ ...db, database });
  try {
    const [[marker]] = await connection.query("SELECT state FROM siap_sqa_instance WHERE id=1");
    if (marker?.state !== "READY") throw new Error("Jalankan npm run sqa:db terlebih dahulu.");
  } finally {
    await connection.end();
  }
  await mkdir(uploadDirectory, { recursive: true });
  await cp(path.join(repoRoot, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
  await cp(path.join(repoRoot, "public"), path.join(standalone, "public"), { recursive: true });
}

const args = build
  ? [path.join(repoRoot, "node_modules", "next", "dist", "bin", "next"), "build"]
  : [path.join(standalone, "server.js")];
const child = spawn(process.execPath, args, {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    DB_HOST: db.host,
    DB_PORT: String(db.port),
    DB_NAME: database,
    DB_USER: db.user,
    DB_PASSWORD: db.password,
    DB_SSL: "0",
    PORT: String(appPort),
    HOSTNAME: "127.0.0.1",
    UPLOAD_DIR: uploadDirectory,
    SESSION_SECRET: randomBytes(32).toString("hex"),
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
