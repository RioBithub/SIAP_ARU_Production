import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db";

export type BankStatementAccount = {
  id:string;
  bank_name:string;
  account_name:string;
  account_number:string;
  product_name:string|null;
  currency:string;
  branch_name:string|null;
  unit_name:string|null;
  company_address:string|null;
  opening_balance:number;
  opening_balance_date:string;
  is_active:number;
};

export type BankStatementRow = {
  id:string;
  transaction_at:string;
  description:string;
  teller_id:string|null;
  reference_no:string|null;
  debit_amount:number;
  credit_amount:number;
  notes:string|null;
  creator_name:string;
  balance:number;
};

function assertDate(v:string,label:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${label} tidak valid.`);
  return v;
}

export async function getBankStatement(accountId:string,fromRaw:string,toRaw:string){
  const from=assertDate(String(fromRaw||""),"Tanggal awal");
  const to=assertDate(String(toRaw||""),"Tanggal akhir");
  if(from>to) throw new Error("Tanggal awal tidak boleh melewati tanggal akhir.");

  const [accounts]=await db.query<RowDataPacket[]>(
    `SELECT *,DATE_FORMAT(opening_balance_date,'%Y-%m-%d') opening_balance_date_text
     FROM siap_bank_accounts WHERE id=? AND is_active=1 LIMIT 1`,[accountId]
  );
  const rawAccount=accounts[0];
  if(!rawAccount) throw new Error("Rekening tidak ditemukan atau sudah nonaktif.");

  const manualOpeningDate=String(rawAccount.opening_balance_date_text||rawAccount.opening_balance_date).slice(0,10);
  let anchorDate=manualOpeningDate;
  let anchorBalance=Number(rawAccount.opening_balance||0);
  let balanceSource:{type:"MANUAL"|"BRI_IMPORT";import_id?:string;period_from?:string;period_to?:string;statement_date?:string;official_closing_balance?:number}|null={type:"MANUAL"};

  const [anchorRows]=await db.query<RowDataPacket[]>(
    `SELECT id,DATE_FORMAT(statement_date,'%Y-%m-%d') statement_date_text,
            DATE_FORMAT(period_from,'%Y-%m-%d') period_from_text,DATE_FORMAT(period_to,'%Y-%m-%d') period_to_text,
            COALESCE(manual_opening_balance,statement_opening_balance) effective_opening,
            COALESCE(manual_closing_balance,statement_closing_balance) effective_closing
     FROM siap_bank_import_batches
     WHERE bank_account_id=? AND status='ACTIVE' AND period_from<=?
     ORDER BY period_to DESC,statement_date DESC,period_from DESC,created_at DESC
     LIMIT 1`,[accountId,from]
  );
  if(anchorRows[0]){
    const a=anchorRows[0];
    anchorDate=String(a.period_from_text);
    anchorBalance=Number(a.effective_opening||0);
    balanceSource={
      type:"BRI_IMPORT",import_id:String(a.id),period_from:String(a.period_from_text),period_to:String(a.period_to_text),
      statement_date:String(a.statement_date_text),official_closing_balance:Number(a.effective_closing||0)
    };
  }else if(from<manualOpeningDate){
    throw new Error(`Periode belum memiliki sumber saldo awal. Tanggal saldo manual saat ini ${manualOpeningDate}.`);
  }

  const [beforeRows]=await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(credit_amount-debit_amount),0) net
     FROM siap_bank_transactions
     WHERE bank_account_id=? AND status='ACTIVE'
       AND transaction_at>=CONCAT(?, ' 00:00:00')
       AND transaction_at<CONCAT(?, ' 00:00:00')`,
    [accountId,anchorDate,from]
  );
  const openingBalance=anchorBalance+Number(beforeRows[0]?.net||0);

  const [txRows]=await db.query<RowDataPacket[]>(
    `SELECT t.id,
            DATE_FORMAT(t.transaction_at,'%Y-%m-%d %H:%i:%s') transaction_at_text,
            t.description,t.teller_id,t.reference_no,t.debit_amount,t.credit_amount,t.notes,t.created_at,
            u.name creator_name
     FROM siap_bank_transactions t
     JOIN siap_users u ON u.id=t.created_by
     WHERE t.bank_account_id=? AND t.status='ACTIVE'
       AND t.transaction_at>=CONCAT(?, ' 00:00:00')
       AND t.transaction_at<DATE_ADD(CONCAT(?, ' 00:00:00'),INTERVAL 1 DAY)
     ORDER BY t.transaction_at ASC,t.created_at ASC`,
    [accountId,from,to]
  );

  let running=openingBalance;
  let totalDebit=0;
  let totalCredit=0;
  const rows:BankStatementRow[]=txRows.map((r:any)=>{
    const debit=Number(r.debit_amount||0);
    const credit=Number(r.credit_amount||0);
    totalDebit+=debit;
    totalCredit+=credit;
    running+=credit-debit;
    const rawNote=r.notes?String(r.notes):"";
    const visibleNote=/^Import BRI PDF:/i.test(rawNote)?null:(rawNote||null);
    return {
      id:String(r.id),
      transaction_at:String(r.transaction_at_text),
      description:String(r.description),
      teller_id:r.teller_id?String(r.teller_id):null,
      reference_no:r.reference_no?String(r.reference_no):null,
      debit_amount:debit,
      credit_amount:credit,
      notes:visibleNote,
      creator_name:String(r.creator_name||""),
      balance:running
    };
  });

  const account:BankStatementAccount={
    id:String(rawAccount.id),
    bank_name:String(rawAccount.bank_name),
    account_name:String(rawAccount.account_name),
    account_number:String(rawAccount.account_number),
    product_name:rawAccount.product_name?String(rawAccount.product_name):null,
    currency:String(rawAccount.currency||"IDR"),
    branch_name:rawAccount.branch_name?String(rawAccount.branch_name):null,
    unit_name:rawAccount.unit_name?String(rawAccount.unit_name):null,
    company_address:rawAccount.company_address?String(rawAccount.company_address):null,
    opening_balance:anchorBalance,
    opening_balance_date:anchorDate,
    is_active:Number(rawAccount.is_active||0)
  };

  return {
    account,
    period:{from,to},
    opening_balance:openingBalance,
    total_debit:totalDebit,
    total_credit:totalCredit,
    closing_balance:running,
    rows,
    balance_source:balanceSource,
    generated_at:new Date().toISOString()
  };
}

const SMALL=["","SATU","DUA","TIGA","EMPAT","LIMA","ENAM","TUJUH","DELAPAN","SEMBILAN","SEPULUH","SEBELAS"];
function spell(n:number):string{
  n=Math.floor(Math.abs(n));
  if(n<12) return SMALL[n];
  if(n<20) return `${spell(n-10)} BELAS`;
  if(n<100) return `${spell(Math.floor(n/10))} PULUH${n%10?` ${spell(n%10)}`:""}`;
  if(n<200) return `SERATUS${n-100?` ${spell(n-100)}`:""}`;
  if(n<1000) return `${spell(Math.floor(n/100))} RATUS${n%100?` ${spell(n%100)}`:""}`;
  if(n<2000) return `SERIBU${n-1000?` ${spell(n-1000)}`:""}`;
  if(n<1_000_000) return `${spell(Math.floor(n/1000))} RIBU${n%1000?` ${spell(n%1000)}`:""}`;
  if(n<1_000_000_000) return `${spell(Math.floor(n/1_000_000))} JUTA${n%1_000_000?` ${spell(n%1_000_000)}`:""}`;
  if(n<1_000_000_000_000) return `${spell(Math.floor(n/1_000_000_000))} MILIAR${n%1_000_000_000?` ${spell(n%1_000_000_000)}`:""}`;
  return `${spell(Math.floor(n/1_000_000_000_000))} TRILIUN${n%1_000_000_000_000?` ${spell(n%1_000_000_000_000)}`:""}`;
}

export function terbilangRupiah(value:number){
  const rounded=Math.round(Number(value||0));
  if(rounded===0) return "NOL RUPIAH";
  return `${rounded<0?"MINUS ":""}${spell(Math.abs(rounded)).replace(/\s+/g," ").trim()} RUPIAH`;
}
