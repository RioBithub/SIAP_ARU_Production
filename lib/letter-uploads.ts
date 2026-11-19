import crypto from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { letterAccess } from "@/lib/letter-access";
import type { SessionUser } from "@/lib/types";
import { deleteStoredFile, saveUpload } from "@/lib/upload";

export type StoredLetterFile = Awaited<ReturnType<typeof saveUpload>>;

export const paymentAttachmentJoins = `
     LEFT JOIN siap_v11_letters v ON v.letter_id=a.letter_id
     LEFT JOIN siap_v11_payment_documents pd ON pd.attachment_id=a.id AND pd.letter_id=a.letter_id`;

// Older checklist uploads shared the ADDITIONAL kind. Their links and audit entries identify them.
export const paymentAttachmentKind = `CASE
     WHEN a.disposition_id IS NULL AND (
       a.id=v.spb_attachment_id OR pd.attachment_id IS NOT NULL OR
       (a.attachment_kind='ADDITIONAL' AND EXISTS (
         SELECT 1 FROM siap_audit_logs al WHERE al.entity_type='LETTER' AND al.entity_id=a.letter_id
           AND al.action='LETTER_PAYMENT_DOCUMENT'
           AND JSON_UNQUOTE(JSON_EXTRACT(al.metadata_json,'$.attachmentId'))=a.id
       ))
     ) THEN 'PAYMENT_DOCUMENT'
     ELSE a.attachment_kind END`;

export async function listLetterAttachments(conn: Pick<PoolConnection, "query">, user: SessionUser, letterId: string) {
  const access = letterAccess(user);
  const [files] = await conn.query<RowDataPacket[]>(
    `SELECT a.id,a.letter_action_id,a.attachment_kind,a.original_name,a.mime_type,a.original_size,
      a.stored_size,a.is_compressed,a.created_at,u.name AS uploaded_by_name,
      la.action AS process_action,la.from_status AS process_from_status,la.to_status AS process_to_status,
      CASE WHEN a.id=v.receipt_attachment_id THEN 'RECEIPT'
           WHEN a.id=v.signature_attachment_id THEN 'SIGNED'
           WHEN a.id=v.dispatch_attachment_id THEN 'DISPATCH'
           ELSE ${paymentAttachmentKind} END AS source_kind
     FROM siap_attachments a
     JOIN siap_letters l ON l.id=a.letter_id
     JOIN siap_users u ON u.id=a.uploaded_by
     LEFT JOIN siap_letter_actions la ON la.id=a.letter_action_id
     ${paymentAttachmentJoins}
     WHERE l.id=? AND a.disposition_id IS NULL AND ${access.clause}
     ORDER BY a.created_at ASC,a.id ASC`, [letterId, ...access.params],
  );
  return files;
}

export async function insertLetterAttachment(
  conn: PoolConnection,
  letterId: string,
  userId: string,
  file: StoredLetterFile,
  kind: "ORIGINAL" | "ADDITIONAL" | "PROCESS" | "PAYMENT_DOCUMENT",
  actionId: string | null = null,
) {
  const id = crypto.randomUUID();
  await conn.execute(
    `INSERT INTO siap_attachments
     (id,letter_id,letter_action_id,attachment_kind,original_name,stored_name,
      storage_path,mime_type,original_size,stored_size,is_compressed,uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, letterId, actionId, kind, file.originalName, file.storedName,
      file.storagePath, file.mimeType, file.originalSize, file.storedSize, file.isCompressed ? 1 : 0, userId],
  );
  return id;
}

export async function markPaymentAttachment(conn: PoolConnection, letterId: string, attachmentId: string | null) {
  if (!attachmentId) return;
  await conn.execute(
    "UPDATE siap_attachments SET attachment_kind='PAYMENT_DOCUMENT' WHERE id=? AND letter_id=? AND disposition_id IS NULL AND attachment_kind='ADDITIONAL'",
    [attachmentId, letterId],
  );
}

export async function discardUncommittedFiles(files: StoredLetterFile[]) {
  await Promise.allSettled(files.map(file => deleteStoredFile(file.storagePath)));
}
