import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, UPLOAD_DIR, SIAP_V11_STAGE_PROFILE } = process.env;
if (process.env.SIAP_V11_STAGE !== "1" || DB_HOST !== "127.0.0.1" ||
    !/^siap_aru_sqa_v11_[a-z0-9]{4,24}$/.test(DB_NAME ?? "") ||
    !/^v11_stage_[a-z0-9]+$/.test(DB_USER ?? "") || !DB_PASSWORD || !DB_PORT ||
    !Number.isInteger(Number(DB_PORT)) || Number(DB_PORT) < 1 || Number(DB_PORT) > 65535 ||
    !UPLOAD_DIR || !path.isAbsolute(UPLOAD_DIR) ||
    !SIAP_V11_STAGE_PROFILE || !path.isAbsolute(SIAP_V11_STAGE_PROFILE)) {
  throw new Error("Siapkan skema SQA lokal kosong, user staging, port database, direktori upload, dan path profil privat.");
}
const password = process.env.SIAP_V11_STAGE_PASSWORD;
if (!password || password.length < 16) throw new Error("Set password fixture tersendiri melalui environment privat.");

const migrations = [
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
const cn = await mysql.createConnection({
  host: DB_HOST, port: Number(DB_PORT), user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
  multipleStatements: true,
});
try {
  const [[{ active_db: actual, db_port: port, version }]] = await cn.query(
    "SELECT DATABASE() active_db, @@port db_port, VERSION() version",
  );
  if (actual !== DB_NAME || Number(port) !== Number(DB_PORT)) throw new Error("Koneksi staging tidak cocok.");
  const [empty] = await cn.query("SHOW TABLES");
  if (empty.length) throw new Error("Bootstrap memerlukan skema kosong. Gunakan skema SQA baru tanpa menghapus data.");
  for (const name of migrations) {
    const sql = (await readFile("database/" + name, "utf8")).replace(/\baru_siap\b/g, DB_NAME);
    await cn.query(sql);
  }

  const [[{ total }]] = await cn.query("SELECT COUNT(*) total FROM siap_users");
  if (total) throw new Error("Skema memuat akun bawaan. Gunakan skema kosong yang terisolasi.");
  const hash = await bcrypt.hash(password, 10);
  const accounts = {};
  const roles = [
    ["staff", "STAFF", "Operasional", "Staff Operasional"],
    ["sdm", "STAFF", "SDM", "Staff SDM"],
    ["staffkeu", "STAFF", "Keuangan", "Staff Keuangan"],
    ["it", "STAFF", "IT & Sistem", "Staff IT"],
    ["secretariat", "SECRETARIAT", "Sekretariat", "Sekretariat"],
    ["ops", "MANAGER", "Operasional", "Manager Operasional"],
    ["ksu", "MANAGER", "Keuangan, SDM & Umum", "Manager Keuangan, SDM & Umum"],
    ["gedung", "MANAGER", "Gedung", "Manager Gedung Historis"],
    ["dirops", "DIRECTOR_OPS", null, "Dirops"],
    ["dirut", "PRESIDENT_DIRECTOR", null, "Dirut"],
    ["finance", "FINANCE", "Keuangan", "Finance"],
    ["root", "ROOT_ADMIN", "IT & Sistem", "Root"],
  ];
  for (const [key, role, unit, name] of roles) {
    const id = randomUUID();
    const email = key + "@simulasi.siap.invalid";
    await cn.execute("INSERT INTO siap_users (id,name,email,password_hash,role,unit_name) VALUES (?,?,?,?,?,?)",
      [id, "SIMULASI " + name, email, hash, role, unit]);
    accounts[key] = { id, email, role, unit };
  }
  let [[format]] = await cn.query(
    "SELECT id,document_type,code FROM siap_number_formats WHERE is_active=1 AND document_type NOT IN ('INVOICE_KELUAR','SURAT_PERINTAH_KERJA') ORDER BY IF(document_type='SURAT_UMUM',0,1),code LIMIT 1",
  );
  if (!format) {
    format = { id: randomUUID(), code: "UAT-V11", document_type: "SURAT_UMUM" };
    await cn.execute(
      `INSERT INTO siap_number_formats (id,code,name,document_type,pattern,sequence_start,is_active)
       VALUES (?,?,'SIMULASI Surat Keluar Umum',?,'{seq}/UAT-V11/{month}/{year}',1,1)`,
      [format.id, format.code, format.document_type],
    );
  }
  const legacy = randomUUID();
  await cn.execute(
    "INSERT INTO siap_letters (id,direction,document_type,external_number,subject,letter_date,received_date,status,`current_role`,current_owner_user_id,routing_target_user_id,created_by,updated_by,is_public) " +
    "VALUES (?,'INCOMING','SURAT_MASUK','SIMULASI-HISTORI','SIMULASI arsip Manager Gedung',CURDATE(),CURDATE(),'MANAGER_REVIEW','MANAGER',?,?,?, ?,0)",
    [legacy, accounts.gedung.id, accounts.gedung.id, accounts.staff.id, accounts.staff.id],
  );
  const legacyTables = ["siap_users", "siap_letters", "siap_number_ledger", "siap_payables", "siap_dispositions", "siap_attachments"];
  async function snapshotRows() {
    const snapshot = {};
    for (const table of legacyTables) {
      const [rows] = await cn.query("SELECT * FROM ?? ORDER BY id", [table]);
      snapshot[table] = rows;
    }
    return JSON.stringify(snapshot);
  }
  const before = await snapshotRows();
  const workflowMigration = await readFile("database/migrations/2026-11-17-v11-workflow.sql", "utf8");
  await cn.query(workflowMigration);
  await cn.query(workflowMigration);
  if (before !== await snapshotRows()) throw new Error("Migrasi V11 mengubah baris lama.");
  await cn.execute("INSERT INTO siap_v11_managers (scope,user_id) VALUES ('OPS',?),('KSU',?)",
    [accounts.ops.id, accounts.ksu.id]);
  await cn.execute("CREATE TABLE siap_v11_stage_marker (id CHAR(36) PRIMARY KEY)");
  const marker = randomUUID();
  await cn.execute("INSERT INTO siap_v11_stage_marker VALUES (?)", [marker]);
  await mkdir(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  await writeFile(SIAP_V11_STAGE_PROFILE, JSON.stringify({
    marker, schema: DB_NAME, port, version, accounts, format, legacy, migrationReapplied: true,
    appUrl: process.env.SIAP_V11_STAGE_URL,
  }, null, 2), { mode: 0o600, flag: "wx" });
  console.log(`Staging ${DB_NAME} / ${version} siap. ${migrations.length} SQL baseline, migrasi V11 2 kali, baris lama identik.`);
} finally {
  await cn.end();
}
