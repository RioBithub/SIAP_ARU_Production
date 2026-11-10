import crypto from "crypto";
import type { PoolConnection } from "mysql2/promise";
import { deleteStoredFile, saveUpload } from "@/lib/upload";

export type StoredLetterFile = Awaited<ReturnType<typeof saveUpload>>;

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
