import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { PURGE_CONFIRMATION } from "@/lib/correspondence-workflow";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { required } from "@/lib/http";
import { permanentlyDeleteLetter, retryPurgeFiles } from "@/lib/letter-purge";

export async function POST(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  if (user.role !== "ROOT_ADMIN") return NextResponse.json({ ok: false, error: "Khusus Root Admin." }, { status: 403 });

  try {
    const body = await request.json();
    if (!["trash", "restore", "purge"].includes(body.operation)) throw new Error("Aksi tidak dikenal.");
    const reason = required(body.reason, "Alasan", 1000);
    if (body.operation === "purge") {
      if (body.confirmation !== PURGE_CONFIRMATION) throw new Error("Ketik HAPUS PERMANEN untuk mengonfirmasi.");
      const result = await permanentlyDeleteLetter(user, params.id, reason, request);
      if ("error" in result) {
        return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      }
      const pending = await retryPurgeFiles(params.id).catch(() => null);
      return NextResponse.json({ ok: true, data: { pending } });
    }

    const trash = body.operation === "trash";
    const status = await withTransaction(async conn => {
      const [[letter]] = await conn.query<RowDataPacket[]>(
        "SELECT id,status,deleted_at,deletion_reason FROM siap_letters WHERE id=? FOR UPDATE", [params.id],
      );
      if (!letter) return 404;
      if (Boolean(letter.deleted_at) === trash) return 200;
      await conn.execute(
        `UPDATE siap_letters SET deleted_at=${trash ? "UTC_TIMESTAMP()" : "NULL"},
          deleted_by=?,deletion_reason=?,updated_by=? WHERE id=?`,
        [trash ? user.id : null, trash ? reason : null, user.id, params.id],
      );
      await auditLog({ user, action: trash ? "LETTER_TRASH" : "LETTER_RESTORE", entityType: "LETTER",
        entityId: letter.id, metadata: { reason, status: letter.status, priorReason: letter.deletion_reason }, request }, conn);
      return 200;
    });
    return NextResponse.json({ ok: status === 200, error: status === 404 ? "Surat tidak ditemukan." : undefined }, { status });
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const blocked = error.code === "ER_ROW_IS_REFERENCED_2" || error.code === "ER_ROW_IS_REFERENCED";
      return NextResponse.json({ ok: false,
        error: blocked ? "Surat masih terhubung ke data lain." : "Aksi pada surat belum dapat diproses." },
      { status: blocked ? 409 : 500 });
    }
    return NextResponse.json({ ok: false,
      error: error instanceof Error ? error.message : "Aksi pada surat belum dapat diproses." }, { status: 400 });
  }
}
