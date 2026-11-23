import type { SignatureAnnotation } from "@/lib/mekari-sign";

export const SIGNATURE_POSITIONS = ["LEFT", "CENTER", "RIGHT"] as const;
export const MAX_DOCUMENT_SIGNERS = 6;
export const DRAFT_LIMITS = { blocks: 8, columns: 6, rows: 25, heading: 60, cell: 240 };

export type SignatureLine = { name: string; title: string; position: typeof SIGNATURE_POSITIONS[number] };
export type DraftSignatureSlot = { name: string; annotation: SignatureAnnotation };
export type DocumentBlock = { type: "TEXT"; text: string } | { type: "TABLE"; rows: string[][] };
export type CorrespondenceLayout = {
  place: string;
  address: string;
  enclosures: string;
  copies: string;
  closing: string;
  blocks: DocumentBlock[];
  signers: SignatureLine[];
};

export function emptyCorrespondenceLayout(): CorrespondenceLayout {
  return {
    place: "Jakarta", address: "", enclosures: "", copies: "",
    closing: "Atas perhatian dan kerjasamanya, diucapkan terima kasih.",
    blocks: [], signers: [],
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Format isi dokumen tidak valid.");
  return value as Record<string, unknown>;
}

function field(value: unknown, max: number, fallback = "") {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > max) throw new Error("Isian draf melewati batas panjang atau formatnya tidak valid.");
  return value.trim();
}

export function checkedCorrespondenceLayout(value: unknown): CorrespondenceLayout {
  const defaults = emptyCorrespondenceLayout();
  if (value === undefined) return defaults;
  if (JSON.stringify(value).length > 80_000) throw new Error("Isi dan tabel draf terlalu panjang.");
  const input = object(value);
  const blocks = input.blocks ?? [];
  const signers = input.signers ?? [];
  if (!Array.isArray(blocks) || blocks.length > DRAFT_LIMITS.blocks) throw new Error("Maksimal 8 blok isi tambahan.");
  if (!Array.isArray(signers) || signers.length > MAX_DOCUMENT_SIGNERS) throw new Error("Maksimal 6 penandatangan.");

  return {
    place: field(input.place, 100, defaults.place),
    address: field(input.address, 400),
    enclosures: field(input.enclosures, 250),
    copies: field(input.copies, 1000),
    closing: field(input.closing, 500, defaults.closing),
    blocks: blocks.map((value): DocumentBlock => {
      const block = object(value);
      if (block.type === "TEXT") {
        const content = field(block.text, 5000);
        if (!content) throw new Error("Isi atau hapus blok paragraf yang kosong.");
        return { type: "TEXT", text: content };
      }
      if (block.type !== "TABLE" || !Array.isArray(block.rows) || block.rows.length < 2 || block.rows.length > DRAFT_LIMITS.rows + 1) {
        throw new Error("Tabel perlu judul kolom dan minimal satu baris isi.");
      }
      const first = block.rows[0];
      const cols = Array.isArray(first) ? first.length : 0;
      if (cols < 1 || cols > DRAFT_LIMITS.columns) throw new Error("Tabel perlu 1 sampai 6 kolom.");
      const rows = block.rows.map((row, index) => {
        if (!Array.isArray(row) || row.length !== cols) throw new Error("Jumlah kolom pada setiap baris tabel harus sama.");
        return row.map(cell => field(cell, index === 0 ? DRAFT_LIMITS.heading : DRAFT_LIMITS.cell).replace(/\s+/g, " "));
      });
      if (rows[0].some(cell => !cell)) throw new Error("Isi judul setiap kolom tabel.");
      if (!rows.slice(1).some(row => row.some(Boolean))) throw new Error("Isi minimal satu baris tabel.");
      return { type: "TABLE", rows };
    }),
    signers: signers.map(value => {
      const line = object(value);
      const name = field(line.name, 150);
      const title = field(line.title, 150);
      const position = SIGNATURE_POSITIONS.find(position => position === line.position);
      if (!name || !position) throw new Error("Isi nama dan posisi untuk setiap penandatangan.");
      return { name, title, position };
    }),
  };
}
