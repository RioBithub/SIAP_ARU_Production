import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { withTransaction } from "@/lib/db";
import { checkedCorrespondenceLayout } from "@/lib/correspondence-layout";
import { canEditOutgoingDraft, correspondenceDraft, saveCorrespondencePdf } from "@/lib/correspondence-draft-data";
import { getAccessibleLetter } from "@/lib/letter-access";
import { discardUncommittedFiles, type StoredLetterFile } from "@/lib/letter-uploads";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  const staged: StoredLetterFile[] = [];
  try {
    const body = await request.json();
    const result = await withTransaction(async conn => {
      const letter = await getAccessibleLetter(user, params.id, conn, true);
      if (!letter || !canEditOutgoingDraft(user, letter)) return null;
      if (!letter.letter_number) throw new Error("Nomor Surat Keluar belum tersedia.");
      const layout = body.document_layout === undefined
        ? (await correspondenceDraft(conn, params.id))?.layout ?? checkedCorrespondenceLayout(undefined)
        : checkedCorrespondenceLayout(body.document_layout);
      const [[row]] = await conn.query<RowDataPacket[]>(
        "SELECT DATE_FORMAT(letter_date,'%Y-%m-%d') date FROM siap_letters WHERE id=?", [params.id],
      );
      const file = await saveCorrespondencePdf(conn, {
        id: params.id, userId: user.id, direction: "OUTGOING", number: letter.letter_number, date: row.date,
        subject: letter.subject, body: letter.summary ?? "", recipient: letter.recipient ?? "",
        author: "", authorTitle: "", confidentiality: letter.confidentiality, layout,
      }, staged);
      await conn.execute("UPDATE siap_letters SET updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [user.id, params.id]);
      await conn.execute(
        `INSERT INTO siap_letter_actions (id,letter_id,actor_user_id,action,from_status,to_status,comment)
           VALUES (?,?,?,?,?,?,?)`,
        [randomUUID(), params.id, user.id, "GENERATE_OUTGOING_PDF", letter.status, letter.status, file.name],
      );
      await auditLog({ user, action: "LETTER_GENERATE_OUTGOING_PDF", entityType: "LETTER", entityId: params.id,
        metadata: { attachmentId: file.id }, request }, conn);
      return file;
    });
    staged.length = 0;
    return result ? NextResponse.json({ ok: true, data: result })
      : NextResponse.json({ ok: false, error: "Akun ini tidak dapat mengubah dokumen pada tahap ini." }, { status: 403 });
  } catch (error) {
    await discardUncommittedFiles(staged);
    return NextResponse.json({ ok: false, error: error instanceof Error && !("code" in error) ? error.message : "PDF belum dapat disimpan." },
      { status: 400 });
  }
}
