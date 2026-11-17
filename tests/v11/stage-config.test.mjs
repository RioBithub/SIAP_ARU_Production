import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readStageConfig, stageEnvironment, validateStageConfig } from "../../scripts/v11/stage-config.mjs";

test("Konfigurasi privat menjaga karakter secret dan menolak file terbuka atau schema operasional", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "siap-v11-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "stage.json");
  const config = {
    SIAP_V11_STAGE: "1", DB_HOST: "127.0.0.1", DB_PORT: "3306",
    DB_NAME: "siap_aru_sqa_v11_fixture", DB_USER: "v11_stage_fixture", DB_PASSWORD: "fixture-database",
    SESSION_SECRET: "fixture-session-".repeat(3), UPLOAD_DIR: path.join(directory, "uploads"),
    SIAP_V11_STAGE_PROFILE: path.join(directory, "profile.json"), SIAP_V11_STAGE_URL: "http://127.0.0.1:33317",
    MEKARI_CLIENT_SECRET: "fixture ' \" $ \\ special",
  };
  await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  assert.deepEqual(await readStageConfig(file), config);
  assert.throws(() => validateStageConfig({ ...config, DB_NAME: "aru_siap" }), /schema dan user staging/);
  await chmod(file, 0o644);
  await assert.rejects(readStageConfig(file), /izin 600/);
  await chmod(file, 0o600);
  await writeFile(file, '{"MEKARI_CLIENT_SECRET":"incomplete-private-value');
  await assert.rejects(readStageConfig(file), error => {
    assert(!error.message.includes("incomplete-private-value"));
    return /JSON yang valid/.test(error.message);
  });
});

test("Runner memakai environment staging yang dipilih dan mengabaikan konfigurasi database shell", t => {
  const previous = process.env.DB_NAME;
  const previousSecret = process.env.MEKARI_CLIENT_SECRET;
  process.env.DB_NAME = "aru_siap";
  process.env.MEKARI_CLIENT_SECRET = "unrelated-environment";
  t.after(() => {
    if (previous === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = previous;
    if (previousSecret === undefined) delete process.env.MEKARI_CLIENT_SECRET;
    else process.env.MEKARI_CLIENT_SECRET = previousSecret;
  });
  const env = stageEnvironment({ DB_NAME: "siap_aru_sqa_v11_fixture", NODE_OPTIONS: "--unrelated" });
  assert.equal(env.DB_NAME, "siap_aru_sqa_v11_fixture");
  assert.equal(env.MEKARI_CLIENT_SECRET, undefined);
  assert.notEqual(env.NODE_OPTIONS, "--unrelated");
});
