import crypto from "crypto";
import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { canEditFinance } from "@/lib/permissions";
import { auditLog } from "@/lib/audit";
import { ledgerMeta, normalizeKind } from "@/lib/finance-ledger";

export const runtime = "nodejs";

type Metric = "OUTSTANDING"|"DUE_30"|"AGING_1_30"|"AGING_30_60"|"AGING_60_90"|"AGING_90_PLUS";
type AdjustmentType = "INCREASE"|"DECREASE"|"SET_TOTAL";

const metricColumn: Record<Metric,string> = {
  OUTSTANDING:"outstanding_amount",
  DUE_30:"due_30_amount",
  AGING_1_30:"aging_1_30_amount",
  AGING_30_60:"aging_30_60_amount",
  AGING_60_90:"aging_60_90_amount",
  AGING_90_PLUS:"aging_90_plus_amount"
};

function money(v: unknown) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error("Nominal harus berupa angka 0 atau lebih.");
  return n;
}
function dateValue(v: unknown) {
  const s = String(v || "").trim().slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Tanggal data tidak valid.");
  return s;
}
function validatePosition(row: Record<string,unknown>) {
  const outstanding = Number(row.outstanding_amount || 0);
  const due30 = Number(row.due_30_amount || 0);
  const overdue = Number(row.aging_1_30_amount || 0)+Number(row.aging_30_60_amount || 0)+Number(row.aging_60_90_amount || 0)+Number(row.aging_90_plus_amount || 0);
  if (outstanding < 0 || due30 < 0 || overdue < 0) throw new Error("Nilai posisi tidak boleh negatif.");
  if (due30 > outstanding) throw new Error("Jatuh tempo ≤30 hari tidak boleh melebihi total outstanding.");
  if (overdue > outstanding) throw new Error("Total aging overdue tidak boleh melebihi total outstanding.");
}
async function ensureSummary(conn: PoolConnection, ledgerType: string, userId: string, dataDate: string) {
  const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM siap_finance_position_summaries WHERE ledger_type=? LIMIT 1 FOR UPDATE`,[ledgerType]);
  if (rows[0]) return rows[0];
  const id = crypto.randomUUID();
  await conn.execute(
    `INSERT INTO siap_finance_position_summaries
     (id,ledger_type,as_of_date,outstanding_amount,due_30_amount,due_30_count,aging_1_30_amount,aging_30_60_amount,aging_60_90_amount,aging_90_plus_amount,created_by,updated_by)
     VALUES(?,?,?,0,0,0,0,0,0,0,?,?)`,
    [id,ledgerType,dataDate,userId,userId]
  );
  const [created] = await conn.query<RowDataPacket[]>(`SELECT * FROM siap_finance_position_summaries WHERE id=? LIMIT 1 FOR UPDATE`,[id]);
  return created[0];
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if (!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance dan Root Admin yang dapat membuat penyesuaian."},{status:403});
  try {
    const b = await request.json();
    const kind = normalizeKind(String(b.kind || ""));
    const {ledgerType} = ledgerMeta(kind);
    const metric = String(b.metric || "").toUpperCase() as Metric;
    const adjustmentType = String(b.adjustment_type || "").toUpperCase() as AdjustmentType;
    if (!metricColumn[metric]) throw new Error("Metrik penyesuaian tidak valid.");
    if (!["INCREASE","DECREASE","SET_TOTAL"].includes(adjustmentType)) throw new Error("Jenis penyesuaian tidak valid.");
    const amount = money(b.amount);
    if (adjustmentType !== "SET_TOTAL" && amount <= 0) throw new Error("Nominal tambah/kurang harus lebih dari 0.");
    const dataDate = dateValue(b.data_date || new Date().toISOString().slice(0,10));
    const note = String(b.note || "").trim().slice(0,2000);
    if (!note) throw new Error("Keterangan penyesuaian wajib diisi.");

    const result = await withTransaction(async conn => {
      const summary = await ensureSummary(conn,ledgerType,user.id,dataDate);
      const column = metricColumn[metric];
      const before = Number(summary[column] || 0);
      let after = before;
      if (adjustmentType === "INCREASE") after = before + amount;
      if (adjustmentType === "DECREASE") after = before - amount;
      if (adjustmentType === "SET_TOTAL") after = amount;
      if (after < 0) throw new Error("Hasil penyesuaian tidak boleh membuat nilai menjadi negatif.");

      const candidate: Record<string,unknown> = {...summary,[column]:after};
      validatePosition(candidate);
      const adjustmentId = crypto.randomUUID();
      await conn.execute(`UPDATE siap_finance_position_summaries SET ${column}=?,as_of_date=?,updated_by=? WHERE id=?`,[after,dataDate,user.id,summary.id]);
      await conn.execute(
        `INSERT INTO siap_finance_position_adjustments
         (id,summary_id,ledger_type,metric,adjustment_type,amount,value_before,value_after,data_date,note,status,created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`,
        [adjustmentId,summary.id,ledgerType,metric,adjustmentType,amount,before,after,dataDate,note,user.id]
      );
      return {adjustmentId,summaryId:String(summary.id),ledgerType,metric,before,after,dataDate};
    });

    await auditLog({userId:user.id,action:"FINANCE_POSITION_ADJUSTMENT_CREATE",entityType:"FINANCE_POSITION_ADJUSTMENT",entityId:result.adjustmentId,metadata:{...result,kind,adjustment_type:adjustmentType,amount,note},request});
    return NextResponse.json({ok:true,data:result},{status:201});
  } catch (e) {
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal membuat penyesuaian."},{status:400});
  }
}
