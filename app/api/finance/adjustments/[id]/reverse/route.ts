import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { canEditFinance } from "@/lib/permissions";
import { auditLog } from "@/lib/audit";
import { assertEditableFinanceMonth, parseFinanceMonth } from "@/lib/finance-period";

export const runtime = "nodejs";
const metricColumn: Record<string,string> = { REVENUE:"income_amount", EXPENSE:"expense_amount", BUDGET:"budget_amount" };

export async function POST(request: Request, {params}:{params:{id:string}}) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if (!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance dan Root Admin yang dapat membatalkan penyesuaian."},{status:403});
  try {
    const body = await request.json().catch(()=>({}));
    const note = String(body.note || "").trim().slice(0,2000);
    if (!note) throw new Error("Alasan pembatalan / reversal wajib diisi.");
    const id = String(params.id || "");
    const result = await withTransaction(async conn => {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT a.*,s.period_month,s.income_amount,s.expense_amount,s.budget_amount,s.include_in_ytd
         FROM siap_finance_adjustments a
         JOIN siap_finance_monthly_summaries s ON s.id=a.summary_id
         WHERE a.id=? LIMIT 1 FOR UPDATE`, [id]
      );
      const original = rows[0];
      if (!original) throw new Error("Penyesuaian tidak ditemukan.");
      assertEditableFinanceMonth(original.period_month);
      if (String(original.status) !== "ACTIVE") throw new Error("Penyesuaian ini sudah dibatalkan atau tidak aktif.");
      if (String(original.adjustment_type) === "REVERSAL") throw new Error("Record reversal tidak dapat dibatalkan lagi.");
      const column = metricColumn[String(original.metric)];
      if (!column) throw new Error("Metrik penyesuaian tidak valid.");
      const current = Number(original[column] || 0);
      const effect = Number(original.value_after || 0) - Number(original.value_before || 0);
      const after = current - effect;
      if (after < 0) throw new Error("Reversal ini akan menghasilkan nilai negatif dan tidak dapat diproses.");
      const reversalId = crypto.randomUUID();
      const dataDate = new Date().toISOString().slice(0,10);
      await conn.execute(`UPDATE siap_finance_monthly_summaries SET ${column}=?,data_date=?,updated_by=? WHERE id=?`, [after,dataDate,user.id,original.summary_id]);
      await conn.execute(`UPDATE siap_finance_adjustments SET status='REVERSED' WHERE id=?`, [id]);
      await conn.execute(
        `INSERT INTO siap_finance_adjustments
         (id,summary_id,metric,adjustment_type,amount,value_before,value_after,data_date,include_in_ytd_snapshot,note,reversed_adjustment_id,status,created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`,
        [reversalId,original.summary_id,original.metric,"REVERSAL",Math.abs(effect),current,after,dataDate,Number(original.include_in_ytd||0),note,id,user.id]
      );
      return { reversalId,summaryId:String(original.summary_id),metric:String(original.metric),before:current,after,originalId:id,period:parseFinanceMonth(original.period_month).sqlDate };
    });
    await auditLog({userId:user.id,action:"FINANCE_ADJUSTMENT_REVERSE",entityType:"FINANCE_ADJUSTMENT",entityId:result.reversalId,metadata:result,request});
    return NextResponse.json({ok:true,data:result});
  } catch (e) {
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal membatalkan penyesuaian."},{status:400});
  }
}
