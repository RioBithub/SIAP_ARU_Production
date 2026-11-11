import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db";
import { letterAccess } from "@/lib/letter-access";
import {
  isInvoice, isSpk, MAX_SUPPORTING_LETTERS, normalizeInvoice, SPK_INCOMING, SPK_OUTGOING,
  type BusinessDocumentDetails, type DocumentReference, type InvoiceLine, type ReferenceKind,
} from "@/lib/business-documents";
import type { SessionUser } from "@/lib/types";

type Queryable = Pick<PoolConnection, "query">;

export async function findLetterReferences(
  user: SessionUser,
  options: { kind: ReferenceKind; ids?: string[]; query?: string; exclude?: string; includeCancelled?: boolean },
  conn: Queryable = db,
) {
  const access = letterAccess(user);
  const where = [access.clause];
  const params: string[] = [...access.params];
  if (options.kind === "spk") {
    where.push("l.direction IN ('INCOMING','OUTGOING') AND l.document_type IN (?,?)");
    params.push(SPK_INCOMING, SPK_OUTGOING);
  }
  if (options.kind === "source") where.push("l.direction IN ('INCOMING','INTERNAL')");
  if (!options.includeCancelled) where.push("l.status NOT IN ('CANCELLED','REJECTED')");
  if (options.exclude) {
    where.push("l.id<>?");
    params.push(options.exclude);
  }
  if (options.ids) {
    if (!options.ids.length) return [];
    where.push("l.id IN (" + options.ids.map(() => "?").join(",") + ")");
    params.push(...options.ids);
  }
  if (options.query) {
    const query = "%" + options.query.slice(0, 100) + "%";
    where.push("(l.subject LIKE ? OR l.letter_number LIKE ? OR l.external_number LIKE ? OR l.sender LIKE ? OR l.recipient LIKE ?)");
    params.push(query, query, query, query, query);
  }
  const [rows] = await conn.query<(RowDataPacket & DocumentReference)[]>(
    `SELECT l.id,l.direction,COALESCE(l.letter_number,l.external_number) AS number,l.subject,l.status
    FROM siap_letters l WHERE ${where.join(" AND ")}
    ORDER BY l.letter_date DESC,l.created_at DESC,l.id ${options.ids ? "" : "LIMIT 30"}`,
    params,
  );
  return rows;
}

export async function getBusinessDocumentRow(letterId: string, conn: Queryable = db) {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT b.*,DATE_FORMAT(b.due_date,'%Y-%m-%d') AS due_date_text FROM siap_business_documents b WHERE letter_id=?",
    [letterId],
  );
  return rows[0] ?? null;
}

async function getSupportingIds(letterId: string, conn: Queryable) {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT supporting_letter_id FROM siap_spk_letter_links WHERE spk_letter_id=?",
    [letterId],
  );
  return rows.map(row => String(row.supporting_letter_id));
}

export async function getBusinessDocumentDetails(user: SessionUser, letterId: string, documentType: string): Promise<BusinessDocumentDetails> {
  const row = await getBusinessDocumentRow(letterId);
  const supportingIds = isSpk(documentType) ? await getSupportingIds(letterId, db) : [];
  const supporting = await findLetterReferences(user, { kind: "support", ids: supportingIds, includeCancelled: true });
  const spkId = row?.invoice_spk_id as string | null | undefined;
  const [spkReference] = await findLetterReferences(user, { kind: "spk", ids: spkId ? [spkId] : [], includeCancelled: true });
  const items = typeof row?.items === "string" ? JSON.parse(row.items) : row?.items;
  return {
    managed: Boolean(row),
    invoice: isInvoice(documentType) && row ? {
      due_date: row.due_date_text,
      total: String(row.total),
      items: (items ?? []) as InvoiceLine[],
      requires_spk: Boolean(row.requires_spk),
      has_spk_reference: Boolean(spkId),
      spk_reference: spkReference ?? null,
    } : null,
    supporting_letters: supporting,
    hidden_supporting_count: supportingIds.length - supporting.length,
    signature_method: row?.signature_method ?? null,
  };
}

function referenceId(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !value.trim() || value.length > 36) throw new Error("Rujukan dokumen tidak valid.");
  return value.trim();
}

export async function saveBusinessDocument(
  conn: PoolConnection,
  user: SessionUser,
  letter: { id: string; document_type: string; direction: string },
  input: unknown,
  creating: boolean,
) {
  if (!isInvoice(letter.document_type) && !isSpk(letter.document_type)) return;
  if (input === undefined && !creating) return;
  if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input))) {
    throw new Error("Data SPK atau invoice tidak valid.");
  }
  const fields = (input ?? {}) as Record<string, unknown>;

  if (isInvoice(letter.document_type)) {
    const invoice = normalizeInvoice(fields, letter.direction === "OUTGOING");
    let spkId: string | null;
    if ("spk_reference_id" in fields || creating) {
      spkId = referenceId(fields.spk_reference_id);
      if (spkId) {
        const allowed = await findLetterReferences(user, { kind: "spk", ids: [spkId] }, conn);
        if (!allowed.length) throw new Error("SPK rujukan tidak tersedia atau Anda tidak memiliki akses.");
      }
    } else {
      const old = await getBusinessDocumentRow(letter.id, conn);
      spkId = old?.invoice_spk_id ?? null;
    }
    if (invoice.requires_spk && !spkId) throw new Error("Pilih SPK rujukan untuk invoice ini.");
    await conn.execute(
      `INSERT INTO siap_business_documents (letter_id,due_date,total,items,requires_spk,invoice_spk_id) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE due_date=VALUES(due_date),total=VALUES(total),items=VALUES(items),
       requires_spk=VALUES(requires_spk),invoice_spk_id=VALUES(invoice_spk_id)`,
      [letter.id, invoice.due_date, invoice.total, JSON.stringify(invoice.items), invoice.requires_spk ? 1 : 0, spkId],
    );
    return;
  }

  if (creating) {
    await conn.execute("INSERT INTO siap_business_documents (letter_id) VALUES (?)", [letter.id]);
  }
  if (!("supporting_letter_ids" in fields)) return;
  if (!Array.isArray(fields.supporting_letter_ids) || fields.supporting_letter_ids.length > MAX_SUPPORTING_LETTERS) {
    throw new Error("Maksimal " + MAX_SUPPORTING_LETTERS + " surat pendukung per SPK.");
  }
  const selected = [...new Set(fields.supporting_letter_ids.map(referenceId).filter((id): id is string => Boolean(id)))];
  const existing = await getSupportingIds(letter.id, conn);
  const visibleExisting = await findLetterReferences(user, { kind: "support", ids: existing, includeCancelled: true }, conn);
  const visibleIds = new Set(visibleExisting.map(row => row.id));
  const newIds = selected.filter(id => !visibleIds.has(id));
  const allowed = await findLetterReferences(user, { kind: "support", ids: newIds, exclude: letter.id }, conn);
  if (allowed.length !== newIds.length || selected.includes(letter.id)) {
    throw new Error("Salah satu surat pendukung tidak tersedia atau Anda tidak memiliki akses.");
  }
  // Keep links that the current editor is unable to see.
  const combined = [...new Set([...selected, ...existing.filter(id => !visibleIds.has(id))])];
  if (combined.length > MAX_SUPPORTING_LETTERS) throw new Error("Maksimal " + MAX_SUPPORTING_LETTERS + " surat pendukung per SPK.");
  await conn.execute("DELETE FROM siap_spk_letter_links WHERE spk_letter_id=?", [letter.id]);
  for (const id of combined) {
    await conn.execute("INSERT INTO siap_spk_letter_links (spk_letter_id,supporting_letter_id) VALUES (?,?)", [letter.id, id]);
  }
}
