import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db";

export type FinanceCalculationMode = "MANUAL" | "AUTO_MONTHLY" | "HYBRID";

export type FinanceYearSnapshot = {
  configured: boolean;
  year: number;
  mode: FinanceCalculationMode | "UNCONFIGURED";
  publish_status: "DRAFT" | "PUBLISHED";
  base_through_month: number | null;
  base_income_amount: number;
  base_expense_amount: number;
  annual_budget_amount: number;
  income_amount: number;
  expense_amount: number;
  profit_amount: number;
  budget_amount: number;
  as_of_date: string | null;
  updated_at: string | null;
  updated_by_name: string | null;
  notes: string;
  included_months: number[];
};

function dateOnly(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export async function getFinanceYearSnapshot(year: number, publishedOnly = true): Promise<FinanceYearSnapshot> {
  const [yearRows] = await db.query<RowDataPacket[]>(
    `SELECT y.*,u.name AS updated_by_name
     FROM siap_finance_yearly_summaries y
     LEFT JOIN siap_users u ON u.id=y.updated_by
     WHERE y.summary_year=? LIMIT 1`,
    [year]
  );
  const y = yearRows[0] || null;

  if (!y || (publishedOnly && String(y.publish_status || "DRAFT") !== "PUBLISHED")) {
    return {
      configured: false,
      year,
      mode: "UNCONFIGURED",
      publish_status: "DRAFT",
      base_through_month: null,
      base_income_amount: 0,
      base_expense_amount: 0,
      annual_budget_amount: 0,
      income_amount: 0,
      expense_amount: 0,
      profit_amount: 0,
      budget_amount: 0,
      as_of_date: null,
      updated_at: null,
      updated_by_name: null,
      notes: "",
      included_months: []
    };
  }

  const mode = String(y.calculation_mode || "MANUAL") as FinanceCalculationMode;
  const baseThrough = y.base_through_month == null ? null : Number(y.base_through_month);
  const baseIncome = Number(y.base_income_amount || 0);
  const baseExpense = Number(y.base_expense_amount || 0);
  const annualBudget = Number(y.annual_budget_amount || 0);

  const [monthlyRows] = await db.query<RowDataPacket[]>(
    `SELECT MONTH(period_month) AS month_no,income_amount,expense_amount,budget_amount,data_date,updated_at
     FROM siap_finance_monthly_summaries
     WHERE YEAR(period_month)=?
       AND include_in_ytd=1
       AND publish_status='PUBLISHED'
     ORDER BY period_month ASC`,
    [year]
  );

  let income = 0;
  let expense = 0;
  let monthlyBudget = 0;
  let asOf = dateOnly(y.as_of_date);
  const includedMonths: number[] = [];

  if (mode === "MANUAL") {
    income = baseIncome;
    expense = baseExpense;
  } else {
    if (mode === "HYBRID") {
      income = baseIncome;
      expense = baseExpense;
    }
    for (const row of monthlyRows) {
      const monthNo = Number(row.month_no);
      if (mode === "HYBRID" && baseThrough != null && monthNo <= baseThrough) continue;
      income += Number(row.income_amount || 0);
      expense += Number(row.expense_amount || 0);
      monthlyBudget += Number(row.budget_amount || 0);
      includedMonths.push(monthNo);
      const d = dateOnly(row.data_date) || dateOnly(row.updated_at);
      if (d && (!asOf || d > asOf)) asOf = d;
    }
  }

  const budget = annualBudget > 0 ? annualBudget : monthlyBudget;
  return {
    configured: true,
    year,
    mode,
    publish_status: String(y.publish_status || "DRAFT") as "DRAFT" | "PUBLISHED",
    base_through_month: baseThrough,
    base_income_amount: baseIncome,
    base_expense_amount: baseExpense,
    annual_budget_amount: annualBudget,
    income_amount: income,
    expense_amount: expense,
    profit_amount: income - expense,
    budget_amount: budget,
    as_of_date: asOf,
    updated_at: y.updated_at || null,
    updated_by_name: y.updated_by_name || null,
    notes: String(y.notes || ""),
    included_months: includedMonths
  };
}
