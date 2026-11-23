import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { bankWriteStatus, withBankAccountWrite } from "@/lib/bank-write";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  if (user.role !== "ROOT_ADMIN") {
    return NextResponse.json({ ok: false, error: "Hanya Root Admin yang dapat mengubah kunci rekening." }, { status: 403 });
  }
  try {
    const body = await request.json();
    const locked = body?.locked;
    if (typeof locked !== "boolean") throw new Error("Pilih status kunci yang valid.");
    await withBankAccountWrite(user.role, params.id, async (conn, account) => {
      const previous = Boolean(Number(account.finance_locked));
      if (locked === previous) return;
      await conn.execute("UPDATE siap_bank_accounts SET finance_locked=?,updated_by=? WHERE id=?",
        [Number(locked), user.id, params.id]);
      await auditLog({
        user, action: locked ? "BANK_ACCOUNT_LOCK" : "BANK_ACCOUNT_UNLOCK",
        entityType: "BANK_ACCOUNT", entityId: params.id, request,
        metadata: { financeLockedBefore: previous, financeLockedAfter: locked },
      }, conn);
    });
    return NextResponse.json({ ok: true, data: { finance_locked: Number(locked) } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Perubahan kunci gagal." },
      { status: bankWriteStatus(error) });
  }
}
