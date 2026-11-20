import { spawn } from "node:child_process";
import { readStageConfig, repositoryRoot, stageEnvironment } from "./stage-config.mjs";

const commands = {
  bootstrap: ["scripts/v11/bootstrap.mjs"],
  migrate: ["scripts/v11/migrate.mjs"],
  demo: ["scripts/v11/demo-cases.mjs"],
  "demo-dev": ["scripts/v11/demo-dev.mjs"],
  typecheck: ["node_modules/typescript/bin/tsc", "--noEmit"],
  build: ["node_modules/next/dist/bin/next", "build"],
  start: ["scripts/v11/start.mjs"],
  smoke: ["tests/v11/mekari-sandbox-smoke.mjs"],
};

try {
  const [, , file, command] = process.argv;
  if (!Object.hasOwn(commands, command)) throw new Error("Pilih perintah bootstrap, migrate, demo, demo-dev, typecheck, build, start, atau smoke.");
  const config = await readStageConfig(file);
  if (config.SIAP_DEV_STAGING === "1" && ["smoke", "demo"].includes(command)) {
    throw new Error("Untuk staging dev gunakan demo-dev. Integrasi Mekari dinonaktifkan.");
  }
  const env = stageEnvironment(config);
  if (config.SIAP_DEV_STAGING === "1" && !["bootstrap", "demo-dev"].includes(command)) delete env.SIAP_V11_STAGE_PASSWORD;
  const app = spawn(process.execPath, commands[command], { cwd: repositoryRoot, env, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => app.kill(signal));
  app.once("error", () => {
    console.error("Perintah staging tidak dapat dijalankan.");
    process.exitCode = 1;
  });
  app.once("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
} catch (error) {
  console.error(error.code ? "Konfigurasi staging gagal dibaca (" + error.code + ")." : error.message);
  process.exitCode = 1;
}
