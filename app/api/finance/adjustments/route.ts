import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { canEditFinance } from "@/lib/permissions";
import { auditLog } from "@/lib/audit";
import { assertEditableFinanceMonth } from "@/lib/finance-period";

export const runtime = "nodejs";

type Metric = "REVENUE" | "EXPENSE" | "BUDGET";
type AdjustmentType = "INCREASE" | "DECREASE" | "SET_TOTAL";
const metricColumn: Record<Metric,string> = { REVENUE:"income_amount", EXPENSE:"expense_amount", BUDGET:"budget_amount" };

function money(v: unknown) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error("Nominal harus berupa angka 0 atau lebih.");
  return n;
}
function dateValue(v: unknown) {
  const s = String(v || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Tanggal data tidak valid.");
  return s;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if (!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance dan Root Admin yang dapat membuat penyesuaian."},{status:403});
  try {
    const b = await request.json();
    const period = assertEditableFinanceMonth(b.period_month).sqlDate;
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
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM siap_finance_monthly_summaries WHERE period_month=? LIMIT 1 FOR UPDATE`, [period]);
      let summary = rows[0] || null;
      let summaryId = String(summary?.id || "");
      if (!summary) {
        summaryId = crypto.randomUUID();
        await conn.execute(
          `INSERT INTO siap_finance_monthly_summaries
           (id,period_month,data_date,include_in_ytd,publish_status,period_status,created_by,updated_by)
           VALUES(?,?,?,0,'DRAFT','OPEN',?,?)`,
          [summaryId,period,dataDate,user.id,user.id]
        );
        const [created] = await conn.query<RowDataPacket[]>(`SELECT * FROM siap_finance_monthly_summaries WHERE id=? FOR UPDATE`, [summaryId]);
        summary = created[0];
      }
      const column = metricColumn[metric];
      const before = Number(summary[column] || 0);
      let after = before;
      if (adjustmentType === "INCREASE") after = before + amount;
      if (adjustmentType === "DECREASE") after = before - amount;
      if (adjustmentType === "SET_TOTAL") after = amount;
      if (after < 0) throw new Error("Hasil penyesuaian tidak boleh membuat nilai menjadi negatif.");

      const adjustmentId = crypto.randomUUID();
      await conn.execute(
        `UPDATE siap_finance_monthly_summaries SET ${column}=?,data_date=?,updated_by=? WHERE id=?`,
        [after,dataDate,user.id,summaryId]
      );
      await conn.execute(
        `INSERT INTO siap_finance_adjustments
         (id,summary_id,metric,adjustment_type,amount,value_before,value_after,data_date,include_in_ytd_snapshot,note,status,created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?, 'ACTIVE',?)`,
        [adjustmentId,summaryId,metric,adjustmentType,amount,before,after,dataDate,Number(summary.include_in_ytd||0),note,user.id]
      );
      return { adjustmentId,summaryId,before,after,includeInYtd:Boolean(summary.include_in_ytd),publishStatus:String(summary.publish_status||"DRAFT") };
    });

    await auditLog({userId:user.id,action:"FINANCE_ADJUSTMENT_CREATE",entityType:"FINANCE_ADJUSTMENT",entityId:result.adjustmentId,metadata:{
      period,metric,adjustment_type:adjustmentType,amount,value_before:result.before,value_after:result.after,data_date:dataDate,note,include_in_ytd:result.includeInYtd,publish_status:result.publishStatus
    },request});
    return NextResponse.json({ok:true,data:result},{status:201});
  } catch (e) {
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal membuat penyesuaian."},{status:400});
  }
}
