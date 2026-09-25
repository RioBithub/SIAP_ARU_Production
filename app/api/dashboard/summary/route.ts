import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canSeeFinance } from "@/lib/permissions";
import { getLedgerPosition } from "@/lib/finance-ledger";
import { getFinanceYearSnapshot } from "@/lib/finance-summary";

export const runtime = "nodejs";

function dateOnly(v:unknown){if(!v)return null;if(v instanceof Date)return v.toISOString().slice(0,10);return String(v).slice(0,10);}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok:false, error:"Unauthorized" }, { status:401 });

  const [letterRows] = await db.query<RowDataPacket[]>(
    `SELECT
      SUM(direction='INCOMING') AS incoming_total,
      SUM(direction='INTERNAL') AS internal_total,
      SUM(status IN ('MANAGER_REVIEW','DIRECTOR_OPS_REVIEW','PRESIDENT_DIRECTOR_REVIEW')) AS waiting_approval,
      SUM(status IN ('DISPOSED','IN_PROGRESS')) AS in_progress,
      SUM(status IN ('COMPLETED','APPROVED','ISSUED')) AS completed
     FROM siap_letters
     WHERE MONTH(letter_date)=MONTH(CURDATE()) AND YEAR(letter_date)=YEAR(CURDATE())`
  );

  const [dispRows] = await db.query<RowDataPacket[]>(
    `SELECT
      SUM(status='UNSEEN') AS unseen,
      SUM(status='IN_PROGRESS') AS active,
      SUM(status='COMPLETED' AND YEARWEEK(completed_at,1)=YEARWEEK(CURDATE(),1)) AS completed_week
     FROM siap_dispositions
     WHERE to_user_id=? OR ?='ROOT_ADMIN'`,
    [user.id, user.role]
  );

  let finance = null;
  if (canSeeFinance(user.role)) {
    const [clockRows] = await db.query<RowDataPacket[]>(
      `SELECT YEAR(CURDATE()) AS current_year, DATE_FORMAT(CURDATE(),'%Y-%m-01') AS current_period`
    );
    const currentYear = Number(clockRows[0]?.current_year || new Date().getFullYear());
    const currentPeriod = dateOnly(clockRows[0]?.current_period) || `${currentYear}-01-01`;

    const [summaryRows] = await db.query<RowDataPacket[]>(
      `SELECT income_amount,expense_amount,budget_amount,(income_amount-expense_amount) AS profit_amount,
              period_month,data_date,updated_at
       FROM siap_finance_monthly_summaries
       WHERE period_month=DATE_FORMAT(CURDATE(),'%Y-%m-01') AND publish_status='PUBLISHED' LIMIT 1`
    );
    const [history] = await db.query<RowDataPacket[]>(
      `SELECT period_month,income_amount,expense_amount,(income_amount-expense_amount) AS profit_amount,data_date,updated_at
       FROM siap_finance_monthly_summaries
       WHERE period_month<=DATE_FORMAT(CURDATE(),'%Y-%m-01')
         AND publish_status='PUBLISHED'
       ORDER BY period_month DESC LIMIT 6`
    );
    const [recvPosition,payPosition,ytd] = await Promise.all([
      getLedgerPosition("receivables"),
      getLedgerPosition("payables"),
      getFinanceYearSnapshot(currentYear,true)
    ]);
    const s=summaryRows[0]||{};
    finance = {
      current_year:currentYear,
      current_period:currentPeriod,
      ytd_available:Boolean(ytd.configured),
      ytd_income:Number(ytd.income_amount||0),
      ytd_expense:Number(ytd.expense_amount||0),
      ytd_profit:Number(ytd.profit_amount||0),
      ytd_budget:Number(ytd.budget_amount||0),
      ytd_as_of_date:ytd.as_of_date,
      ytd_updated_at:ytd.updated_at,
      income:Number(s.income_amount||0),
      expense:Number(s.expense_amount||0),
      budget:Number(s.budget_amount||0),
      profit:Number(s.profit_amount||0),
      month_available:Boolean(summaryRows[0]),
      month_data_date:dateOnly(s.data_date),
      month_updated_at:s.updated_at||null,
      receivables:Number(recvPosition.active.outstanding_amount||0),
      receivables_overdue:Number(recvPosition.active.overdue_amount||0),
      receivables_due_30:Number(recvPosition.active.due_30_amount||0),
      payables:Number(payPosition.active.outstanding_amount||0),
      payables_overdue:Number(payPosition.active.overdue_amount||0),
      payables_due_30:Number(payPosition.active.due_30_amount||0),
      history:[...history].reverse().map((r:any)=>({
        period_month:dateOnly(r.period_month),
        income:Number(r.income_amount||0),
        expense:Number(r.expense_amount||0),
        profit:Number(r.profit_amount||0),
        data_date:dateOnly(r.data_date),
        updated_at:r.updated_at
      }))
    };
  }

  return NextResponse.json({
    ok:true,
    data:{
      letters: letterRows[0] || {},
      dispositions: dispRows[0] || {},
      finance
    }
  });
}
