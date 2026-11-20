import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { withTransaction } from "@/lib/db";
import { dispositionAccess } from "@/lib/disposition-access";
import { listHistoryTasks, selectDispositionHistory } from "@/lib/disposition-history";
import { buildHistoryWorkbook, historyDownload } from "@/lib/history-workbook";

export const runtime = "nodejs";

export async function GET(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });

  try {
    const access = dispositionAccess(user);
    const book = await withTransaction(async conn => {
      const [[letter]] = await conn.query<RowDataPacket[]>(
        `SELECT l.id,l.subject,l.letter_number,l.external_number,l.confidentiality,
          COALESCE(f.name,t.name,l.document_type) AS type_name
         FROM siap_dispositions d JOIN siap_letters l ON l.id=d.letter_id
         LEFT JOIN siap_number_formats f ON f.id=l.number_format_id
         LEFT JOIN siap_document_types t ON t.code=l.document_type AND t.direction=l.direction
         WHERE d.id=? AND ${access.clause}`, [params.id, ...access.params],
      );
      if (!letter) return null;

      const visible = await listHistoryTasks(conn, user, [letter.id]);
      const selected = visible.find(row => row.id === params.id);
      if (!selected) return null;
      const tasks = selectDispositionHistory(visible, new Set([selected.id]));
      const book = await buildHistoryWorkbook(conn, user, letter, tasks, [letter], selected);
      await auditLog({ user, action: "DISPOSITION_EXPORT", entityType: "DISPOSITION", entityId: selected.id,
        metadata: { tasks: book.tasks, events: book.events, sourceEvents: book.sourceEvents,
          confidentiality: letter.confidentiality }, request }, conn);
      return book;
    });

    if (!book) return NextResponse.json({ ok: false, error: "Disposisi tidak ditemukan." }, { status: 404 });
    return historyDownload(book);
  } catch {
    return NextResponse.json({ ok: false, error: "Riwayat disposisi belum dapat diunduh." }, { status: 500 });
  }
}
