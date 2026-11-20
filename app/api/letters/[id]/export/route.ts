import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { canHandleSecretariat } from "@/lib/correspondence-workflow";
import { withTransaction } from "@/lib/db";
import { listHistoryTasks, selectDispositionHistory } from "@/lib/disposition-history";
import { buildHistoryWorkbook, historyDownload } from "@/lib/history-workbook";
import { letterAccess } from "@/lib/letter-access";

export const runtime = "nodejs";

export async function GET(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  if (!canHandleSecretariat(user.role)) {
    return NextResponse.json({ ok: false, error: "Ekspor tersedia untuk Sekretariat dan Root Admin." }, { status: 403 });
  }

  try {
    const access = letterAccess(user);
    const book = await withTransaction(async conn => {
      const [[letter]] = await conn.query<RowDataPacket[]>(
        `SELECT l.id,l.subject,l.letter_number,l.confidentiality,l.status,l.created_at,
          l.source_letter_id,l.source_disposition_id,COALESCE(f.name,t.name,l.document_type) AS type_name
         FROM siap_letters l
         LEFT JOIN siap_number_formats f ON f.id=l.number_format_id
         LEFT JOIN siap_document_types t ON t.code=l.document_type AND t.direction=l.direction
         WHERE l.id=? AND l.direction='OUTGOING' AND ${access.clause}`, [params.id, ...access.params],
      );
      if (!letter) return null;

      const [links] = await conn.query<RowDataPacket[]>(
        `SELECT DISTINCT d.id,d.letter_id
         FROM siap_dispositions d
         JOIN siap_letters l ON l.id=d.letter_id
         WHERE ${access.clause} AND (d.id=? OR EXISTS (
           SELECT 1 FROM siap_disposition_actions a WHERE a.disposition_id=d.id AND a.result_letter_id=?
         ))`, [...access.params, letter.source_disposition_id, letter.id],
      );
      const ids = [letter.id, ...new Set<string>(links.map(link => link.letter_id))];
      const visible = await listHistoryTasks(conn, user, ids, true);
      const linkedTasks = new Set(links.map(link => link.id));
      const anchors = new Set(visible.filter(task => task.letter_id === letter.id || linkedTasks.has(task.id)).map(task => task.id));
      const tasks = selectDispositionHistory(visible, anchors);
      const sourceIds = [...new Set<string>([letter.source_letter_id, ...tasks.map(task => task.letter_id)]
        .filter(id => id && id !== letter.id))];
      const sources = sourceIds.length ? (await conn.query<RowDataPacket[]>(
        `SELECT l.id,l.subject FROM siap_letters l WHERE l.id IN (?) AND ${access.clause} ORDER BY l.created_at,l.id`,
        [sourceIds, ...access.params],
      ))[0] : [];

      const report = await buildHistoryWorkbook(conn, user, letter, tasks, [letter, ...sources]);
      await auditLog({ user, action: "OUTGOING_HISTORY_EXPORT", entityType: "LETTER", entityId: letter.id,
        metadata: { tasks: report.tasks, events: report.events, documentEvents: report.sourceEvents }, request }, conn);
      return report;
    });

    if (!book) return NextResponse.json({ ok: false, error: "Surat Keluar tidak ditemukan." }, { status: 404 });
    return historyDownload(book);
  } catch {
    return NextResponse.json({ ok: false, error: "Riwayat Surat Keluar belum dapat diunduh." }, { status: 500 });
  }
}
