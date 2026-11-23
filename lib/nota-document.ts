import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { SessionUser } from "@/lib/types";

type Queryable = Pick<PoolConnection, "query">;
export const isNotaDraft = (letter: RowDataPacket) =>
  letter.direction === "INTERNAL" && ["DRAFT", "RETURNED_STAFF"].includes(letter.status);

export const notaAuthorId = (letter: RowDataPacket, workflow?: RowDataPacket | null): string =>
  workflow?.nota_author_user_id || letter.created_by;

export const canEditNotaDocument = (user: SessionUser, letter: RowDataPacket, workflow?: RowDataPacket | null) =>
  isNotaDraft(letter) && ([letter.created_by, notaAuthorId(letter, workflow)].includes(user.id)
    || (user.role === "STAFF" && workflow?.nota_drafter_user_id === user.id));

export const canUploadNotaSignature = (user: SessionUser, letter: RowDataPacket, workflow: RowDataPacket) =>
  canEditNotaDocument(user, letter, workflow) || (isNotaDraft(letter)
    && user.role === "SECRETARIAT" && workflow.nota_signature_assistant_user_id === user.id);

export const isDirectNota = (workflow?: RowDataPacket | null) =>
  workflow?.kind === "NOTA_REPLY" || workflow?.kind === "NOTA_DIRECT";

export const requiresNotaProof = (workflow: RowDataPacket) =>
  isDirectNota(workflow) || Boolean(workflow.nota_author_user_id);

export async function requireNotaSignature(conn: Queryable, letterId: string, workflow: RowDataPacket) {
  const document = await notaDocument(conn, letterId);
  if (!document?.source) throw new Error("Buat atau unggah PDF Nota Dinas terlebih dahulu.");
  if (document.signed) return;
  if (requiresNotaProof(workflow)) {
    throw new Error("Unggah PDF yang sudah bertanda tangan atau selesaikan tanda tangan di Mekari Sandbox.");
  }
  if (!document.manualReason) {
    throw new Error("Unggah PDF bertanda tangan, selesaikan Mekari Sandbox, atau catat tanda tangan manual.");
  }
}

export async function saveNotaSource(conn: PoolConnection, letterId: string, attachmentId: string | null,
  kind: "UPLOAD" | "GENERATED") {
  await conn.execute(
    `INSERT INTO siap_v11_nota_documents (letter_id,source_attachment_id,source_kind) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE source_attachment_id=VALUES(source_attachment_id),source_kind=VALUES(source_kind),manual_reason=NULL`,
    [letterId, attachmentId, kind],
  );
  await conn.execute(
    "UPDATE siap_v11_letters SET signature_attachment_id=NULL,signature_provenance=NULL WHERE letter_id=?",
    [letterId],
  );
}

export async function notaDocument(conn: Queryable, letterId: string) {
  const [[row]] = await conn.query<RowDataPacket[]>(
    `SELECT n.source_kind,n.manual_reason,a.id AS source_id,a.original_name,
       COALESCE(manual.id,signed.id) AS signed_id,
       COALESCE(manual.original_name,signed.original_name) AS signed_name,
       CASE WHEN manual.id IS NOT NULL THEN v.signature_provenance
            WHEN signed.id IS NOT NULL THEN 'MEKARI_SANDBOX' END AS method
     FROM siap_letters l LEFT JOIN siap_v11_nota_documents n ON n.letter_id=l.id
     LEFT JOIN siap_v11_letters v ON v.letter_id=l.id
     LEFT JOIN siap_attachments a ON a.letter_id=l.id AND a.disposition_id IS NULL AND a.attachment_kind='ORIGINAL'
       AND a.id=IF(n.letter_id IS NULL,COALESCE(l.active_original_attachment_id,
         (SELECT old.id FROM siap_attachments old WHERE old.letter_id=l.id AND old.disposition_id IS NULL
          AND old.attachment_kind='ORIGINAL' ORDER BY old.created_at DESC,old.id DESC LIMIT 1)),n.source_attachment_id)
       AND LOWER(a.original_name) LIKE '%.pdf'
     LEFT JOIN siap_v11_attachment_signing job ON job.source_attachment_id=a.id AND job.status='COMPLETED'
     LEFT JOIN siap_attachments signed ON signed.id=job.final_attachment_id AND signed.letter_id=l.id
     LEFT JOIN siap_attachments manual ON manual.id=v.signature_attachment_id AND manual.letter_id=l.id
       AND manual.disposition_id IS NULL AND v.signature_provenance IN ('DIGITAL','BASAH') AND a.id IS NOT NULL
     WHERE l.id=? AND l.direction='INTERNAL'`, [letterId],
  );
  if (!row) return null;
  return {
    source: row.source_id ? { id: String(row.source_id), original_name: String(row.original_name) } : null,
    sourceKind: row.source_kind as "UPLOAD" | "GENERATED" | null,
    signed: row.signed_id ? { id: String(row.signed_id), original_name: String(row.signed_name) } : null,
    method: row.method as "DIGITAL" | "BASAH" | "MEKARI_SANDBOX" | null,
    manualReason: (row.manual_reason as string | null) ?? null,
    needsSource: Boolean(row.source_kind && !row.source_id),
  };
}
