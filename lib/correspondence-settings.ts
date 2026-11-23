import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db";
import type { NumberSourceSettings } from "@/lib/correspondence-number-source";

type Queryable = Pick<PoolConnection, "query">;
export const DEFAULT_INCOMING_RECIPIENT = "PT Aru Raharja";
export type IncomingRecipients = { defaultRecipient: string; recipients: string[] };

async function setting<T>(conn: Queryable, key: string): Promise<T | null> {
  const [[row]] = await conn.query<RowDataPacket[]>(
    "SELECT value_json FROM siap_correspondence_settings WHERE setting_key=?", [key],
  );
  if (!row) return null;
  return (typeof row.value_json === "string" ? JSON.parse(row.value_json) : row.value_json) as T;
}

export async function incomingRecipients(conn: Queryable = db): Promise<IncomingRecipients> {
  return await setting<IncomingRecipients>(conn, "incoming_recipients") ?? {
    defaultRecipient: DEFAULT_INCOMING_RECIPIENT, recipients: [DEFAULT_INCOMING_RECIPIENT],
  };
}

export function delegationKey(managerId: string) {
  return "delegate:" + managerId;
}

export function delegatedUsers(managerId: string, conn: Queryable = db) {
  return setting<string[]>(conn, delegationKey(managerId));
}

export async function numberSourceSettings(conn: Queryable = db): Promise<NumberSourceSettings> {
  return await setting<NumberSourceSettings>(conn, "number_source") ?? { source: "SIAP", sheetUrl: "" };
}
