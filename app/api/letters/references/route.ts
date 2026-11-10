import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { findLetterReferences } from "@/lib/business-document-data";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  if (kind !== "spk" && kind !== "support") {
    return NextResponse.json({ ok: false, error: "Jenis rujukan tidak valid." }, { status: 400 });
  }

  const data = await findLetterReferences(user, {
    kind,
    query: params.get("q")?.trim(),
    exclude: params.get("exclude")?.slice(0, 36),
  });
  return NextResponse.json({ ok: true, data });
}
