import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { accounts, date, samples } from "./config.mjs";

function insert(table, columns, rows) {
  return mysql.format("INSERT INTO ?? (??) VALUES ?", [table, columns, rows]) + ";";
}

export async function seedSql() {
  const users = Object.values(accounts);
  const root = accounts.root.id;
  const finance = accounts.finance.id;
  const financeDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).format();
  const financeMonth = `${financeDate.slice(0, 7)}-01`;
  const financeYear = Number(financeDate.slice(0, 4));
  const letters = [
    [samples.legacy, "INCOMING", "SURAT_MASUK_UMUM", "DEMO Arsip alur awal", "SQA-LEGACY-001",
      "Vendor Fiktif", "Operasional", date, date, "MANAGER_REVIEW", "MANAGER",
      accounts.manager.id, accounts.manager.id, accounts.staff.id, accounts.staff.id, 0, 0, "RAHASIA"],
    [samples.intake, "INCOMING", "SURAT_MASUK_UMUM", "DEMO Permohonan jadwal servis", "V-014/DEMO",
      "Vendor Fiktif", "Direktur Operasional", date, date, "SECRETARIAT_INTAKE", "SECRETARIAT",
      null, accounts.dirops.id, accounts.dirops.id, accounts.dirops.id, 1, 1, "BIASA"],
    [samples.internal, "INTERNAL", "NOTA_DINAS", "DEMO Permohonan pelatihan internal", null,
      "SDM", "Manager SDM", date, null, "DRAFT", "STAFF",
      null, accounts.manager2.id, accounts.other.id, accounts.other.id, 0, 0, "RAHASIA"],
    [samples.approved, "INCOMING", "SURAT_MASUK_UMUM", "DEMO Penugasan untuk balasan vendor", "V-015/DEMO",
      "Vendor Fiktif", "Operasional", date, date, "DISPOSED", null,
      null, accounts.dirops.id, accounts.secretariat.id, accounts.dirops.id, 1, 1, "BIASA"],
  ];

  const userRows = await Promise.all(users.map(async (user) => [
    user.id, user.name, user.email, await bcrypt.hash(user.password, 10), user.role, user.unit, 1,
  ]));

  const formats = [
    ["PKS", "Perjanjian Kerja Sama", "PERJANJIAN_KERJA_SAMA", "P/{seq}/AR/{year}"],
    ["DIR", "Surat Keluar Direksi", "SURAT_DIREKSI", "Dir/{seq}/AR/{year}"],
    ["OPS", "Surat Bagian Operasional", "SURAT_OPERASIONAL", "Ops/{seq}/AR/{year}"],
    ["PO", "Purchase Order", "PURCHASE_ORDER", "PO/{seq}/AR/{year}"],
    ["UMUM", "Surat Keluar Umum", "SURAT_UMUM", "UM/{seq}/AR/{year}"],
  ];
  return [
    insert("siap_users", ["id","name","email","password_hash","role","unit_name","is_active"], userRows),
    insert("siap_number_formats", ["id","code","name","document_type","pattern","is_active","created_by"],
      formats.map((format) => [randomUUID(), ...format, 1, root])),
    insert("siap_letters", ["id","direction","document_type","subject","external_number","sender","recipient",
      "letter_date","received_date","status","current_role","current_owner_user_id","routing_target_user_id",
      "created_by","updated_by","uses_secretariat","is_public","confidentiality"], letters),
    insert("siap_dispositions", ["id","letter_id","from_user_id","to_user_id","current_owner_user_id",
      "visibility","instruction","status","result_requirement"],
      [[samples.task, samples.approved, accounts.dirops.id, accounts.manager.id, accounts.manager.id,
        "PRIVATE", "Siapkan balasan vendor untuk jadwal servis.", "UNSEEN", "OUTGOING_LETTER"]]),
    insert("siap_disposition_actions", ["id","disposition_id","actor_user_id","action","to_status","note"],
      [[randomUUID(), samples.task, accounts.dirops.id, "CREATE", "UNSEEN", "Tugas latihan SQA."]]),
    insert("siap_finance_source_modes", ["ledger_type","data_mode","updated_by"],
      [["RECEIVABLE","SUMMARY",finance],["PAYABLE","SUMMARY",finance]]),
    insert("siap_finance_monthly_summaries", ["id","period_month","data_date","income_amount","expense_amount",
      "budget_amount","notes","publish_status","include_in_ytd","created_by","updated_by"],
      [[randomUUID(),financeMonth,financeDate,15_000_000,8_000_000,10_000_000,"Data fiktif untuk demo","PUBLISHED",0,finance,finance]]),
    insert("siap_finance_yearly_summaries", ["id","summary_year","calculation_mode","base_income_amount",
      "base_expense_amount","annual_budget_amount","as_of_date","notes","publish_status","created_by","updated_by"],
      [[randomUUID(),financeYear,"MANUAL",52_000_000,33_000_000,50_000_000,financeDate,"Posisi tahunan fiktif","PUBLISHED",finance,finance]]),
    insert("siap_finance_position_summaries", ["id","ledger_type","as_of_date","outstanding_amount",
      "due_30_amount","due_30_count","aging_1_30_amount","aging_30_60_amount","aging_60_90_amount",
      "aging_90_plus_amount","created_by","updated_by"], [
      [randomUUID(),"RECEIVABLE",financeDate,3_000_000,1_000_000,1,2_000_000,0,0,0,finance,finance],
      [randomUUID(),"PAYABLE",financeDate,1_000_000,1_000_000,1,0,0,0,0,finance,finance],
    ]),
    insert("siap_bank_accounts", ["id","bank_name","account_name","account_number","currency",
      "opening_balance","opening_balance_date","created_by","updated_by"],
      [[samples.bank,"BRI Demo","Rekening Uji SIAP ARU","000000000000001","IDR",1_000_000,"2025-01-01",finance,finance]]),
    insert("siap_bank_transactions", ["id","bank_account_id","transaction_at","description","debit_amount",
      "credit_amount","created_by","updated_by"], [
      [randomUUID(),samples.bank,"2025-01-04 10:00:00","DEMO Penerimaan",0,200_000,finance,finance],
      [randomUUID(),samples.bank,"2025-01-05 10:00:00","DEMO Biaya kegiatan",50_000,0,finance,finance],
    ]),
    "UPDATE siap_sqa_instance SET state='READY' WHERE id=1;",
  ].join("\n");
}
