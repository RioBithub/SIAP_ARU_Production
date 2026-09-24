import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { canEditFinance } from "@/lib/permissions";
import { auditLog } from "@/lib/audit";

export const runtime = "nodejs";
const metricColumn: Record<string,string> = {
  OUTSTANDING:"outstanding_amount",
  DUE_30:"due_30_amount",
  AGING_1_30:"aging_1_30_amount",
  AGING_30_60:"aging_30_60_amount",
  AGING_60_90:"aging_60_90_amount",
  AGING_90_PLUS:"aging_90_plus_amount"
};
function validatePosition(row: Record<string,unknown>) {
  const outstanding = Number(row.outstanding_amount || 0);
  const due30 = Number(row.due_30_amount || 0);
  const overdue = Number(row.aging_1_30_amount || 0)+Number(row.aging_30_60_amount || 0)+Number(row.aging_60_90_amount || 0)+Number(row.aging_90_plus_amount || 0);
  if (outstanding < 0 || due30 < 0 || overdue < 0) throw new Error("Nilai posisi tidak boleh negatif.");
  if (due30 > outstanding) throw new Error("Jatuh tempo ≤30 hari tidak boleh melebihi total outstanding.");
  if (overdue > outstanding) throw new Error("Total aging overdue tidak boleh melebihi total outstanding.");
}

export async function POST(request: Request,{params}:{params:{id:string}}) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if (!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance dan Root Admin yang dapat membatalkan penyesuaian."},{status:403});
  try {
    const body = await request.json().catch(()=>({}));
    const note = String(body.note || "").trim().slice(0,2000);
    if (!note) throw new Error("Alasan reversal wajib diisi.");
    const id = String(params.id || "");
    const result = await withTransaction(async conn => {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT a.*,s.outstanding_amount,s.due_30_amount,s.aging_1_30_amount,s.aging_30_60_amount,s.aging_60_90_amount,s.aging_90_plus_amount
         FROM siap_finance_position_adjustments a
         JOIN siap_finance_position_summaries s ON s.id=a.summary_id
         WHERE a.id=? LIMIT 1 FOR UPDATE`,[id]
      );
      const original = rows[0];
      if (!original) throw new Error("Penyesuaian tidak ditemukan.");
      if (String(original.status)!=="ACTIVE") throw new Error("Penyesuaian ini sudah dibatalkan atau tidak aktif.");
      if (String(original.adjustment_type)==="REVERSAL") throw new Error("Record reversal tidak dapat dibatalkan lagi.");
      const column = metricColumn[String(original.metric)];
      if (!column) throw new Error("Metrik penyesuaian tidak valid.");
      const current = Number(original[column] || 0);
      const effect = Number(original.value_after || 0)-Number(original.value_before || 0);
      const after = current-effect;
      const candidate: Record<string,unknown> = {...original,[column]:after};
      validatePosition(candidate);
      const reversalId = crypto.randomUUID();
      const dataDate = new Date().toISOString().slice(0,10);
      await conn.execute(`UPDATE siap_finance_position_summaries SET ${column}=?,as_of_date=?,updated_by=? WHERE id=?`,[after,dataDate,user.id,original.summary_id]);
      await conn.execute(`UPDATE siap_finance_position_adjustments SET status='REVERSED' WHERE id=?`,[id]);
      await conn.execute(
        `INSERT INTO siap_finance_position_adjustments
         (id,summary_id,ledger_type,metric,adjustment_type,amount,value_before,value_after,data_date,note,reversed_adjustment_id,status,created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`,
        [reversalId,original.summary_id,original.ledger_type,original.metric,"REVERSAL",Math.abs(effect),current,after,dataDate,note,id,user.id]
      );
      return {reversalId,originalId:id,summaryId:String(original.summary_id),ledgerType:String(original.ledger_type),metric:String(original.metric),before:current,after};
    });
    await auditLog({userId:user.id,action:"FINANCE_POSITION_ADJUSTMENT_REVERSE",entityType:"FINANCE_POSITION_ADJUSTMENT",entityId:result.reversalId,metadata:{...result,note},request});
    return NextResponse.json({ok:true,data:result});
  } catch (e) {
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal membatalkan penyesuaian."},{status:400});
  }
}
