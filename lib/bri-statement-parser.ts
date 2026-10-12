import crypto from "crypto";

export type BriStatementTransaction = {
  transaction_at:string;
  description:string;
  teller_id:string|null;
  debit_amount:number;
  credit_amount:number;
  balance_after:number;
  fingerprint:string;
};

export type ParsedBriStatement = {
  account_number:string;
  statement_date:string;
  period_from:string;
  period_to:string;
  product_name:string|null;
  currency:string|null;
  opening_balance:number;
  closing_balance:number;
  total_debit:number;
  total_credit:number;
  transactions:BriStatementTransaction[];
  warnings:string[];
};

function ymd(value:string){
  const m=value.trim().match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if(!m) throw new Error(`Tanggal BRI tidak valid: ${value}`);
  const day=m[1]!;
  const month=m[2]!;
  const yearPart=m[3]!;
  const yy=yearPart.length===2?`20${yearPart}`:yearPart;
  return `${yy}-${month}-${day}`;
}

function money(value:string){
  const n=Number(value.replace(/,/g,""));
  if(!Number.isFinite(n)) throw new Error(`Nominal BRI tidak valid: ${value}`);
  return n;
}

function capture(text:string,re:RegExp,label:string){
  const m=text.match(re);
  if(!m?.[1]) throw new Error(`${label} tidak terbaca dari PDF BRI.`);
  return m[1].trim();
}

function optionalCapture(text:string,re:RegExp){
  const m=text.match(re);
  return m?.[1]?.trim()||null;
}

function txFingerprint(accountNumber:string,tx:Omit<BriStatementTransaction,"fingerprint">){
  const source=[
    accountNumber.replace(/\D/g,""),
    tx.transaction_at,
    tx.description.replace(/\s+/g," ").trim().toUpperCase(),
    String(tx.teller_id||"").toUpperCase(),
    tx.debit_amount.toFixed(2),
    tx.credit_amount.toFixed(2),
    tx.balance_after.toFixed(2),
  ].join("|");
  return crypto.createHash("sha256").update(source).digest("hex");
}

function summaryAmounts(text:string){
  const lines=text.split(/\r?\n/);
  const start=lines.findIndex(l=>/Opening Balance/i.test(l)&&/Closing Balance/i.test(l));
  if(start<0) return null;
  for(let i=start+1;i<Math.min(lines.length,start+8);i++){
    const values=lines[i]?.match(/[0-9][0-9,]*\.\d{2}/g)||[];
    if(values.length>=4){
      const [opening,debit,credit,closing]=values;
      if(!opening||!debit||!credit||!closing) continue;
      return {
        opening:money(opening),
        debit:money(debit),
        credit:money(credit),
        closing:money(closing),
      };
    }
  }
  return null;
}

export function parseBriStatementText(textRaw:string):ParsedBriStatement{
  const text=String(textRaw||"").replace(/\u00a0/g," ");
  if(!/LAPORAN TRANSAKSI FINANSIAL/i.test(text)||!/STATEMENT OF FINANCIAL TRANSACTION/i.test(text)){
    throw new Error("PDF tidak dikenali sebagai Laporan Transaksi Finansial BRI.");
  }

  const accountNumber=capture(text,/No\.\s*Rekening\s*:\s*([0-9]+)/i,"Nomor rekening").replace(/\D/g,"");
  const statementDate=ymd(capture(text,/Tanggal Laporan\s*:\s*(\d{2}\/\d{2}\/\d{2,4})/i,"Tanggal laporan"));
  const periodMatch=text.match(/Periode Transaksi\s*:\s*(\d{2}\/\d{2}\/\d{2,4})\s*-\s*(\d{2}\/\d{2}\/\d{2,4})/i);
  if(!periodMatch?.[1]||!periodMatch?.[2]) throw new Error("Periode transaksi tidak terbaca dari PDF BRI.");
  const periodFrom=ymd(periodMatch[1]);
  const periodTo=ymd(periodMatch[2]);
  const productName=optionalCapture(text,/Nama Produk\s*:\s*(.+?)\s{2,}/i);
  const currency=optionalCapture(text,/Valuta\s*:\s*([A-Z]{3,10})/i);

  const rowRe=/^\s*(\d{2}\/\d{2}\/\d{2,4})\s+(\d{2}:\d{2}:\d{2})\s+(.+?)\s+([0-9,]+\.\d{2})\s+([0-9,]+\.\d{2})\s+([0-9,]+\.\d{2})\s*$/;
  const transactions:BriStatementTransaction[]=[];
  for(const line of text.split(/\r?\n/)){
    const m=line.match(rowRe);
    if(!m?.[1]||!m?.[2]||!m?.[3]||!m?.[4]||!m?.[5]||!m?.[6]) continue;
    const middle=m[3].trim();
    let description=middle;
    let tellerId:string|null=null;
    const split=middle.match(/^(.*\S)\s{2,}(\S+)$/);
    if(split?.[1]&&split?.[2]){
      description=split[1].trim();
      tellerId=split[2].trim();
    }else{
      const fallback=middle.match(/^(.*\S)\s+([A-Z0-9]{4,20})$/i);
      if(fallback?.[1]&&fallback?.[2]){description=fallback[1].trim();tellerId=fallback[2].trim();}
    }
    const base={
      transaction_at:`${ymd(m[1])} ${m[2]}`,
      description,
      teller_id:tellerId,
      debit_amount:money(m[4]),
      credit_amount:money(m[5]),
      balance_after:money(m[6]),
    };
    transactions.push({...base,fingerprint:txFingerprint(accountNumber,base)});
  }

  const summary=summaryAmounts(text);
  if(!transactions.length&&!summary) throw new Error("Transaksi dan ringkasan saldo tidak terbaca dari PDF BRI.");

  const warnings:string[]=[];
  const derivedDebit=transactions.reduce((s,t)=>s+t.debit_amount,0);
  const derivedCredit=transactions.reduce((s,t)=>s+t.credit_amount,0);
  const firstTx=transactions[0];
  const lastTx=transactions[transactions.length-1];
  const derivedOpening=firstTx
    ? firstTx.balance_after-firstTx.credit_amount+firstTx.debit_amount
    : Number(summary?.opening||0);
  const derivedClosing=lastTx?lastTx.balance_after:Number(summary?.closing||0);

  const opening=Number(summary?.opening??derivedOpening);
  const closing=Number(summary?.closing??derivedClosing);
  const totalDebit=Number(summary?.debit??derivedDebit);
  const totalCredit=Number(summary?.credit??derivedCredit);
  const diff=(a:number,b:number)=>Math.abs(a-b)>0.01;
  if(summary&&diff(summary.debit,derivedDebit)) warnings.push("Total debit PDF berbeda dengan penjumlahan baris transaksi.");
  if(summary&&diff(summary.credit,derivedCredit)) warnings.push("Total kredit PDF berbeda dengan penjumlahan baris transaksi.");
  if(transactions.length&&diff(opening+derivedCredit-derivedDebit,closing)) warnings.push("Saldo awal + mutasi tidak sama dengan saldo akhir PDF.");

  return {
    account_number:accountNumber,
    statement_date:statementDate,
    period_from:periodFrom,
    period_to:periodTo,
    product_name:productName,
    currency,
    opening_balance:opening,
    closing_balance:closing,
    total_debit:totalDebit,
    total_credit:totalCredit,
    transactions,
    warnings,
  };
}
