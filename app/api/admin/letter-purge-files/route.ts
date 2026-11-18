import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { pendingPurgeFiles, retryPurgeFiles } from "@/lib/letter-purge";

async function respond(retry: boolean) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ROOT_ADMIN") {
    return NextResponse.json({ ok: false, error: "Khusus Root Admin." }, { status: user ? 403 : 401 });
  }
  try {
    const pending = retry ? await retryPurgeFiles() : await pendingPurgeFiles();
    return NextResponse.json({ ok: true, data: { pending } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Pembersihan lampiran belum dapat diperiksa." }, { status: 500 });
  }
}

export async function GET() {
  return respond(false);
}

export async function POST() {
  return respond(true);
}
