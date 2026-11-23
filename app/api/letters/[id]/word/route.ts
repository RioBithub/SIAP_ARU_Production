import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { auditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { correspondenceDraft, senderTitle, wordSourceId } from "@/lib/correspondence-draft-data";
import { correspondenceDocumentStem, type CorrespondenceDocumentInput } from "@/lib/correspondence-document";
import { emptyCorrespondenceLayout } from "@/lib/correspondence-layout";
import { renderCorrespondenceWord, WORD_MIME_TYPE } from "@/lib/correspondence-word";
import { withTransaction } from "@/lib/db";
import { getAccessibleLetter } from "@/lib/letter-access";
import { notaAuthorId, notaDocument } from "@/lib/nota-document";
import { listNotaRecipients, notaPartyLabel } from "@/lib/nota-routing";
import type { SessionUser } from "@/lib/types";
import { v11Letter } from "@/lib/v11-data";

export const runtime = "nodejs";

async function legacyWordInput(conn: PoolConnection, letter: RowDataPacket, user: SessionUser,
  draft: Awaited<ReturnType<typeof correspondenceDraft>>): Promise<CorrespondenceDocumentInput> {
  const internal = letter.direction === "INTERNAL";
  const [[date]] = await conn.query<RowDataPacket[]>(
    "SELECT DATE_FORMAT(letter_date,'%Y-%m-%d') AS value FROM siap_letters WHERE id=?", [letter.id],
  );
  const workflow = internal ? await v11Letter(letter.id, conn) : null;
  const authorId = notaAuthorId(letter, workflow);
  const [[author]] = await conn.query<(RowDataPacket & Pick<SessionUser, "name" | "role" | "unit_name">)[]>(
    "SELECT name,unit_name,role FROM siap_users WHERE id=?", [authorId],
  );
  const recipients = internal && workflow ? await listNotaRecipients(conn, letter.id) : [];
  const reference = workflow?.kind === "NOTA_REPLY" && letter.source_letter_id
    ? await getAccessibleLetter(user, letter.source_letter_id, conn) : null;
  const layout = draft?.layout ?? emptyCorrespondenceLayout();
  return {
    direction: internal ? "INTERNAL" : "OUTGOING", number: letter.letter_number, date: date.value,
    subject: String(letter.subject), body: letter.summary ?? "",
    recipient: [letter.recipient, ...recipients.map(notaPartyLabel)].filter(Boolean).join("\n"),
    confidentiality: String(letter.confidentiality),
    author: draft?.slots[0]?.name || author?.name || letter.sender || "",
    authorTitle: author ? senderTitle(author) : letter.sender || "",
    reference: reference?.subject ?? null,
    layout,
  };
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Silakan masuk." }, { status: 401 });
  try {
    const source = new URL(request.url).searchParams.get("source");
    const result = await withTransaction(async conn => {
      const letter = await getAccessibleLetter(user, params.id, conn);
      if (!letter) return null;
      if (letter.direction !== "OUTGOING" && letter.direction !== "INTERNAL") return { sourceId: null };
      const draft = await correspondenceDraft(conn, letter.id);
      const nota = letter.direction === "INTERNAL" ? await notaDocument(conn, letter.id) : null;
      const activeId = letter.direction === "INTERNAL" ? nota?.source?.id : letter.active_original_attachment_id;
      const sourceId = wordSourceId(draft, activeId, nota?.sourceKind);
      if (!sourceId || (source && sourceId !== source)) return { sourceId: null };
      const input = draft?.attachmentId === sourceId && draft.documentSnapshot
        ? { ...draft.documentSnapshot, layout: draft.layout }
        : await legacyWordInput(conn, letter, user, draft?.attachmentId === sourceId ? draft : null);
      return { sourceId, input };
    });
    if (!result) return NextResponse.json({ ok: false, error: "Surat tidak dapat diakses." }, { status: 404 });
    if (!result.input) {
      return NextResponse.json({ ok: false, error: "Word hanya tersedia untuk versi dokumen aktif yang dibuat oleh SIAP." }, { status: 404 });
    }
    const bytes = await renderCorrespondenceWord(result.input);
    const filename = correspondenceDocumentStem(result.input, params.id) + ".docx";
    await auditLog({ user, action: "LETTER_DOWNLOAD_WORD", entityType: "LETTER", entityId: params.id,
      metadata: { sourceAttachmentId: result.sourceId }, request });
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": WORD_MIME_TYPE,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    console.error("Word persuratan belum dapat dirender.", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ ok: false, error: "Dokumen Word belum dapat dibuat." }, { status: 500 });
  }
}
