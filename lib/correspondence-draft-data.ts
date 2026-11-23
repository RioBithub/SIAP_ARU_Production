import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { CorrespondenceLayout, DraftSignatureSlot } from "@/lib/correspondence-layout";
import { renderCorrespondencePdf, type CorrespondencePdfInput } from "@/lib/correspondence-pdf";
import { insertLetterAttachment, type StoredLetterFile } from "@/lib/letter-uploads";
import { ROLE_LABELS, type SessionUser } from "@/lib/types";
import { saveProof } from "@/lib/v11-data";

export function senderTitle(person: Pick<SessionUser, "unit_name" | "role">) {
  const role = ROLE_LABELS[person.role];
  return person.unit_name && (person.role === "MANAGER" || person.role === "STAFF")
    ? role + " " + person.unit_name : role;
}

type StoredDraft = { layout: CorrespondenceLayout; slots: DraftSignatureSlot[]; attachmentId: string | null };
export async function correspondenceDraft(conn: Pick<PoolConnection, "query">, letterId: string): Promise<StoredDraft | null> {
  const [[row]] = await conn.query<RowDataPacket[]>(
    "SELECT generated_attachment_id,layout_json,signature_slots_json FROM siap_correspondence_drafts WHERE letter_id=?",
    [letterId],
  );
  return row ? {
    layout: JSON.parse(row.layout_json), slots: JSON.parse(row.signature_slots_json), attachmentId: row.generated_attachment_id,
  } : null;
}

export async function saveCorrespondencePdf(conn: PoolConnection, input: CorrespondencePdfInput & {
  id: string; userId: string;
}, staged: StoredLetterFile[]) {
  const internal = input.direction === "INTERNAL";
  if (!input.body && !input.layout.blocks.length) throw new Error("Isi dokumen atau tambahkan tabel sebelum membuat PDF.");
  if (!internal && !input.layout.signers.length) throw new Error("Isi minimal satu penandatangan Surat Keluar.");
  if (!input.recipient) throw new Error("Pilih tujuan dokumen terlebih dahulu.");
  const { bytes, slots } = await renderCorrespondencePdf(input);
  const name = (internal ? "Nota-Dinas-" : "Surat-Keluar-") +
    (input.number || input.id.slice(0, 8)).replace(/[^A-Za-z0-9.-]/g, "-") + ".pdf";
  const file = await saveProof(new File([new Uint8Array(bytes)], name, { type: "application/pdf" }), true, "ORIGINAL");
  staged.push(file);
  const id = await insertLetterAttachment(conn, input.id, input.userId, file, "ORIGINAL");
  await conn.execute(
    `INSERT INTO siap_correspondence_drafts (letter_id,generated_attachment_id,layout_json,signature_slots_json) VALUES (?,?,?,?)
      ON DUPLICATE KEY UPDATE generated_attachment_id=VALUES(generated_attachment_id),
        layout_json=VALUES(layout_json),signature_slots_json=VALUES(signature_slots_json)`,
    [input.id, id, JSON.stringify(input.layout), JSON.stringify(slots)],
  );
  await conn.execute("UPDATE siap_letters SET active_original_attachment_id=? WHERE id=?", [id, input.id]);
  return { id, name };
}

export function canEditOutgoingDraft(user: SessionUser, letter: RowDataPacket) {
  return letter.direction === "OUTGOING" && ["DRAFT", "RETURNED_STAFF"].includes(letter.status) &&
    (user.role === "ROOT_ADMIN" || letter.created_by === user.id);
}
