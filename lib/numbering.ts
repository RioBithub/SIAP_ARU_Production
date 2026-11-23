import crypto from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db";
import { parseRegisterSlot, REGISTER_SHEETS } from "@/lib/aru-register";
import { numberSourceSettings } from "@/lib/correspondence-settings";
import { readNumberRegister } from "@/lib/google-number-register";
import { NOTA_NUMBER_CODES, type RegisterNumber } from "@/lib/correspondence-number-source";
import { jakartaDate } from "@/lib/v11-workflow";

type Queryable = Pick<PoolConnection,"query">;
type Format = { code: string; document_type: string; pattern: string; sequence_start: number };

function isNotaSeries(code: string) {
  return NOTA_NUMBER_CODES.some(candidate => candidate === code);
}

export async function defaultNotaFormatId(conn: Queryable = db) {
  const [[format]] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM siap_number_formats WHERE is_active=1 AND (
      (code='UMUM' AND document_type='SURAT_UMUM') OR (code='OPS' AND document_type='SURAT_OPERASIONAL')
      OR (code='DIR' AND document_type='SURAT_DIREKSI')
    ) ORDER BY FIELD(code,'UMUM','OPS','DIR') LIMIT 1`,
  );
  if (!format) throw new Error("Aktifkan salah satu format nomor Bagian Umum, Operasional, atau Direksi untuk Nota Dinas.");
  return String(format.id);
}

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

function nextVariant(rows: RegisterNumber[], seqBase: number) {
  const same = rows.filter(r => Number(r.seq_base) === seqBase);
  if (!same.length) return 0;
  return Math.max(...same.map(r => Number(r.variant))) + 1;
}

function numberPlan(rows: RegisterNumber[], pattern: string, sequenceStart: number,
  letterDate: string, documentType: string, requestedSeqBase?: number | null) {
  const isBackdated = letterDate < jakartaDate();
  const dated = rows.filter(row => row.letter_date !== null);
  const highestBase = dated.reduce((max, row) => Math.max(max, Number(row.seq_base)), 0);
  let seqBase: number;
  let variant = 0;

  if (requestedSeqBase != null) {
    if (!Number.isInteger(requestedSeqBase) || requestedSeqBase < 1) throw new Error("Nomor dasar custom harus berupa angka bulat minimal 1.");
    seqBase = requestedSeqBase;
    variant = nextVariant(rows, seqBase);
  } else if (!isBackdated) {
    seqBase = Math.max(sequenceStart, highestBase + 1);
    // An entry without a readable year still occupies its slot.
    const reservedBases = new Set(rows.map(row => Number(row.seq_base)));
    while (reservedBases.has(seqBase)) seqBase++;
  } else {
    // Historical insertion: keep existing numbering intact, use .1/.2 if the
    // historical base already exists.
    const candidates = dated.filter(r => r.letter_date! <= letterDate);
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
  return { rendered, seqBase, variant, highestBase, displayNumber: variant > 0 ? `${seqBase}.${variant}` : String(seqBase) };
}

async function planFromRegister(conn: Queryable, format: Format, rows: RegisterNumber[], date: string,
  documentType: string, customBase?: number | null) {
  const config = REGISTER_SHEETS.find(sheet => sheet.formatCode === format.code && sheet.documentType === format.document_type);
  const settings = config ? await numberSourceSettings(conn) : null;
  const live = config && settings?.source === "SHEETS" ? (await readNumberRegister(settings.sheetUrl, [config]))[0] : null;
  const candidates = live ? rows.concat(live.rows.filter(row => !row.letter_date || row.letter_date.slice(0, 4) === date.slice(0, 4))) : rows;
  const pattern = live ? `${live.config.prefix}/{seq}/AR/{year}` : format.pattern;
  return {
    ...numberPlan(candidates, pattern, Math.max(1, Number(format.sequence_start || 1)), date, documentType, customBase),
    source: live ? "SHEETS" as const : "SIAP" as const,
  };
}

async function legacyNumbers(conn: Queryable, formatId: string, year: number): Promise<RegisterNumber[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT legacy_number_text,DATE_FORMAT(letter_date,'%Y-%m-%d') AS letter_date
     FROM siap_letters l WHERE number_format_id=? AND YEAR(letter_date)=?
       AND legacy_number_text IS NOT NULL AND NOT EXISTS (SELECT 1 FROM siap_number_ledger n WHERE n.letter_id=l.id)`,
    [formatId, year],
  );
  return rows.flatMap(row => {
    const slot = parseRegisterSlot(row.legacy_number_text);
    return slot ? [{ seq_base: slot.base, variant: slot.variant, letter_date: row.letter_date }] : [];
  });
}

export async function previewOutgoingNumber(formatId: string, date: string, customBase?: number) {
  const year = Number(date.slice(0, 4));
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT f.code, f.pattern, f.document_type, f.sequence_start, n.seq_base, n.variant,
            DATE_FORMAT(n.letter_date,'%Y-%m-%d') AS letter_date
     FROM siap_number_formats f LEFT JOIN siap_number_ledger n ON n.format_id=f.id AND n.number_year=?
     WHERE f.id=? AND f.is_active=1`, [year, formatId],
  );
  if (!rows.length) throw new Error("Format nomor surat tidak ditemukan atau tidak aktif.");
  const format = rows[0] as RowDataPacket & Format;
  const numbers = rows.filter(row => row.seq_base !== null) as RegisterNumber[];
  return { year, ...await planFromRegister(db, format,
    numbers.concat(await legacyNumbers(db, formatId, year)), date, format.document_type, customBase) };
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
export async function reserveLetterNumber(params: {
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

  // Serialize generation inside the current transaction for this format.
  const [formats] = await conn.query<(RowDataPacket & Format)[]>(
    "SELECT code,pattern,document_type,sequence_start FROM siap_number_formats WHERE id=? AND is_active=1 LIMIT 1 FOR UPDATE",
    [formatId]
  );
  const format = formats[0];
  if (!format) throw new Error("Format nomor surat tidak ditemukan / tidak aktif.");
  if (documentType === "NOTA_DINAS"
    ? !isNotaSeries(format.code) || !REGISTER_SHEETS.some(sheet => sheet.formatCode === format.code && sheet.documentType === format.document_type)
    : format.document_type !== documentType) throw new Error("Format nomor tidak sesuai dengan jenis dokumen.");

  const [rows] = await conn.query<(RowDataPacket & RegisterNumber)[]>(
    `SELECT seq_base,variant,DATE_FORMAT(letter_date,'%Y-%m-%d') AS letter_date
     FROM siap_number_ledger
     WHERE format_id=? AND number_year=?
     ORDER BY letter_date ASC, seq_base ASC, variant ASC
     FOR UPDATE`,
    [formatId, year]
  );

  const plan = await planFromRegister(conn, format, [...rows, ...await legacyNumbers(conn, formatId, year)],
    letterDate, documentType, requestedSeqBase);
  const { seqBase, variant, rendered } = plan;
  const ledgerId = crypto.randomUUID();
  await conn.execute(
    `INSERT INTO siap_number_ledger
     (id,format_id,letter_id,number_year,letter_date,seq_base,variant,rendered_number,status,created_by)
     VALUES (?,?,?,?,?,?,?,?, 'RESERVED', ?)`,
    [ledgerId, formatId, letterId, year, letterDate, seqBase, variant, rendered, userId]
  );
  return { ledgerId, ...plan };
}

export async function cancelLedgerForLetter(letterId: string, reason: string, conn: Pick<PoolConnection, "execute"> = db) {
  await conn.execute(
    `UPDATE siap_number_ledger SET status='CANCELLED', cancelled_reason=?
     WHERE letter_id=? AND status<>'CANCELLED'`,
    [reason.slice(0, 1000), letterId]
  );
}
