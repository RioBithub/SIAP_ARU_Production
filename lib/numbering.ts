import crypto from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db";

function romanMonth(month: number) {
  return ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"][month - 1];
}

function renderPattern(pattern: string, seqBase: number, variant: number, date: string, documentType: string) {
  const d = new Date(date + "T00:00:00Z");
  const seq = variant > 0 ? `${seqBase}.${variant}` : String(seqBase);
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  return pattern
    .replaceAll("{seq}", seq)
    .replaceAll("{month}", String(month).padStart(2, "0"))
    .replaceAll("{roman_month}", romanMonth(month))
    .replaceAll("{year}", String(year))
    .replaceAll("{short_year}", String(year).slice(-2))
    .replaceAll("{type}", documentType);
}

function nextVariant(rows: RowDataPacket[], seqBase: number) {
  const same = rows.filter(r => Number(r.seq_base) === seqBase);
  if (!same.length) return 0;
  return Math.max(...same.map(r => Number(r.variant))) + 1;
}

/**
 * Numbering policy:
 * - Each number format is an independent numbering series.
 * - Normal/current-date letters take the next base number.
 * - Backdated letters are inserted without shifting old numbers: the nearest
 *   occupied base gets .1, .2, ... as necessary.
 * - A user may request a custom numeric base (e.g. 135). If occupied in the
 *   same format/year, SIAP automatically uses 135.1, 135.2, ...
 * - sequence_start is controlled by Root Admin and acts as a minimum/starting
 *   automatic base for each format.
 */
export async function reserveOutgoingNumber(params: {
  conn: PoolConnection;
  formatId: string;
  letterId: string;
  letterDate: string;
  userId: string;
  documentType: string;
  requestedSeqBase?: number | null;
}) {
  const { conn, formatId, letterId, letterDate, userId, documentType, requestedSeqBase } = params;
  const year = Number(letterDate.slice(0, 4));
  const today = new Date().toISOString().slice(0,10);
  const isBackdated = letterDate < today;

  // Serialize generation inside the current transaction for this format.
  const [formats] = await conn.query<RowDataPacket[]>(
    "SELECT pattern,document_type,sequence_start FROM siap_number_formats WHERE id=? AND is_active=1 LIMIT 1 FOR UPDATE",
    [formatId]
  );
  if (!formats[0]) throw new Error("Format nomor surat tidak ditemukan / tidak aktif.");
  if (String(formats[0].document_type) !== documentType) throw new Error("Format nomor tidak sesuai dengan jenis dokumen.");
  const pattern = String(formats[0].pattern);
  const sequenceStart = Math.max(1, Number(formats[0].sequence_start || 1));

  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT seq_base,variant,DATE_FORMAT(letter_date,'%Y-%m-%d') AS letter_date
     FROM siap_number_ledger
     WHERE format_id=? AND number_year=?
     ORDER BY letter_date ASC, seq_base ASC, variant ASC
     FOR UPDATE`,
    [formatId, year]
  );

  let seqBase: number;
  let variant = 0;

  if (requestedSeqBase != null) {
    if (!Number.isInteger(requestedSeqBase) || requestedSeqBase < 1) throw new Error("Nomor dasar custom harus berupa angka bulat minimal 1.");
    seqBase = requestedSeqBase;
    variant = nextVariant(rows, seqBase);
  } else if (!rows.length) {
    seqBase = sequenceStart;
  } else if (!isBackdated) {
    const maxBase = Math.max(...rows.map(r => Number(r.seq_base)));
    seqBase = Math.max(sequenceStart, maxBase + 1);
  } else {
    // Historical insertion: keep existing numbering intact, use .1/.2 if the
    // historical base already exists.
    const candidates = rows.filter(r => String(r.letter_date) <= letterDate);
    if (candidates.length) {
      seqBase = Math.max(...candidates.map(r => Number(r.seq_base)));
    } else {
      seqBase = sequenceStart;
    }
    variant = nextVariant(rows, seqBase);
  }

  // Defensive collision loop. Usually unique slot already guarantees this,
  // but this keeps custom/backdate behavior deterministic.
  while (rows.some(r => Number(r.seq_base)===seqBase && Number(r.variant)===variant)) variant += 1;

  const rendered = renderPattern(pattern, seqBase, variant, letterDate, documentType);
  const ledgerId = crypto.randomUUID();
  await conn.execute(
    `INSERT INTO siap_number_ledger
     (id,format_id,letter_id,number_year,letter_date,seq_base,variant,rendered_number,status,created_by)
     VALUES (?,?,?,?,?,?,?,?, 'RESERVED', ?)`,
    [ledgerId, formatId, letterId, year, letterDate, seqBase, variant, rendered, userId]
  );
  return { ledgerId, rendered, seqBase, variant, displayNumber: variant > 0 ? `${seqBase}.${variant}` : String(seqBase) };
}

export async function cancelLedgerForLetter(letterId: string, reason: string) {
  await db.execute(
    `UPDATE siap_number_ledger SET status='CANCELLED', cancelled_reason=?
     WHERE letter_id=? AND status<>'CANCELLED'`,
    [reason.slice(0, 1000), letterId]
  );
}
