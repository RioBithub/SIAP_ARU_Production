import { NextResponse } from "next/server";
import { destroySession, getCurrentUser } from "@/lib/auth";
import { auditLog } from "@/lib/audit";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (user) await auditLog({ userId: user.id, action: "LOGOUT", entityType: "AUTH", entityId: user.id, request });
  await destroySession();
  return NextResponse.json({ ok: true });
}
