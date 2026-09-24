import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { canEditFinance, canSeeFinance } from "@/lib/permissions";
import { auditLog } from "@/lib/audit";
import { getLedgerPosition } from "@/lib/finance-ledger";
import { getFinanceYearSnapshot } from "@/lib/finance-summary";
import { assertEditableFinanceMonth, financeEditableWindow } from "@/lib/finance-period";

export const runtime = "nodejs";

function normalizeMonth(raw:string|null){
  const value=raw || new Date().toISOString().slice(0,7);
  if(!/^\d{4}-\d{2}$/.test(value)) throw new Error("Periode tidak valid.");
  const [year,month]=value.split("-").map(Number);
  if(year<2000 || year>2200 || month<1 || month>12) throw new Error("Periode tidak valid.");
  return `${value}-01`;
}
function money(v:unknown){
  const n=Number(v ?? 0);
  if(!Number.isFinite(n) || n<0) throw new Error("Nilai keuangan harus berupa angka 0 atau lebih.");
  return n;
}
function dateValue(v:unknown){
  const s=String(v||"").trim();
  if(!s)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new Error("Tanggal data tidak valid.");
  return s;
}
function dateOnly(v:unknown){if(!v)return null;if(v instanceof Date)return v.toISOString().slice(0,10);return String(v).slice(0,10);}

export async function GET(request:Request){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canSeeFinance(user.role)) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  try{
    const editor=canEditFinance(user.role);
    const period=normalizeMonth(new URL(request.url).searchParams.get("month"));
    const year=Number(period.slice(0,4));
    const [summaryRows]=await db.query<RowDataPacket[]>(
      `SELECT s.*,u.name AS updated_by_name
       FROM siap_finance_monthly_summaries s
       LEFT JOIN siap_users u ON u.id=s.updated_by
       WHERE s.period_month=? ${editor?"":"AND s.publish_status=\'PUBLISHED\'"} LIMIT 1`,[period]);
    const summary=summaryRows[0] || null;

    const [history]=await db.query<RowDataPacket[]>(
      `SELECT period_month,income_amount,expense_amount,budget_amount,(income_amount-expense_amount) AS profit_amount,
              data_date,include_in_ytd,publish_status,updated_at
       FROM siap_finance_monthly_summaries
       WHERE YEAR(period_month)=? ${editor?"":"AND publish_status=\'PUBLISHED\'"} ORDER BY period_month ASC`,[year]);

    const [recvPosition,payPosition,ytd]=await Promise.all([
      getLedgerPosition("receivables"),
      getLedgerPosition("payables"),
      getFinanceYearSnapshot(year,!editor)
    ]);

    const [docs]=await db.query<RowDataPacket[]>(
      `SELECT a.id,a.attachment_kind,a.original_name,a.mime_type,a.original_size,a.stored_size,a.is_compressed,a.created_at,u.name AS uploader_name
       FROM siap_finance_attachments a
       JOIN siap_users u ON u.id=a.uploaded_by
       ${summary?"WHERE a.summary_id=?":"WHERE 1=0"}
       ORDER BY a.created_at DESC`,summary?[summary.id]:[]);

    const [adjustments]=editor ? await db.query<RowDataPacket[]>(
      `SELECT a.id,a.metric,a.adjustment_type,a.amount,a.value_before,a.value_after,a.data_date,a.include_in_ytd_snapshot,
              a.note,a.reversed_adjustment_id,a.status,a.created_at,u.name AS created_by_name,
              (SELECT COUNT(*) FROM siap_finance_attachments fa WHERE fa.adjustment_id=a.id) AS attachment_count
       FROM siap_finance_adjustments a
       JOIN siap_users u ON u.id=a.created_by
       ${summary?"WHERE a.summary_id=?":"WHERE 1=0"}
       ORDER BY a.created_at DESC LIMIT 150`,summary?[summary.id]:[]) : [[] as RowDataPacket[],[] as any];

    return NextResponse.json({ok:true,data:{
      period,
      summary:summary ? {
        id:summary.id,
        period_month:dateOnly(summary.period_month),
        income_amount:Number(summary.income_amount||0),
        expense_amount:Number(summary.expense_amount||0),
        budget_amount:Number(summary.budget_amount||0),
        profit_amount:Number(summary.income_amount||0)-Number(summary.expense_amount||0),
        data_date:dateOnly(summary.data_date),
        include_in_ytd:Boolean(summary.include_in_ytd),
        publish_status:String(summary.publish_status||"DRAFT"),
        notes:summary.notes||"",
        updated_at:summary.updated_at,
        updated_by_name:summary.updated_by_name||"-"
      } : {id:null,period_month:period,income_amount:0,expense_amount:0,budget_amount:0,profit_amount:0,data_date:null,include_in_ytd:false,publish_status:"DRAFT",notes:"",updated_at:null,updated_by_name:null},
      ytd,
      history:history.map((r:any)=>({
        period_month:dateOnly(r.period_month),income_amount:Number(r.income_amount||0),expense_amount:Number(r.expense_amount||0),budget_amount:Number(r.budget_amount||0),profit_amount:Number(r.profit_amount||0),data_date:dateOnly(r.data_date),include_in_ytd:Boolean(r.include_in_ytd),publish_status:String(r.publish_status||"DRAFT"),updated_at:r.updated_at
      })),
      adjustments:adjustments.map((a:any)=>({...a,amount:Number(a.amount||0),value_before:Number(a.value_before||0),value_after:Number(a.value_after||0),include_in_ytd_snapshot:Boolean(a.include_in_ytd_snapshot),attachment_count:Number(a.attachment_count||0)})),
      receivables:{outstanding:Number(recvPosition.active.outstanding_amount||0),overdue:Number(recvPosition.active.overdue_amount||0),due_30_count:Number(recvPosition.active.due_30_count||0),due_30_amount:Number(recvPosition.active.due_30_amount||0)},
      payables:{outstanding:Number(payPosition.active.outstanding_amount||0),overdue:Number(payPosition.active.overdue_amount||0),due_30_count:Number(payPosition.active.due_30_count||0),due_30_amount:Number(payPosition.active.due_30_amount||0)},
      documents:docs,
      editable_window: financeEditableWindow()
    }});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal memuat data keuangan."},{status:400});
  }
}

export async function PUT(request:Request){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Hanya Finance dan Root Admin yang dapat mengubah ringkasan."},{status:403});
  try{
    const body=await request.json();
    const editablePeriod=assertEditableFinanceMonth(body.period_month);
    const period=editablePeriod.sqlDate;
    const notes=String(body.notes||"").trim().slice(0,4000) || null;
    const dataDate=dateValue(body.data_date) || new Date().toISOString().slice(0,10);
    const includeInYtd=body.include_in_ytd?1:0;
    const publishStatus=String(body.publish_status||"DRAFT").toUpperCase();
    if(!["DRAFT","PUBLISHED"].includes(publishStatus))throw new Error("Status publikasi tidak valid.");

    const result=await withTransaction(async conn=>{
      const [rows]=await conn.query<RowDataPacket[]>(`SELECT * FROM siap_finance_monthly_summaries WHERE period_month=? LIMIT 1 FOR UPDATE`,[period]);
      let current=rows[0]||null;
      let id=String(current?.id||"");
      if(!current){
        id=crypto.randomUUID();
        await conn.execute(`INSERT INTO siap_finance_monthly_summaries(id,period_month,data_date,include_in_ytd,publish_status,period_status,notes,created_by,updated_by) VALUES(?,?,?,?,?,'OPEN',?,?,?)`,[id,period,dataDate,includeInYtd,publishStatus,notes,user.id,user.id]);
        const [created]=await conn.query<RowDataPacket[]>(`SELECT * FROM siap_finance_monthly_summaries WHERE id=? FOR UPDATE`,[id]);
        current=created[0];
      }
      const nextIncome=body.income_amount===undefined?Number(current.income_amount||0):money(body.income_amount);
      const nextExpense=body.expense_amount===undefined?Number(current.expense_amount||0):money(body.expense_amount);
      const nextBudget=body.budget_amount===undefined?Number(current.budget_amount||0):money(body.budget_amount);
      const changes:Array<{metric:string,before:number,after:number}>=[
        {metric:"REVENUE",before:Number(current.income_amount||0),after:nextIncome},
        {metric:"EXPENSE",before:Number(current.expense_amount||0),after:nextExpense},
        {metric:"BUDGET",before:Number(current.budget_amount||0),after:nextBudget}
      ].filter(x=>x.before!==x.after);

      await conn.execute(`UPDATE siap_finance_monthly_summaries SET income_amount=?,expense_amount=?,budget_amount=?,data_date=?,include_in_ytd=?,publish_status=?,notes=?,updated_by=? WHERE id=?`,[nextIncome,nextExpense,nextBudget,dataDate,includeInYtd,publishStatus,notes,user.id,id]);
      for(const c of changes){
        await conn.execute(`INSERT INTO siap_finance_adjustments(id,summary_id,metric,adjustment_type,amount,value_before,value_after,data_date,include_in_ytd_snapshot,note,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?, 'ACTIVE',?)`,[
          crypto.randomUUID(),id,c.metric,"SET_TOTAL",c.after,c.before,c.after,dataDate,includeInYtd,"Set total melalui ringkasan bulanan",user.id
        ]);
      }
      return {id,before:{income:Number(current.income_amount||0),expense:Number(current.expense_amount||0),budget:Number(current.budget_amount||0),data_date:dateOnly(current.data_date),include_in_ytd:Boolean(current.include_in_ytd),publish_status:String(current.publish_status||"DRAFT")},after:{income:nextIncome,expense:nextExpense,budget:nextBudget,data_date:dataDate,include_in_ytd:Boolean(includeInYtd),publish_status:publishStatus},changes};
    });
    await auditLog({userId:user.id,action:"FINANCE_SUMMARY_UPDATE",entityType:"FINANCE_MONTHLY_SUMMARY",entityId:result.id,metadata:{period,before:result.before,after:result.after,changed_metrics:result.changes.map(c=>c.metric)},request});
    return NextResponse.json({ok:true,data:{id:result.id}});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal menyimpan ringkasan."},{status:400});
  }
}
