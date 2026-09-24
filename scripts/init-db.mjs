import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import crypto from "crypto";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile(path.resolve(".env.local"));
loadEnvFile(path.resolve(".env"));

const host = process.env.DB_HOST || "127.0.0.1";
const port = Number(process.env.DB_PORT || 3306);
const database = process.env.DB_NAME || "aru_siap";
const user = process.env.DB_USER || "root";
const password = process.env.DB_PASSWORD || "";

const bootstrap = await mysql.createConnection({ host, port, user, password, multipleStatements: true });
await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, "")}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await bootstrap.end();

const conn = await mysql.createConnection({ host, port, user, password, database, multipleStatements: true });
const schema = fs.readFileSync(path.resolve("database/siap_aru_mysql.sql"), "utf8");
await conn.query(schema);

// v1.6.1 Finance: YTD modes, daily adjustment ledger, publish/period control.
const financeV161Migration = fs.readFileSync(path.resolve("database/migration_v1.6_to_v1.6.1_finance_daily_ytd_adjustments.sql"), "utf8");
await conn.query(financeV161Migration);

// Numbering v1.4 migration: per-format starting number and per-format rendered uniqueness.
const [seqStartColumn] = await conn.query(
  `SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='siap_number_formats' AND COLUMN_NAME='sequence_start'`,
  [database]
);
if (Number(seqStartColumn[0]?.c || 0) === 0) {
  await conn.query(`ALTER TABLE siap_number_formats ADD COLUMN sequence_start INT NOT NULL DEFAULT 1 AFTER description`);
}
const [oldRenderedIndex] = await conn.query(
  `SELECT COUNT(*) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='siap_number_ledger' AND INDEX_NAME='uq_siap_ledger_rendered'`,
  [database]
);
if (Number(oldRenderedIndex[0]?.c || 0) > 0) {
  await conn.query(`ALTER TABLE siap_number_ledger DROP INDEX uq_siap_ledger_rendered`);
}
const [newRenderedIndex] = await conn.query(
  `SELECT COUNT(*) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='siap_number_ledger' AND INDEX_NAME='uq_siap_ledger_format_rendered'`,
  [database]
);
if (Number(newRenderedIndex[0]?.c || 0) === 0) {
  await conn.query(`ALTER TABLE siap_number_ledger ADD UNIQUE KEY uq_siap_ledger_format_rendered (format_id, rendered_number)`);
}

// v1.6: process attachments linked to approval/return/issue actions.
const [actionAttachmentColumn] = await conn.query(
  `SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='siap_attachments' AND COLUMN_NAME='letter_action_id'`,
  [database]
);
if (Number(actionAttachmentColumn[0]?.c || 0) === 0) {
  await conn.query(`ALTER TABLE siap_attachments ADD COLUMN letter_action_id CHAR(36) NULL AFTER disposition_id`);
}
const [actionAttachmentIndex] = await conn.query(
  `SELECT COUNT(*) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='siap_attachments' AND INDEX_NAME='idx_siap_attach_action'`,
  [database]
);
if (Number(actionAttachmentIndex[0]?.c || 0) === 0) {
  await conn.query(`ALTER TABLE siap_attachments ADD INDEX idx_siap_attach_action (letter_action_id)`);
}
const [actionAttachmentFk] = await conn.query(
  `SELECT COUNT(*) AS c FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND CONSTRAINT_NAME='fk_siap_attach_action'`,
  [database]
);
if (Number(actionAttachmentFk[0]?.c || 0) === 0) {
  await conn.query(`ALTER TABLE siap_attachments ADD CONSTRAINT fk_siap_attach_action FOREIGN KEY (letter_action_id) REFERENCES siap_letter_actions(id) ON DELETE SET NULL`);
}

// Safe migration for installations created before Finance dual-mode.
const [ledgerColumn] = await conn.query(
  `SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='siap_finance_attachments' AND COLUMN_NAME='ledger_summary_id'`,
  [database]
);
if (Number(ledgerColumn[0]?.c || 0) === 0) {
  await conn.query(`ALTER TABLE siap_finance_attachments ADD COLUMN ledger_summary_id CHAR(36) NULL AFTER payable_id`);
}
const [ledgerIndex] = await conn.query(
  `SELECT COUNT(*) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='siap_finance_attachments' AND INDEX_NAME='idx_siap_fin_attach_ledger_summary'`,
  [database]
);
if (Number(ledgerIndex[0]?.c || 0) === 0) {
  await conn.query(`ALTER TABLE siap_finance_attachments ADD INDEX idx_siap_fin_attach_ledger_summary (ledger_summary_id, created_at)`);
}
const [ledgerFk] = await conn.query(
  `SELECT COUNT(*) AS c FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND CONSTRAINT_NAME='fk_siap_fin_attach_ledger_summary'`,
  [database]
);
if (Number(ledgerFk[0]?.c || 0) === 0) {
  await conn.query(`ALTER TABLE siap_finance_attachments ADD CONSTRAINT fk_siap_fin_attach_ledger_summary FOREIGN KEY (ledger_summary_id) REFERENCES siap_finance_position_summaries(id) ON DELETE CASCADE`);
}

async function ensureUser(name, email, role, unit, rawPassword) {
  const [rows] = await conn.query("SELECT id FROM siap_users WHERE email=? LIMIT 1", [email]);
  if (rows.length) return rows[0].id;
  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(rawPassword, 12);
  await conn.execute(
    `INSERT INTO siap_users (id,name,email,password_hash,role,unit_name,is_active)
     VALUES (?,?,?,?,?,?,1)`,
    [id, name, email, passwordHash, role, unit]
  );
  return id;
}

const rootName = process.env.INIT_ROOT_NAME || "Root Administrator";
const rootEmail = (process.env.INIT_ROOT_EMAIL || "root@aruraharja.co.id").toLowerCase();
const rootPassword = process.env.INIT_ROOT_PASSWORD || "AdminARU!2026";
const rootId = await ensureUser(rootName, rootEmail, "ROOT_ADMIN", "IT / System", rootPassword);

const operationalPassword = "SiapARU!2026";
await ensureUser("Staff Administrasi", "staff@aruraharja.co.id", "STAFF", "SDM & Umum", operationalPassword);
await ensureUser("Manager Keu, SDM & Umum", "manager@aruraharja.co.id", "MANAGER", "Keu, SDM & Umum", operationalPassword);
await ensureUser("Manager Operasional", "manager.ops@aruraharja.co.id", "MANAGER", "Operasional", operationalPassword);
await ensureUser("Manager Gedung", "manager.gedung@aruraharja.co.id", "MANAGER", "Gedung", operationalPassword);
await ensureUser("Direktur Operasional", "dirops@aruraharja.co.id", "DIRECTOR_OPS", "Direksi", operationalPassword);
await ensureUser("Direktur Utama", "dirut@aruraharja.co.id", "PRESIDENT_DIRECTOR", "Direksi", operationalPassword);
await ensureUser("Finance User", "finance@aruraharja.co.id", "FINANCE", "Finance", operationalPassword);

await conn.execute(
  `INSERT INTO siap_finance_source_modes(ledger_type,data_mode,updated_by) VALUES('RECEIVABLE','SUMMARY',?)
   ON DUPLICATE KEY UPDATE ledger_type=ledger_type`, [rootId]
);
await conn.execute(
  `INSERT INTO siap_finance_source_modes(ledger_type,data_mode,updated_by) VALUES('PAYABLE','SUMMARY',?)
   ON DUPLICATE KEY UPDATE ledger_type=ledger_type`, [rootId]
);

const formats = [
  ["PKS", "Perjanjian Kerja Sama", "PERJANJIAN_KERJA_SAMA", "{seq}/PKS/ARU/{roman_month}/{year}", "Format awal PKS; editable oleh Root Admin."],
  ["DIR", "Surat Keluar Direksi", "SURAT_DIREKSI", "{seq}/ARU-DIR/{roman_month}/{year}", "Format awal surat Direksi."],
  ["OPS", "Surat Bagian Operasional", "SURAT_OPERASIONAL", "{seq}/ARU-OPS/{roman_month}/{year}", "Format awal Operasional."],
  ["PO", "Purchase Order", "PURCHASE_ORDER", "{seq}/PO/ARU/{roman_month}/{year}", "Format awal nomor PO."],
  ["UMUM", "Surat Keluar Umum", "SURAT_UMUM", "{seq}/ARU-UM/{roman_month}/{year}", "Format awal surat umum."]
];
for (const [code,name,type,pattern,description] of formats) {
  const [rows] = await conn.query("SELECT id FROM siap_number_formats WHERE code=? LIMIT 1", [code]);
  if (!rows.length) {
    await conn.execute(
      `INSERT INTO siap_number_formats (id,code,name,document_type,pattern,description,is_active,created_by)
       VALUES (?,?,?,?,?,?,1,?)`,
      [crypto.randomUUID(), code, name, type, pattern, description, rootId]
    );
  }
}

console.log("SIAP ARU database initialized.");
console.log(`Root login: ${rootEmail} / ${rootPassword}`);
console.log(`Operational user password: ${operationalPassword}`);
console.log("Operational emails: staff@aruraharja.co.id, manager@aruraharja.co.id, manager.ops@aruraharja.co.id, manager.gedung@aruraharja.co.id, dirops@aruraharja.co.id, dirut@aruraharja.co.id, finance@aruraharja.co.id");
await conn.end();
