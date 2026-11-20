import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { withTransaction } from "@/lib/db";
import { callbackAuthorized, mekariMode, providerStatus } from "@/lib/mekari-sign";

export const runtime = "nodejs";

export async function POST(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const mode = mekariMode();
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!mode || !callbackAuthorized(params.id, token)) return NextResponse.json({ ok: false }, { status: 403 });
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 64 * 1024) return NextResponse.json({ ok: false }, { status: 413 });
      chunks.push(part.value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8")).data;
    const status = providerStatus(data?.attributes?.signing_status);
    const result = await withTransaction(async conn => {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT provider_id,mode FROM siap_v11_signing WHERE id=? FOR UPDATE", [params.id]);
      const job = rows[0];
      if (!job || !job.provider_id || job.mode !== mode || job.provider_id !== data?.id) return null;
      const key = createHash("sha256").update(JSON.stringify([job.provider_id, status])).digest("hex");
      const [saved] = await conn.execute<ResultSetHeader>(
        "INSERT IGNORE INTO siap_v11_signing_events (signing_id,event_key) VALUES (?,?)", [params.id, key],
      );
      if (saved.affectedRows > 0) {
        // A webhook is a notification. Only a server-side status read can authorize downloading a signed file.
        await conn.execute("UPDATE siap_v11_signing SET notification_at=UTC_TIMESTAMP() WHERE id=?", [params.id]);
      }
      return { duplicate: saved.affectedRows === 0 };
    });
    return result ? NextResponse.json({ ok: true, ...result }) : NextResponse.json({ ok: false }, { status: 409 });
  } catch (error) {
    return NextResponse.json({ ok: false }, { status: error instanceof SyntaxError ? 400 : 422 });
  } finally {
    await reader.cancel().catch(() => {});
  }
}
