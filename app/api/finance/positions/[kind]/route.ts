import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canEditFinance, canSeeFinance } from "@/lib/permissions";
import { auditLog } from "@/lib/audit";
import { getLedgerPosition, ledgerMeta, normalizeKind } from "@/lib/finance-ledger";

export const runtime = "nodejs";

function money(v: unknown, label: string) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} harus berupa angka 0 atau lebih.`);
  return n;
}
function count(v: unknown, label: string) {
  const n = Number(v ?? 0);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} harus berupa bilangan 0 atau lebih.`);
  return n;
}
function dateOnly(v: unknown) {
  const s = String(v || "").slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Tanggal posisi tidak valid.");
  return s;
}

export async function GET(_request: Request, { params }: { params: { kind: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok:false,error:"Unauthorized" }, { status:401 });
  if (!canSeeFinance(user.role)) return NextResponse.json({ ok:false,error:"Forbidden" }, { status:403 });
  try {
    const kind = normalizeKind(params.kind);
    const data = await getLedgerPosition(kind);
    return NextResponse.json({ ok:true,data });
  } catch (e) {
    return NextResponse.json({ ok:false,error:e instanceof Error?e.message:"Gagal memuat posisi." }, { status:400 });
  }
}

export async function PATCH(request: Request, { params }: { params: { kind: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok:false,error:"Unauthorized" }, { status:401 });
  if (!canEditFinance(user.role)) return NextResponse.json({ ok:false,error:"Forbidden" }, { status:403 });
  try {
    const kind = normalizeKind(params.kind);
    const { ledgerType } = ledgerMeta(kind);
    const body = await request.json();
    const mode = String(body.mode || "").toUpperCase();
    if (!['SUMMARY','DETAIL'].includes(mode)) throw new Error("Mode data tidak valid.");
    await db.execute(
      `INSERT INTO siap_finance_source_modes(ledger_type,data_mode,updated_by)
       VALUES(?,?,?)
       ON DUPLICATE KEY UPDATE data_mode=VALUES(data_mode),updated_by=VALUES(updated_by),updated_at=CURRENT_TIMESTAMP`,
      [ledgerType,mode,user.id]
    );
    await auditLog({ userId:user.id,action:"FINANCE_SOURCE_MODE_UPDATE",entityType:"FINANCE_POSITION",entityId:ledgerType,metadata:{mode},request });
    return NextResponse.json({ ok:true,data:{mode} });
  } catch (e) {
    return NextResponse.json({ ok:false,error:e instanceof Error?e.message:"Gagal mengubah mode." }, { status:400 });
  }
}

export async function PUT(request: Request, { params }: { params: { kind: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok:false,error:"Unauthorized" }, { status:401 });
  if (!canEditFinance(user.role)) return NextResponse.json({ ok:false,error:"Forbidden" }, { status:403 });
  try {
    const kind = normalizeKind(params.kind);
    const { ledgerType } = ledgerMeta(kind);
    const b = await request.json();
    const asOfDate = dateOnly(b.as_of_date);
    const outstanding = money(b.outstanding_amount,"Total outstanding");
    const due30Amount = money(b.due_30_amount,"Jatuh tempo 30 hari");
    const due30Count = count(b.due_30_count,"Jumlah jatuh tempo");
    const a1 = money(b.aging_1_30_amount,"Aging 1-30");
    const a2 = money(b.aging_30_60_amount,"Aging 30-60");
    const a3 = money(b.aging_60_90_amount,"Aging 60-90");
    const a4 = money(b.aging_90_plus_amount,"Aging 90+");
    const overdue = a1+a2+a3+a4;
    if (overdue > outstanding) throw new Error("Total aging overdue tidak boleh melebihi total outstanding.");
    if (due30Amount > outstanding) throw new Error("Nilai jatuh tempo ≤30 hari tidak boleh melebihi total outstanding.");
    const notes = String(b.notes || "").trim().slice(0,4000) || null;

    const [existing] = await db.query<RowDataPacket[]>(
      `SELECT id FROM siap_finance_position_summaries WHERE ledger_type=? LIMIT 1`,[ledgerType]
    );
    let id = existing[0]?.id as string | undefined;
    if (id) {
      await db.execute(
        `UPDATE siap_finance_position_summaries
         SET as_of_date=?,outstanding_amount=?,due_30_amount=?,due_30_count=?,aging_1_30_amount=?,aging_30_60_amount=?,aging_60_90_amount=?,aging_90_plus_amount=?,notes=?,updated_by=?
         WHERE id=?`,
        [asOfDate,outstanding,due30Amount,due30Count,a1,a2,a3,a4,notes,user.id,id]
      );
    } else {
      id = crypto.randomUUID();
      await db.execute(
        `INSERT INTO siap_finance_position_summaries
         (id,ledger_type,as_of_date,outstanding_amount,due_30_amount,due_30_count,aging_1_30_amount,aging_30_60_amount,aging_60_90_amount,aging_90_plus_amount,notes,created_by,updated_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,ledgerType,asOfDate,outstanding,due30Amount,due30Count,a1,a2,a3,a4,notes,user.id,user.id]
      );
    }
    await auditLog({ userId:user.id,action:"FINANCE_POSITION_SUMMARY_UPDATE",entityType:"FINANCE_POSITION",entityId:id,metadata:{ledger_type:ledgerType,as_of_date:asOfDate,outstanding,overdue,due_30_amount:due30Amount,due_30_count:due30Count},request });
    return NextResponse.json({ ok:true,data:{id} });
  } catch (e) {
    return NextResponse.json({ ok:false,error:e instanceof Error?e.message:"Gagal menyimpan posisi." }, { status:400 });
  }
}
