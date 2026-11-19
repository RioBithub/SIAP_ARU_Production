import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import * as XLSX from "xlsx";
import { dispositionActionLabel, letterActionLabel, RESULT_REQUIREMENTS, type ResultRequirement } from "@/lib/correspondence-workflow";
import { listLetterActions } from "@/lib/correspondence-data";
import { listDispositionEvents, listDispositionHistoryFiles, type HistoryTask } from "@/lib/disposition-history";
import { ROLE_LABELS, type Role, type SessionUser } from "@/lib/types";
import { safeFilename } from "@/lib/upload";
import { TASK_PURPOSES, type TaskPurpose } from "@/lib/v11-workflow";
import { dispositionDeadline, formatWorkflowTime } from "@/lib/workflow-time";
import { listLetterAttachments } from "@/lib/letter-uploads";

type Cell = string | number;
type ReportTask = { row: HistoryTask; number: string; parent: string };

function reportTasks(rows: HistoryTask[]) {
  const byParent = new Map<string, HistoryTask[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const children = byParent.get(row.parent_id) || [];
    children.push(row);
    byParent.set(row.parent_id, children);
  }

  const ids = new Set(rows.map(row => row.id));
  const roots = rows.filter(row => !row.parent_id || !ids.has(row.parent_id));
  const tasks: ReportTask[] = roots.map((row, index) => ({ row, number: String(index + 1), parent: "" }));
  const seen = new Set(roots.map(row => row.id));
  for (const task of tasks) {
    const children = (byParent.get(task.row.id) || []).filter(child => !seen.has(child.id));
    children.forEach((row, index) => {
      seen.add(row.id);
      tasks.push({ row, number: task.number + "." + (index + 1), parent: task.number });
    });
  }
  return tasks;
}

function addSheet(book: XLSX.WorkBook, name: string, rows: Cell[][], widths: number[], filter = false) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = widths.map(wch => ({ wch }));
  if (filter && sheet["!ref"]) sheet["!autofilter"] = { ref: sheet["!ref"] };
  XLSX.utils.book_append_sheet(book, sheet, name);
}

export async function buildHistoryWorkbook(
  conn: PoolConnection, user: SessionUser, letter: RowDataPacket, rows: HistoryTask[],
  documents: RowDataPacket[], selected?: HistoryTask,
) {
  const tasks = reportTasks(rows);
  const taskNumbers = new Map(tasks.map(task => [task.row.id, task.number]));
  const ids = [...taskNumbers.keys()];
  const actions = await listDispositionEvents(conn, user, ids);
  const files = await listDispositionHistoryFiles(conn, ids);
  const actionRows = new Map(actions.map((action, index) => [action.id, index + 1]));
  const histories: {
    document: RowDataPacket;
    actions: Awaited<ReturnType<typeof listLetterActions>>;
    files: Awaited<ReturnType<typeof listLetterAttachments>>;
  }[] = [];
  const subjectByTask = new Map(rows.map(task => [task.id, task.subject]));
  for (const document of documents) {
    const actions = await listLetterActions(conn, user, document.id);
    const files = await listLetterAttachments(conn, user, document.id);
    histories.push({ document, actions, files });
  }

  const workbook = XLSX.utils.book_new();
  addSheet(workbook, "Ringkasan", [
    [selected ? "RIWAYAT DISPOSISI SIAP ARU" : "RIWAYAT SURAT KELUAR SIAP ARU", ""],
    ["Perihal", letter.subject],
    ["Nomor surat", letter.letter_number || letter.external_number || ""],
    ["Jenis dokumen", letter.type_name],
    ["Sifat surat", letter.confidentiality],
    ...(selected ? [
      ["Pemberi tugas", selected.from_name], ["PIC awal", selected.to_name],
      ["Posisi saat ini", selected.owner_name || selected.to_name],
    ] : []),
    ["Status", selected?.status || letter.status],
    ["Waktu dibuat", formatWorkflowTime(selected?.created_at ?? letter.created_at)],
    ["Waktu unduh", formatWorkflowTime(new Date())],
  ], [29, 72]);
  addSheet(workbook, "Tugas", [
    ["Bagian", "Tugas induk", "Tujuan", "Pemberi tugas", "PIC awal", "Posisi saat ini",
      "Status", "Prioritas", "Visibilitas", "Tenggat", "Dibuat", "Hasil yang diminta", "Instruksi", "Ringkasan hasil", "Dokumen tugas"],
    ...tasks.map(({ row, number, parent }) => [
      number, parent, TASK_PURPOSES[row.purpose as TaskPurpose] || TASK_PURPOSES.GENERAL,
      row.from_name, row.to_name, row.owner_name || row.to_name, row.status, row.priority, row.visibility,
      dispositionDeadline(row.due_date, row.due_time), formatWorkflowTime(row.created_at),
      RESULT_REQUIREMENTS[row.result_requirement as ResultRequirement] || RESULT_REQUIREMENTS.SUMMARY,
      row.instruction, row.result_note || "", row.subject,
    ]),
  ], [11, 14, 24, 26, 26, 26, 20, 12, 13, 27, 26, 32, 64, 64, 45], true);
  addSheet(workbook, "Log Proses", [
    ["No.", "Bagian", "Waktu (WIB)", "Aksi", "Pelaku", "Peran", "Dari status", "Ke status", "Catatan", "Surat hasil"],
    ...actions.map((action, index) => [
      index + 1, taskNumbers.get(action.disposition_id)!, formatWorkflowTime(action.created_at),
      dispositionActionLabel(action.action), action.actor_name, ROLE_LABELS[action.actor_role as Role] || action.actor_role,
      action.from_status || "", action.to_status || "", action.note || "", action.result_number || "",
    ]),
  ], [7, 11, 26, 27, 28, 24, 20, 20, 72, 26], true);
  const addDocumentLog = (name: string, documents: typeof histories) => {
    addSheet(workbook, name, [
      ["No.", "Waktu (WIB)", "Aksi", "Pelaku", "Peran", "Dari status", "Ke status", "Catatan", "Dokumen"],
      ...documents.flatMap(({ document, actions }) => actions.map((action, index) => [
        index + 1, formatWorkflowTime(action.created_at), letterActionLabel(action.action, action.to_status),
        action.actor_name, ROLE_LABELS[action.actor_role] || action.actor_role,
        action.from_status || "", action.to_status || "", action.comment || "", document.subject,
      ])),
    ], [7, 26, 28, 28, 24, 24, 24, 72, 45], true);
  };
  if (!selected) addDocumentLog("Riwayat Surat Keluar", histories.slice(0, 1));
  addDocumentLog("Riwayat Dokumen Asal", selected ? histories : histories.slice(1));
  addSheet(workbook, "Lampiran", [
    ["Bagian", "No. log", "Nama file", "Diunggah oleh", "Waktu (WIB)", "Dokumen"],
    ...histories.flatMap(({ document, actions, files }, index) => {
      const numbers = new Map(actions.map((action, position) => [action.id, position + 1]));
      return files.map(file => [
        selected || index > 0 ? "Surat asal" : "Surat keluar", numbers.get(file.letter_action_id) || "",
        file.original_name, file.uploaded_by_name, formatWorkflowTime(file.created_at), document.subject,
      ]);
    }),
    ...files.map(file => [
      taskNumbers.get(file.disposition_id)!, actionRows.get(file.disposition_action_id) || "",
      file.original_name, file.uploaded_by_name, formatWorkflowTime(file.created_at), subjectByTask.get(file.disposition_id) || "",
    ]),
  ], [15, 11, 50, 30, 26, 45], true);

  const data: Buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
  const prefix = selected ? "riwayat-disposisi" : "riwayat-surat-keluar";
  const id = selected?.id ?? letter.id;
  return {
    data, name: safeFilename(`${prefix}-${letter.confidentiality}-${id.slice(0, 8)}.xlsx`),
    tasks: tasks.length, events: actions.length,
    sourceEvents: histories.reduce((count, history) => count + history.actions.length, 0),
  };
}

export function historyDownload(book: { data: Buffer; name: string }) {
  return new Response(new Uint8Array(book.data), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${book.name}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
