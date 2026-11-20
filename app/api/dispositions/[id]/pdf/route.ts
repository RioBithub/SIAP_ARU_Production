import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";
import { AruPdf, aruPdfResponse } from "@/lib/aru-pdf";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { dispositionActionLabel } from "@/lib/correspondence-workflow";
import { withTransaction } from "@/lib/db";
import { dispositionAccess } from "@/lib/disposition-access";
import { listDispositionEvents, listDispositionHistoryFiles, listHistoryTasks, selectDispositionHistory } from "@/lib/disposition-history";
import { getAccessibleLetter } from "@/lib/letter-access";
import { formatWorkflowTime, dispositionDeadline } from "@/lib/workflow-time";

export const runtime = "nodejs";

export async function GET(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  const access = dispositionAccess(user);
  try {
    const report = await withTransaction(async conn => {
      const [[document]] = await conn.query<RowDataPacket[]>(
        `SELECT l.id,l.subject,l.confidentiality,d.status,DATE_FORMAT(l.letter_date,'%Y-%m-%d') AS letter_date,
          COALESCE(l.letter_number,l.external_number) AS letter_number
         FROM siap_dispositions d JOIN siap_letters l ON l.id=d.letter_id WHERE d.id=? AND ${access.clause}`,
        [params.id, ...access.params],
      );
      if (!document) return { error: "Disposisi tidak ditemukan.", status: 404 } as const;
      if (document.status !== "COMPLETED") return { error: "PDF tersedia setelah disposisi selesai.", status: 409 } as const;
      const visible = await listHistoryTasks(conn, user, [document.id]);
      const selected = visible.find(task => task.id === params.id);
      if (!selected) return { error: "Disposisi tidak ditemukan.", status: 404 } as const;
      const tasks = selectDispositionHistory(visible, new Set([selected.id]));
      const [source, actions, files] = await Promise.all([
        getAccessibleLetter(user, document.id, conn),
        listDispositionEvents(conn, user, tasks.map(task => task.id)),
        listDispositionHistoryFiles(conn, tasks.map(task => task.id)),
      ]);
      const pdf = await AruPdf.create("LEMBAR DISPOSISI", `Disposisi selesai • ${selected.id.slice(0, 8).toUpperCase()}`, true);
      const formatDate = (value: string) => value?.split("-").reverse().join("/");
      pdf.fields([{ label: "Tanggal disposisi", value: formatWorkflowTime(selected.created_at) },
        { label: "Tanggal / nomor surat", value: [formatDate(document.letter_date), document.letter_number].filter(Boolean).join(" / ") },
        { label: "Asal", value: source?.sender }]);
      pdf.fields([{ label: "Perihal", value: document.subject },
        { label: "Diteruskan kepada", value: selected.to_name }, { label: "Dari", value: selected.from_name }]);
      pdf.classification(["Rahasia", "Penting", "Biasa"], document.confidentiality);
      if (source?.summary) {
        pdf.section("ISI RINGKAS");
        pdf.paragraph(source.summary);
      }
      pdf.section("INSTRUKSI / INFORMASI");
      pdf.paragraph(selected.instruction);
      pdf.fields([{ label: "Prioritas", value: selected.priority },
        { label: "Batas waktu", value: dispositionDeadline(selected.due_date, selected.due_time) }]);
      pdf.section("HASIL TINDAK LANJUT DAN PEMERIKSAAN");
      if (selected.result_note) pdf.paragraph(selected.result_note);
      for (const task of tasks) {
        pdf.fields([{ label: "Tahap disposisi", value: `${task.from_name} → ${task.to_name}` }]);
        for (const action of actions.filter(event => event.disposition_id === task.id &&
            ["SUBMIT_RESULT", "APPROVE_RESULT", "ROUTE_REVIEW_DIROPS", "RETURN_RESULT"].includes(event.action))) {
          pdf.paragraph([`${dispositionActionLabel(action.action)} • ${action.actor_name} • ${formatWorkflowTime(action.created_at)}`,
            action.note, action.result_number && "Dokumen hasil " + action.result_number].filter(Boolean).join("\n"));
        }
      }
      if (files.length) {
        pdf.section("LAMPIRAN TERCATAT");
        pdf.paragraph(files.map(file => file.original_name).join("\n"));
      }
      const bytes = await pdf.bytes();
      await auditLog({ user, action: "DISPOSITION_EXPORT_PDF", entityType: "DISPOSITION", entityId: selected.id, request }, conn);
      return { bytes } as const;
    });
    if ("error" in report) return NextResponse.json({ ok: false, error: report.error }, { status: report.status });
    return aruPdfResponse(report.bytes, `Lembar-Disposisi-${params.id.slice(0, 8)}.pdf`);
  } catch {
    return NextResponse.json({ ok: false, error: "Lembar disposisi belum dapat dibuat." }, { status: 500 });
  }
}
