import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db";

export type PartyKind = "receivables" | "payables";
export type LedgerType = "RECEIVABLE" | "PAYABLE";
export type LedgerMode = "SUMMARY" | "DETAIL";

export function ledgerMeta(kind: PartyKind) {
  return kind === "receivables"
    ? { ledgerType: "RECEIVABLE" as LedgerType, table: "siap_receivables", label: "Piutang" }
    : { ledgerType: "PAYABLE" as LedgerType, table: "siap_payables", label: "Utang" };
}

function dateOnly(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0,10);
  const raw=String(value||"");
  const match=raw.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] || new Date().toISOString().slice(0,10);
}

export function normalizeKind(raw: string): PartyKind {
  if (raw === "receivables" || raw === "payables") return raw;
  throw new Error("Jenis posisi keuangan tidak valid.");
}

export async function getLedgerPosition(kind: PartyKind) {
  const { ledgerType, table } = ledgerMeta(kind);
  const [settingRows] = await db.query<RowDataPacket[]>(
    `SELECT data_mode,updated_at FROM siap_finance_source_modes WHERE ledger_type=? LIMIT 1`,
    [ledgerType]
  );
  const mode: LedgerMode = settingRows[0]?.data_mode === "DETAIL" ? "DETAIL" : "SUMMARY";

  const [summaryRows] = await db.query<RowDataPacket[]>(
    `SELECT s.*,u.name AS updated_by_name
     FROM siap_finance_position_summaries s
     LEFT JOIN siap_users u ON u.id=s.updated_by
     WHERE s.ledger_type=? LIMIT 1`,
    [ledgerType]
  );
  const s = summaryRows[0] || null;
  const summary = s ? {
    id: String(s.id),
    as_of_date: dateOnly(s.as_of_date),
    outstanding_amount: Number(s.outstanding_amount || 0),
    due_30_amount: Number(s.due_30_amount || 0),
    due_30_count: Number(s.due_30_count || 0),
    aging_1_30_amount: Number(s.aging_1_30_amount || 0),
    aging_30_60_amount: Number(s.aging_30_60_amount || 0),
    aging_60_90_amount: Number(s.aging_60_90_amount || 0),
    aging_90_plus_amount: Number(s.aging_90_plus_amount || 0),
    overdue_amount:
      Number(s.aging_1_30_amount || 0) + Number(s.aging_30_60_amount || 0) +
      Number(s.aging_60_90_amount || 0) + Number(s.aging_90_plus_amount || 0),
    notes: String(s.notes || ""),
    updated_at: s.updated_at,
    updated_by_name: String(s.updated_by_name || "")
  } : {
    id: null,
    as_of_date: new Date().toISOString().slice(0,10),
    outstanding_amount: 0,
    due_30_amount: 0,
    due_30_count: 0,
    aging_1_30_amount: 0,
    aging_30_60_amount: 0,
    aging_60_90_amount: 0,
    aging_90_plus_amount: 0,
    overdue_amount: 0,
    notes: "",
    updated_at: null,
    updated_by_name: ""
  };

  const [detailRows] = await db.query<RowDataPacket[]>(
    `SELECT
      COALESCE(SUM(CASE WHEN status<>'PAID' THEN GREATEST(amount-paid_amount,0) ELSE 0 END),0) AS outstanding_amount,
      COALESCE(SUM(CASE WHEN status<>'PAID' AND due_date<CURDATE() THEN GREATEST(amount-paid_amount,0) ELSE 0 END),0) AS overdue_amount,
      COALESCE(SUM(CASE WHEN status<>'PAID' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(),INTERVAL 30 DAY) THEN GREATEST(amount-paid_amount,0) ELSE 0 END),0) AS due_30_amount,
      COALESCE(SUM(CASE WHEN status<>'PAID' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(),INTERVAL 30 DAY) THEN 1 ELSE 0 END),0) AS due_30_count,
      COALESCE(SUM(CASE WHEN status<>'PAID' AND DATEDIFF(CURDATE(),due_date) BETWEEN 1 AND 30 THEN GREATEST(amount-paid_amount,0) ELSE 0 END),0) AS aging_1_30_amount,
      COALESCE(SUM(CASE WHEN status<>'PAID' AND DATEDIFF(CURDATE(),due_date) BETWEEN 31 AND 60 THEN GREATEST(amount-paid_amount,0) ELSE 0 END),0) AS aging_30_60_amount,
      COALESCE(SUM(CASE WHEN status<>'PAID' AND DATEDIFF(CURDATE(),due_date) BETWEEN 61 AND 90 THEN GREATEST(amount-paid_amount,0) ELSE 0 END),0) AS aging_60_90_amount,
      COALESCE(SUM(CASE WHEN status<>'PAID' AND DATEDIFF(CURDATE(),due_date)>90 THEN GREATEST(amount-paid_amount,0) ELSE 0 END),0) AS aging_90_plus_amount,
      COALESCE(SUM(status<>'PAID'),0) AS active_count,
      MAX(updated_at) AS updated_at
     FROM ${table}`
  );
  const d = detailRows[0] || {};
  const detail = {
    id: null,
    as_of_date: new Date().toISOString().slice(0,10),
    outstanding_amount: Number(d.outstanding_amount || 0),
    overdue_amount: Number(d.overdue_amount || 0),
    due_30_amount: Number(d.due_30_amount || 0),
    due_30_count: Number(d.due_30_count || 0),
    aging_1_30_amount: Number(d.aging_1_30_amount || 0),
    aging_30_60_amount: Number(d.aging_30_60_amount || 0),
    aging_60_90_amount: Number(d.aging_60_90_amount || 0),
    aging_90_plus_amount: Number(d.aging_90_plus_amount || 0),
    active_count: Number(d.active_count || 0),
    notes: "",
    updated_at: d.updated_at || null,
    updated_by_name: ""
  };

  const [adjustmentRows] = await db.query<RowDataPacket[]>(
    `SELECT a.id,a.summary_id,a.ledger_type,a.metric,a.adjustment_type,a.amount,a.value_before,a.value_after,a.data_date,a.note,a.reversed_adjustment_id,a.status,a.created_at,
            u.name AS created_by_name,
            (SELECT COUNT(*) FROM siap_finance_attachments fa WHERE fa.position_adjustment_id=a.id) AS attachment_count
     FROM siap_finance_position_adjustments a
     LEFT JOIN siap_users u ON u.id=a.created_by
     WHERE a.ledger_type=?
     ORDER BY a.created_at DESC
     LIMIT 250`,
    [ledgerType]
  );
  const adjustments=adjustmentRows.map((a:any)=>({
    ...a,
    amount:Number(a.amount||0),value_before:Number(a.value_before||0),value_after:Number(a.value_after||0),
    data_date:dateOnly(a.data_date),attachment_count:Number(a.attachment_count||0)
  }));

  return { ledgerType, mode, summary, detail, adjustments, active: mode === "DETAIL" ? detail : summary };
}
