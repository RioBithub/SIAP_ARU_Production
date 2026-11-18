import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { previewOutgoingNumber } from "@/lib/numbering";
import { checkedDate } from "@/lib/v11-data";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const formatId = params.get("format_id");
  if (!formatId || formatId.length > 36) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const custom = params.get("base");
    const data = await previewOutgoingNumber(formatId,
      checkedDate(params.get("date"), "Tanggal Surat"), custom ? Number(custom) : undefined);
    return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error && !("code" in error)
      ? error.message : "Nomor belum dapat diperkirakan." }, { status: 400 });
  }
}
