import { spawn } from "node:child_process";
import { readStageConfig, repositoryRoot, stageEnvironment } from "./stage-config.mjs";

const commands = {
  bootstrap: ["scripts/v11/bootstrap.mjs"],
  typecheck: ["node_modules/typescript/bin/tsc", "--noEmit"],
  build: ["node_modules/next/dist/bin/next", "build"],
  start: ["scripts/v11/start.mjs"],
  smoke: ["tests/v11/mekari-sandbox-smoke.mjs"],
};

try {
  const [, , file, command] = process.argv;
  if (!commands[command]) throw new Error("Pilih perintah bootstrap, typecheck, build, start, atau smoke.");
  const config = await readStageConfig(file);
  const app = spawn(process.execPath, commands[command], {
    cwd: repositoryRoot, env: stageEnvironment(config), stdio: "inherit",
  });
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
