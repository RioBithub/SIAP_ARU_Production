import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canEditFinance } from "@/lib/permissions";

export const runtime = "nodejs";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  if (!canEditFinance(user.role)) return NextResponse.json({ok:false,error:"Forbidden"},{status:403});
  return NextResponse.json({
    ok:false,
    error:"Fitur tutup/buka periode tidak digunakan lagi. Gunakan status Draft/Published untuk menentukan data aktif; koreksi periode tahun berjalan tetap diperbolehkan dan seluruh perubahan dicatat di Audit Log."
  },{status:410});
}
