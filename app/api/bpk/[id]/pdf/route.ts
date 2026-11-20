import { NextResponse } from "next/server";
import { aruPdfResponse } from "@/lib/aru-pdf";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { bpkPayments, bpkRecord, getBpk, renderBpk } from "@/lib/bpk";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  try {
    const row = await getBpk(db, user, { id: params.id });
    if (!row) return NextResponse.json({ ok: false, error: "BPK tidak ditemukan." }, { status: 404 });
    const type = new URL(request.url).searchParams.get("type") === "spb" ? "SPB" : "BPK";
    if (type === "SPB" && row.mode !== "PERSEKOT") return NextResponse.json({ ok: false, error: "SPB hanya tersedia untuk persekot." }, { status: 409 });
    const record = bpkRecord(row, user, await bpkPayments(db, row.letter_id));
    const pdf = await renderBpk(record, type);
    await auditLog({ user, action: "BPK_EXPORT_PDF", entityType: "BPK", entityId: record.id, metadata: { type }, request });
    return aruPdfResponse(pdf, `${type}-${record.bpk_number || record.evidence_number || record.id.slice(0, 8)}.pdf`);
  } catch {
    return NextResponse.json({ ok: false, error: "PDF belum dapat dibuat." }, { status: 500 });
  }
}
