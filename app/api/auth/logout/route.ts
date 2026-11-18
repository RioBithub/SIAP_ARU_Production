import { NextResponse } from "next/server";
import { destroySession, getAuthSession } from "@/lib/auth";
import { auditLog } from "@/lib/audit";

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (session) await auditLog({
    user: session.owner, action: "LOGOUT", entityType: "AUTH", entityId: session.owner.id,
    metadata: session.targetId ? { impersonatedUserId: session.targetId } : null, request,
  });
  await destroySession();
  return NextResponse.json({ ok: true });
}
