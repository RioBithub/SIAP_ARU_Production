import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import mysql from "mysql2/promise";
import { database, db, repoRoot, uploadDirectory } from "./config.mjs";
import { seedSql } from "./seed.mjs";

const { values } = parseArgs({ options: { reset: { type: "boolean" }, export: { type: "string" } } });

const files = [
  "siap_aru_mysql.sql",
  "migration_v1.6_to_v1.6.1_finance_daily_ytd_adjustments.sql",
  "migration_v1.6.1_to_v1.6.2_finance_flexible_periods.sql",
  "migration_v1.6.3_to_v1.6.4_ar_ap_adjustments.sql",
  "migration_v1.6.4_to_v1.6.5_persuratan_excel_ui.sql",
  "migration_v1.6.9_to_v1.7.0_bank_statement.sql",
  "migration_v1.7.0_to_v1.7.1_bri_pdf_import.sql",
  "migrations/2026-09-28-final-business-flow.sql",
  "migrations/2026-09-28-routing-target.sql",
  "migrations/2026-09-29-document-types-spk.sql",
  "migrations/2026-11-10-spk-invoice.sql",
  "migrations/2026-11-11-secretariat-workflow.sql",
];

const createDatabase = mysql.format(
  "CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
  [database],
);
const selectDatabase = mysql.format("USE ??;", [database]);
const marker = `
CREATE TABLE siap_sqa_instance (
  id TINYINT PRIMARY KEY,
  state VARCHAR(20) NOT NULL
) ENGINE=InnoDB;
INSERT INTO siap_sqa_instance VALUES (1,'BOOTSTRAP');
`;
const lockName = `siap-sqa-bootstrap:${database}`;
const connection = await mysql.createConnection({ ...db, multipleStatements: true });
let locked = false;

try {
  const [[lock]] = await connection.query("SELECT GET_LOCK(?, 5) AS acquired", [lockName]);
  locked = Number(lock.acquired) === 1;
  if (!locked) throw new Error("Setup SQA lain sedang berjalan.");

  await connection.query(createDatabase);
  const [tables] = await connection.query(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=?",
    [database],
  );
  if (tables.length) {
    if (!values.reset || !tables.some(({ name }) => name === "siap_sqa_instance")) {
      throw new Error("Pilih database SQA kosong. Untuk mengulang database SQA dari skrip ini, gunakan --reset.");
    }
    await connection.query("DROP DATABASE ??", [database]);
    await connection.query(createDatabase);
    await rm(uploadDirectory, { recursive: true, force: true });
  }

  await connection.query(selectDatabase);
  await connection.query(marker);
  const applied = [];
  for (const name of files) {
    const original = await readFile(path.join(repoRoot, "database", name), "utf8");
    // Migrasi historis merujuk aru_siap secara eksplisit. Alihkan nama schema
    // hanya di lingkungan SQA agar urutan migrasi tetap bisa diuji.
    const sql = original.replace(/\baru_siap\b/g, database);
    try {
      await connection.query(sql);
    } catch (error) {
      throw new Error(`${name}: ${error.message}`, { cause: error });
    }
    applied.push(`-- ${name}\n${sql.trim()}`);
    console.log(`Migrasi SQA: ${name}`);
  }

  const seed = await seedSql();
  await connection.beginTransaction();
  try {
    await connection.query(seed);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
  if (values.export) {
    const exportPath = path.resolve(values.export);
    await mkdir(path.dirname(exportPath), { recursive: true });
    await writeFile(exportPath, [
      "-- SIAP ARU SQA. Jalankan pada schema demo kosong yang terpisah.",
      "-- Memuat akun, surat, dan transaksi fiktif. Tidak memuat data produksi.",
      createDatabase, selectDatabase, marker, ...applied,
      "START TRANSACTION;", seed, "COMMIT;", "",
    ].join("\n\n"), { mode: 0o600 });
    console.log(`SQL SQA: ${exportPath}`);
  }
  console.log(`Database ${database} siap dengan 9 akun dan data fiktif.`);
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
  await connection.end();
}
