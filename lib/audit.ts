import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { db } from "@/lib/db";
import { notifyWorkflow } from "@/lib/workflow-notifications";

export async function auditLog(params: {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  request?: Request;
}, conn: Pick<PoolConnection, "execute" | "query"> = db) {
  const { userId = null, action, entityType, entityId = null, metadata = null, request } = params;
  const ip = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request?.headers.get("x-real-ip")
    || null;
  const ua = request?.headers.get("user-agent")?.slice(0, 500) || null;
  const [result] = await conn.execute<ResultSetHeader>(
    `INSERT INTO siap_audit_logs
      (user_id,action,entity_type,entity_id,metadata_json,ip_address,user_agent)
     VALUES (?,?,?,?,?,?,?)`,
    [userId, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null, ip, ua]
  );
  await notifyWorkflow(conn, { auditId: result.insertId, actorId: userId, action, entityType, entityId });
}

export function safeAuditValue(value: unknown) {
  if (typeof value === "string") return value.slice(0, 1000);
  return value;
}
