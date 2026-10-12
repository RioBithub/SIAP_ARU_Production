import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { canSeeBankStatement } from "@/lib/permissions";
import { getBankStatement,terbilangRupiah } from "@/lib/bank-statement";

export const runtime="nodejs";

const fmt=(n:number)=>Number(n||0);

export async function GET(request:Request){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canSeeBankStatement(user.role)) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  try{
    const url=new URL(request.url);
    const accountId=String(url.searchParams.get("account_id")||"").trim();
    const from=String(url.searchParams.get("from")||"").trim();
    const to=String(url.searchParams.get("to")||"").trim();
    if(!accountId) throw new Error("Rekening wajib dipilih.");
    const s=await getBankStatement(accountId,from,to);
    const a=s.account;
    const rows:any[][]=[
      ["PT ARU RAHARJA"],
      ["REKENING KORAN / BANK STATEMENT"],
      [],
      ["Nama Bank",a.bank_name,"Tanggal Laporan",new Date().toLocaleDateString("id-ID")],
      ["Nama Rekening",a.account_name,"Periode",`${from} s.d. ${to}`],
      ["Nomor Rekening",a.account_number,"Mata Uang",a.currency],
      ["Produk",a.product_name||"-","Unit/Kantor",a.unit_name||"-"],
      ["Cabang Bank",a.branch_name||"-","Alamat",a.company_address||"-"],
      [],
      ["Tanggal Transaksi","Uraian Transaksi","Teller/User ID","No. Referensi","Debit","Kredit","Saldo"]
    ];
    for(const r of s.rows){
      rows.push([r.transaction_at,r.description,r.teller_id||"",r.reference_no||"",fmt(r.debit_amount),fmt(r.credit_amount),fmt(r.balance)]);
    }
    rows.push([],["Saldo Awal","", "","", "","",fmt(s.opening_balance)]);
    rows.push(["Total Debit","", "","",fmt(s.total_debit),"",""]);
    rows.push(["Total Kredit","", "","","",fmt(s.total_credit),""]);
    rows.push(["Saldo Akhir","", "","", "","",fmt(s.closing_balance)]);
    rows.push(["Terbilang",terbilangRupiah(s.closing_balance)]);

    const ws=XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"]=[{wch:22},{wch:48},{wch:18},{wch:20},{wch:18},{wch:18},{wch:20}];
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Rekening Koran");
    const txSheet=XLSX.utils.json_to_sheet(s.rows.map(r=>({
      tanggal_transaksi:r.transaction_at,
      uraian:r.description,
      teller_user_id:r.teller_id||"",
      nomor_referensi:r.reference_no||"",
      debit:r.debit_amount,
      kredit:r.credit_amount,
      saldo:r.balance,
      input_oleh:r.creator_name
    })));
    txSheet["!cols"]=[{wch:22},{wch:48},{wch:18},{wch:20},{wch:18},{wch:18},{wch:20},{wch:22}];
    XLSX.utils.book_append_sheet(wb,txSheet,"Data Transaksi");
    const buffer=XLSX.write(wb,{bookType:"xlsx",type:"buffer"});
    const body=Uint8Array.from(buffer as Uint8Array);
    const safeAccount=a.account_number.replace(/[^A-Za-z0-9_-]/g,"-");
    const filename=`rekening-koran-${safeAccount}-${from}-${to}.xlsx`;
    return new NextResponse(body,{headers:{
      "Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":`attachment; filename=\"${filename}\"`,
      "Cache-Control":"no-store"
    }});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal membuat Excel rekening koran."},{status:400});
  }
}
