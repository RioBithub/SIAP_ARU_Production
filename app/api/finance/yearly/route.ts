import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canEditFinance, canSeeFinance } from "@/lib/permissions";
import { auditLog } from "@/lib/audit";
import { getFinanceYearSnapshot, type FinanceCalculationMode } from "@/lib/finance-summary";
import { assertEditableFinanceYear } from "@/lib/finance-period";

export const runtime = "nodejs";

function normalizeYear(raw: unknown) {
  const year = Number(raw || new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new Error("Tahun tidak valid.");
  return year;
}
function money(v: unknown) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error("Nilai keuangan harus berupa angka 0 atau lebih.");
  return n;
}
function rawDateOnly(v: unknown) {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0,10);
  return String(v).slice(0,10);
}
function dateValue(v: unknown) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Tanggal data tidak valid.");
  return s;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok:false,error:"Unauthorized" }, { status:401 });
  if (!canSeeFinance(user.role)) return NextResponse.json({ ok:false,error:"Forbidden" }, { status:403 });
  try {
    const year = normalizeYear(new URL(request.url).searchParams.get("year"));
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT y.*,u.name AS updated_by_name
       FROM siap_finance_yearly_summaries y
       LEFT JOIN siap_users u ON u.id=y.updated_by
       WHERE y.summary_year=? LIMIT 1`, [year]
    );
    const raw = rows[0] || null;
    const computed = await getFinanceYearSnapshot(year, false);
    return NextResponse.json({ ok:true,data:{ raw: raw ? {
      id:raw.id,
      summary_year:Number(raw.summary_year),
      calculation_mode:String(raw.calculation_mode),
      base_through_month:raw.base_through_month == null ? null : Number(raw.base_through_month),
      base_income_amount:Number(raw.base_income_amount||0),
      base_expense_amount:Number(raw.base_expense_amount||0),
      annual_budget_amount:Number(raw.annual_budget_amount||0),
      as_of_date:rawDateOnly(raw.as_of_date),
      notes:String(raw.notes||""),
      publish_status:String(raw.publish_status||"DRAFT"),
      updated_at:raw.updated_at,
      updated_by_name:raw.updated_by_name||null
    } : null, computed } });
  } catch (e) {
    return NextResponse.json({ ok:false,error:e instanceof Error?e.message:"Gagal memuat pengaturan tahun berjalan." }, { status:400 });
  }
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok:false,error:"Unauthorized" }, { status:401 });
  if (!canEditFinance(user.role)) return NextResponse.json({ ok:false,error:"Hanya Finance dan Root Admin yang dapat mengubah pengaturan tahun berjalan." }, { status:403 });
  try {
    const b = await request.json();
    const year = assertEditableFinanceYear(normalizeYear(b.summary_year));
    const mode = String(b.calculation_mode || "MANUAL") as FinanceCalculationMode;
    if (!["MANUAL","AUTO_MONTHLY","HYBRID"].includes(mode)) throw new Error("Mode perhitungan tidak valid.");
    const baseThroughRaw = Number(b.base_through_month || 0);
    const baseThrough:number|null = mode === "HYBRID" ? baseThroughRaw : null;
    if (mode === "HYBRID" && (!Number.isInteger(baseThroughRaw) || baseThroughRaw < 0 || baseThroughRaw > 12)) throw new Error("Batas basis bulan harus 0–12.");
    const baseIncome = money(b.base_income_amount);
    const baseExpense = money(b.base_expense_amount);
    const annualBudget = money(b.annual_budget_amount);
    const asOfDate = dateValue(b.as_of_date);
    const notes = String(b.notes || "").trim().slice(0,4000) || null;
    const publishStatus = String(b.publish_status || "PUBLISHED").toUpperCase();
    if (!["DRAFT","PUBLISHED"].includes(publishStatus)) throw new Error("Status publikasi tidak valid.");

    const [beforeRows] = await db.query<RowDataPacket[]>(`SELECT * FROM siap_finance_yearly_summaries WHERE summary_year=? LIMIT 1`, [year]);
    const before = beforeRows[0] || null;
    let id = String(before?.id || "");
    if (id) {
      await db.execute(
        `UPDATE siap_finance_yearly_summaries
         SET calculation_mode=?,base_through_month=?,base_income_amount=?,base_expense_amount=?,annual_budget_amount=?,as_of_date=?,notes=?,publish_status=?,updated_by=?
         WHERE id=?`,
        [mode,baseThrough,baseIncome,baseExpense,annualBudget,asOfDate,notes,publishStatus,user.id,id]
      );
    } else {
      id = crypto.randomUUID();
      await db.execute(
        `INSERT INTO siap_finance_yearly_summaries
         (id,summary_year,calculation_mode,base_through_month,base_income_amount,base_expense_amount,annual_budget_amount,as_of_date,notes,publish_status,created_by,updated_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,year,mode,baseThrough,baseIncome,baseExpense,annualBudget,asOfDate,notes,publishStatus,user.id,user.id]
      );
    }
    await auditLog({ userId:user.id,action:"FINANCE_YTD_SETTINGS_UPDATE",entityType:"FINANCE_YEARLY_SUMMARY",entityId:id,metadata:{
      year,
      before: before ? {calculation_mode:before.calculation_mode,base_through_month:before.base_through_month,base_income_amount:Number(before.base_income_amount||0),base_expense_amount:Number(before.base_expense_amount||0),annual_budget_amount:Number(before.annual_budget_amount||0),as_of_date:before.as_of_date,publish_status:before.publish_status} : null,
      after:{calculation_mode:mode,base_through_month:baseThrough,base_income_amount:baseIncome,base_expense_amount:baseExpense,annual_budget_amount:annualBudget,as_of_date:asOfDate,publish_status:publishStatus}
    },request });
    const computed = await getFinanceYearSnapshot(year, false);
    return NextResponse.json({ ok:true,data:{id,computed} });
  } catch (e) {
    return NextResponse.json({ ok:false,error:e instanceof Error?e.message:"Gagal menyimpan pengaturan tahun berjalan." }, { status:400 });
  }
}
