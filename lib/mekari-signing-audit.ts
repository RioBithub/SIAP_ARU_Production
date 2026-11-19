import type { RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db";

export type MekariSendFailureNotice = { message: string; audit_reference: string };

export async function latestMekariSendFailure(
  entityType: "ATTACHMENT" | "LETTER", entityId: string, status: string | undefined,
): Promise<MekariSendFailureNotice | null> {
  if (status !== "FAILED" && status !== "RECONCILE") return null;
  const failedAction = entityType + "_MEKARI_SEND_FAILED";
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT action, CAST(id AS CHAR) AS audit_reference,
       JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.message')) AS message
     FROM siap_audit_logs
     WHERE entity_type=? AND entity_id=? AND action IN (?,?)
     ORDER BY id DESC LIMIT 1`,
    [entityType, entityId, entityType + "_MEKARI_REQUEST", failedAction],
  );
  const entry = rows[0];
  return entry?.action === failedAction && typeof entry.message === "string"
    ? { message: entry.message, audit_reference: entry.audit_reference }
    : null;
}
