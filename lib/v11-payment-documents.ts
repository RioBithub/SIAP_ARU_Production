import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { SessionUser } from "@/lib/types";
import { INVOICE_INCOMING, SPK_INCOMING, SPK_OUTGOING } from "@/lib/business-documents";
import { PERSEKOT_DOCUMENTS, type PaymentDocumentCode, type PaymentRecipient } from "@/lib/v11-workflow";

type Queryable = Pick<PoolConnection, "query">;

export function paymentKind(workflow: RowDataPacket | null, documentType: unknown) {
  if (!workflow) return null;
  if (documentType === INVOICE_INCOMING) return "INVOICE";
  if (workflow.kind === "PERSEKOT" || workflow.kind === "PAYMENT_REQUEST") return workflow.kind;
  return null;
}

export async function paymentDocuments(conn: Queryable, letterId: string, workflow: RowDataPacket,
  documentType: unknown) {
  const kind = paymentKind(workflow, documentType);
  if (!kind) return null;

  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT d.document_code,a.id,a.original_name
     FROM siap_v11_payment_documents d
     JOIN siap_attachments a ON a.id=d.attachment_id AND a.letter_id=d.letter_id AND a.disposition_id IS NULL
     WHERE d.letter_id=?`, [letterId],
  );
  const [targets] = await conn.query<RowDataPacket[]>(
    "SELECT recipient_type FROM siap_v11_payment_recipients WHERE letter_id=?", [letterId],
  );
  const target = targets[0]?.recipient_type as PaymentRecipient | undefined;
  const recipient = target ?? (kind === "INVOICE" ? "VENDOR" : null);

  const [links] = kind === "INVOICE" ? await conn.query<RowDataPacket[]>(
    `SELECT 1 FROM siap_business_documents b JOIN siap_letters spk ON spk.id=b.invoice_spk_id AND spk.deleted_at IS NULL
     WHERE b.letter_id=? AND spk.document_type IN (?,?)
       AND spk.status NOT IN ('CANCELLED','REJECTED')
       AND EXISTS (
         SELECT 1 FROM siap_attachments a LEFT JOIN siap_letter_actions signed ON signed.id=a.letter_action_id
         WHERE a.letter_id=spk.id AND a.disposition_id IS NULL
           AND (a.attachment_kind='ORIGINAL' OR signed.action='ISSUE')
       ) LIMIT 1`, [letterId, SPK_OUTGOING, SPK_INCOMING],
  ) : [[]];
  const [spb] = kind === "PERSEKOT" && workflow.spb_attachment_id ? await conn.query<RowDataPacket[]>(
    "SELECT id,original_name FROM siap_attachments WHERE id=? AND letter_id=? AND disposition_id IS NULL",
    [workflow.spb_attachment_id, letterId],
  ) : [[]];

  const documents = (Object.keys(PERSEKOT_DOCUMENTS) as PaymentDocumentCode[])
    .filter(code => code !== "SPB" || kind === "PERSEKOT")
    .map(code => {
      const row = code === "SPB" ? spb[0] : rows.find(item => item.document_code === code);
      const attachment = row ? { id: String(row.id), name: String(row.original_name) } : null;
      return {
        code, attachment, linked: code === "SPK" && links.length > 0,
        required: code !== "REKENING" || recipient === "VENDOR",
      };
    });
  const missing: string[] = documents.filter(doc => doc.required && !doc.attachment && !doc.linked)
    .map(doc => PERSEKOT_DOCUMENTS[doc.code]);
  if (!recipient) missing.unshift("Tujuan pembayaran (vendor atau nonvendor)");
  return { kind, recipient, documents, missing };
}

export async function requirePaymentDocuments(conn: Queryable, letterId: string, workflow: RowDataPacket, documentType: unknown) {
  const check = await paymentDocuments(conn, letterId, workflow, documentType);
  if (check?.missing.length) {
    throw new Error("Lengkapi persyaratan sebelum Finance memproses: " + check.missing.join(", ") + ".");
  }
}

export async function canEditPaymentDocuments(conn: Queryable, letter: RowDataPacket, user: SessionUser) {
  if (["CANCELLED", "REJECTED", "COMPLETED"].includes(letter.status)) return false;
  if (user.role === "ROOT_ADMIN" || user.id === letter.created_by || user.id === letter.current_owner_user_id ||
      (user.role === "SECRETARIAT" && letter.status === "SECRETARIAT_INTAKE")) return true;
  if (user.role === "MANAGER") {
    if (user.id === letter.routing_target_user_id) return true;
    const [managers] = await conn.query<RowDataPacket[]>(
      "SELECT 1 FROM siap_v11_managers WHERE scope='KSU' AND user_id=?", [user.id],
    );
    if (managers.length) return true;
  }
  if (user.role !== "STAFF") return false;
  const [tasks] = await conn.query<RowDataPacket[]>(
    `SELECT 1 FROM siap_dispositions WHERE letter_id=? AND to_user_id=?
     AND status IN ('UNSEEN','SEEN','IN_PROGRESS') LIMIT 1`, [letter.id, user.id],
  );
  return tasks.length > 0;
}

export type PaymentDocuments = NonNullable<Awaited<ReturnType<typeof paymentDocuments>>>;
