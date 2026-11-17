import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const env = process.env;
const profile = JSON.parse(await readFile(env.SIAP_V11_STAGE_PROFILE, "utf8"));
const schema = env.DB_NAME;
const restore = env.SIAP_V11_RESTORE_SCHEMA;
assert(env.SIAP_V11_STAGE === "1" && env.DB_HOST === "127.0.0.1");
assert(/^siap_aru_sqa_v11_[a-z0-9]{4,24}$/.test(schema) && restore === schema + "_restore");
assert.equal(profile.schema, schema);
const config = {
  host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD,
  dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
};
const source = await mysql.createConnection({ ...config, database: schema });
const target = await mysql.createConnection({ ...config, database: restore, multipleStatements: true });
try {
  const [[marker]] = await source.query("SELECT id FROM siap_v11_stage_marker");
  assert.equal(marker.id, profile.marker);
  const [empty] = await target.query("SHOW TABLES");
  assert.equal(empty.length, 0, "Restore uji hanya ke schema kosong.");
  const [tables] = await source.query("SHOW FULL TABLES WHERE Table_type='BASE TABLE'");
  const names = tables.map(table => Object.values(table)[0]);
  const backup = ["SET FOREIGN_KEY_CHECKS=0;"];
  const snapshot = new Map();
  await source.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
  for (const table of names) {
    const [[definition]] = await source.query("SHOW CREATE TABLE ??", [table]);
    backup.push(definition["Create Table"] + ";");
    const [rows] = await source.query("SELECT * FROM ??", [table]);
    snapshot.set(table, rows.map(row => JSON.stringify(row)).sort());
    if (rows.length) {
      const keys = Object.keys(rows[0]);
      backup.push(mysql.format("INSERT INTO ?? (??) VALUES ?;", [table, keys, rows.map(row => keys.map(key => row[key]))]));
    }
  }
  await source.commit();
  backup.push("SET FOREIGN_KEY_CHECKS=1;");
  const file = env.SIAP_V11_BACKUP_FILE;
  assert(file && file.startsWith("/"));
  await writeFile(file, backup.join("\n"), { flag: "wx", mode: 0o600 });
  await target.query(await readFile(file, "utf8"));
  for (const table of names) {
    const [rows] = await target.query("SELECT * FROM ??", [table]);
    assert.deepEqual(rows.map(row => JSON.stringify(row)).sort(), snapshot.get(table), table);
  }
  console.log("Backup dan restore lokal terpisah terverifikasi untuk " + names.length + " tabel.");
  await writeFile(env.SIAP_V11_STAGE_PROFILE,
    JSON.stringify({ ...profile, restoreVerified: true, restoredTables: names.length }, null, 2), { mode: 0o600 });
} finally {
  await target.end();
  await source.end();
}
