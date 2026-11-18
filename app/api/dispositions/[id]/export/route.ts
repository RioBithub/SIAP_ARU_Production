import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { withTransaction } from "@/lib/db";
import { dispositionActionLabel, RESULT_REQUIREMENTS, type ResultRequirement } from "@/lib/correspondence-workflow";
import { dispositionAccess } from "@/lib/disposition-access";
import { letterAccess } from "@/lib/letter-access";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { safeFilename } from "@/lib/upload";
import { TASK_PURPOSES, type TaskPurpose } from "@/lib/v11-workflow";
import { dispositionDeadline, formatWorkflowTime } from "@/lib/workflow-time";

export const runtime = "nodejs";

type Cell = string | number;
type ReportTask = { row: RowDataPacket; number: string; parent: string };

function reportTasks(rows: RowDataPacket[], root: RowDataPacket) {
  const byParent = new Map<string, RowDataPacket[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const children = byParent.get(row.parent_id) || [];
    children.push(row);
    byParent.set(row.parent_id, children);
  }

  const seen = new Set<string>();
  const tasks: ReportTask[] = [{ row: root, number: "1", parent: "" }];
  for (const task of tasks) {
    seen.add(task.row.id);
    const children = (byParent.get(task.row.id) || []).filter(child => !seen.has(child.id));
    children.forEach((row, index) => {
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

export async function GET(request: Request, { params }: { params: { id: string } }) {
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

      const [visible] = await conn.query<RowDataPacket[]>(
        `SELECT d.id,d.parent_id,d.instruction,d.result_note,d.priority,d.visibility,d.status,d.result_requirement,
          DATE_FORMAT(d.due_date,'%Y-%m-%d') AS due_date,d.due_time,d.created_at,
          f.name AS from_name,t.name AS to_name,c.name AS owner_name,v.purpose
         FROM siap_dispositions d
         JOIN siap_users f ON f.id=d.from_user_id JOIN siap_users t ON t.id=d.to_user_id
         LEFT JOIN siap_users c ON c.id=d.current_owner_user_id
         LEFT JOIN siap_v11_dispositions v ON v.disposition_id=d.id
         WHERE d.letter_id=? AND ${access.clause}
         ORDER BY d.created_at,d.id`, [letter.id, ...access.params],
      );
      const root = visible.find(row => row.id === params.id);
      if (!root) return null;

      const tasks = reportTasks(visible, root);
      const taskNumbers = new Map(tasks.map(task => [task.row.id, task.number]));
      const ids = [...taskNumbers.keys()];
      const resultAccess = letterAccess(user);
      const [actions] = await conn.query<RowDataPacket[]>(
        `SELECT a.id,a.disposition_id,a.action,a.from_status,a.to_status,a.note,a.created_at,
          u.name AS actor_name,u.role AS actor_role,
          COALESCE(l.letter_number,l.external_number,l.subject) AS result_number
         FROM siap_disposition_actions a JOIN siap_users u ON u.id=a.actor_user_id
         LEFT JOIN siap_letters l ON l.id=a.result_letter_id AND ${resultAccess.clause}
         WHERE a.disposition_id IN (?)
         ORDER BY a.created_at,(a.action<>'CREATE'),a.id`, [...resultAccess.params, ids],
      );
      const [files] = await conn.query<RowDataPacket[]>(
        `SELECT a.id,a.disposition_id,a.disposition_action_id,a.original_name,a.created_at,u.name uploader
         FROM siap_attachments a JOIN siap_users u ON u.id=a.uploaded_by
         WHERE a.disposition_id IN (?) ORDER BY a.created_at,a.id`, [ids],
      );
      const actionRows = new Map(actions.map((action, index) => [action.id, index + 1]));

      const workbook = XLSX.utils.book_new();
      addSheet(workbook, "Ringkasan", [
        ["RIWAYAT DISPOSISI SIAP ARU", ""],
        ["Perihal", letter.subject],
        ["Nomor surat", letter.letter_number || letter.external_number || ""],
        ["Jenis dokumen", letter.type_name],
        ["Sifat surat", letter.confidentiality],
        ["Pemberi tugas", root.from_name],
        ["PIC awal", root.to_name],
        ["Posisi saat ini", root.owner_name || root.to_name],
        ["Status", root.status],
        ["Waktu dibuat", formatWorkflowTime(root.created_at)],
        ["Waktu unduh", formatWorkflowTime(new Date())],
      ], [29, 72]);
      addSheet(workbook, "Tugas", [
        ["Bagian", "Tugas induk", "Tujuan", "Pemberi tugas", "PIC awal", "Posisi saat ini",
          "Status", "Prioritas", "Visibilitas", "Tenggat", "Dibuat", "Hasil yang diminta", "Instruksi", "Ringkasan hasil"],
        ...tasks.map(({ row, number, parent }) => [
          number, parent, TASK_PURPOSES[row.purpose as TaskPurpose] || TASK_PURPOSES.GENERAL,
          row.from_name, row.to_name, row.owner_name || row.to_name, row.status, row.priority, row.visibility,
          dispositionDeadline(row.due_date, row.due_time), formatWorkflowTime(row.created_at),
          RESULT_REQUIREMENTS[row.result_requirement as ResultRequirement] || RESULT_REQUIREMENTS.SUMMARY,
          row.instruction, row.result_note || "",
        ]),
      ], [11, 14, 24, 26, 26, 26, 20, 12, 13, 27, 26, 32, 64, 64], true);
      addSheet(workbook, "Log Proses", [
        ["No.", "Bagian", "Waktu (WIB)", "Aksi", "Pelaku", "Peran", "Dari status", "Ke status", "Catatan", "Surat hasil"],
        ...actions.map((action, index) => [
          index + 1, taskNumbers.get(action.disposition_id)!, formatWorkflowTime(action.created_at),
          dispositionActionLabel(action.action), action.actor_name, ROLE_LABELS[action.actor_role as Role] || action.actor_role,
          action.from_status || "", action.to_status || "", action.note || "", action.result_number || "",
        ]),
      ], [7, 11, 26, 27, 28, 24, 20, 20, 72, 26], true);
      addSheet(workbook, "Lampiran", [
        ["Bagian", "No. log", "Nama file", "Diunggah oleh", "Waktu (WIB)"],
        ...files.map(file => [
          taskNumbers.get(file.disposition_id)!, actionRows.get(file.disposition_action_id) || "",
          file.original_name, file.uploader, formatWorkflowTime(file.created_at),
        ]),
      ], [11, 11, 50, 30, 26], true);

      const data: Buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
      await auditLog({ user, action: "DISPOSITION_EXPORT", entityType: "DISPOSITION", entityId: root.id,
        metadata: { tasks: tasks.length, events: actions.length, confidentiality: letter.confidentiality }, request }, conn);
      return { data, name: safeFilename(`riwayat-disposisi-${letter.confidentiality}-${root.id.slice(0, 8)}.xlsx`) };
    });

    if (!book) return NextResponse.json({ ok: false, error: "Disposisi tidak ditemukan." }, { status: 404 });
    return new Response(new Uint8Array(book.data), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${book.name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ ok: false, error: "Riwayat disposisi belum dapat diunduh." }, { status: 500 });
  }
}
