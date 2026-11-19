import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { AruPdf } from "@/lib/aru-pdf";
import type { SessionUser } from "@/lib/types";
import { saveProof } from "@/lib/v11-data";

type Queryable = Pick<PoolConnection, "query">;
export const canEditNotaDocument = (user: SessionUser, letter: RowDataPacket) =>
  letter.direction === "INTERNAL" && user.id === letter.created_by && ["DRAFT", "RETURNED_STAFF"].includes(letter.status);

export async function saveNotaSource(conn: PoolConnection, letterId: string, attachmentId: string | null,
  kind: "UPLOAD" | "GENERATED") {
  await conn.execute(
    `INSERT INTO siap_v11_nota_documents (letter_id,source_attachment_id,source_kind) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE source_attachment_id=VALUES(source_attachment_id),source_kind=VALUES(source_kind),manual_reason=NULL`,
    [letterId, attachmentId, kind],
  );
}

export async function notaDocument(conn: Queryable, letterId: string) {
  const [[row]] = await conn.query<RowDataPacket[]>(
    `SELECT n.source_kind,n.manual_reason,a.id AS source_id,a.original_name,signed.id AS signed_id,
       signed.original_name AS signed_name
     FROM siap_letters l LEFT JOIN siap_v11_nota_documents n ON n.letter_id=l.id
     LEFT JOIN siap_attachments a ON a.letter_id=l.id AND a.disposition_id IS NULL AND a.attachment_kind='ORIGINAL'
       AND a.id=IF(n.letter_id IS NULL,COALESCE(l.active_original_attachment_id,
         (SELECT old.id FROM siap_attachments old WHERE old.letter_id=l.id AND old.disposition_id IS NULL
          AND old.attachment_kind='ORIGINAL' ORDER BY old.created_at DESC,old.id DESC LIMIT 1)),n.source_attachment_id)
       AND LOWER(a.original_name) LIKE '%.pdf'
     LEFT JOIN siap_v11_attachment_signing job ON job.source_attachment_id=a.id AND job.status='COMPLETED'
     LEFT JOIN siap_attachments signed ON signed.id=job.final_attachment_id AND signed.letter_id=l.id
     WHERE l.id=? AND l.direction='INTERNAL'`, [letterId],
  );
  if (!row) return null;
  return {
    source: row.source_id ? { id: String(row.source_id), original_name: String(row.original_name) } : null,
    signed: row.signed_id ? { id: String(row.signed_id), original_name: String(row.signed_name) } : null,
    manualReason: (row.manual_reason as string | null) ?? null,
    needsSource: Boolean(row.source_kind && !row.source_id),
  };
}

export async function generatedNotaFile(input: {
  id: string; date: string; author: string; unit: string | null; recipient: string;
  subject: string; summary: string; confidentiality: string;
}) {
  const pdf = await AruPdf.create("NOTA DINAS", `Dokumen internal • ${input.confidentiality}`);
  pdf.fields([{ label: "Tanggal", value: input.date.split("-").reverse().join("/") },
    { label: "Unit pengirim", value: input.unit }]);
  pdf.fields([{ label: "Dari", value: input.author }, { label: "Kepada", value: input.recipient }]);
  pdf.fields([{ label: "Perihal", value: input.subject }]);
  pdf.section("ISI NOTA DINAS");
  pdf.paragraph(input.summary);
  pdf.signatureLines([{ label: "Pengirim", value: input.author }]);
  const bytes = await pdf.bytes();
  return saveProof(new File([new Uint8Array(bytes)], `Nota-Dinas-${input.id.slice(0, 8)}.pdf`), true, "ORIGINAL");
}
