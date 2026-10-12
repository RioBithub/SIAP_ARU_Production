import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canSeeBankStatement } from "@/lib/permissions";
import { getBankStatement,terbilangRupiah } from "@/lib/bank-statement";

export const runtime="nodejs";

function today(){return new Date().toISOString().slice(0,10)}
function monthStart(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`}

export async function GET(request:Request){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if(!canSeeBankStatement(user.role)) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  try{
    const url=new URL(request.url);
    const accountId=String(url.searchParams.get("account_id")||"").trim();
    if(!accountId) throw new Error("Rekening wajib dipilih.");
    const data=await getBankStatement(accountId,url.searchParams.get("from")||monthStart(),url.searchParams.get("to")||today());
    return NextResponse.json({ok:true,data:{...data,terbilang:terbilangRupiah(data.closing_balance)}});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Gagal memuat rekening koran."},{status:400});
  }
}
