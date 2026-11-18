import crypto from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { letterAccess } from "@/lib/letter-access";
import type { SessionUser } from "@/lib/types";
import { deleteStoredFile, saveUpload } from "@/lib/upload";

export type StoredLetterFile = Awaited<ReturnType<typeof saveUpload>>;

export async function listLetterAttachments(conn: Pick<PoolConnection, "query">, user: SessionUser, letterId: string) {
  const access = letterAccess(user);
  const [files] = await conn.query<RowDataPacket[]>(
    `SELECT a.id,a.letter_action_id,a.attachment_kind,a.original_name,a.mime_type,a.original_size,
      a.stored_size,a.is_compressed,a.created_at,u.name AS uploaded_by_name,
      la.action AS process_action,la.from_status AS process_from_status,la.to_status AS process_to_status,
      CASE WHEN a.id=v.receipt_attachment_id THEN 'RECEIPT'
           WHEN a.id=v.spb_attachment_id THEN 'SPB'
           WHEN a.id=v.signature_attachment_id THEN 'SIGNED'
           WHEN a.id=v.dispatch_attachment_id THEN 'DISPATCH'
           ELSE a.attachment_kind END AS source_kind
     FROM siap_attachments a
     JOIN siap_letters l ON l.id=a.letter_id
     JOIN siap_users u ON u.id=a.uploaded_by
     LEFT JOIN siap_letter_actions la ON la.id=a.letter_action_id
     LEFT JOIN siap_v11_letters v ON v.letter_id=l.id
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
  kind: "ORIGINAL" | "ADDITIONAL" | "PROCESS",
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

export async function discardUncommittedFiles(files: StoredLetterFile[]) {
  await Promise.allSettled(files.map(file => deleteStoredFile(file.storagePath)));
}
