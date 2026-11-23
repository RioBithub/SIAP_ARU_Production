import path from "node:path";
import { type CorrespondenceLayout, type SignatureLine } from "@/lib/correspondence-layout";

export const ARU_PAGE = { left: 72, right: 49.55, top: 91.5, bottom: 72, width: 595.3, height: 841.9 };
export const ARU_BODY_WIDTH = ARU_PAGE.width - ARU_PAGE.left - ARU_PAGE.right;
export const ARU_LETTERHEAD = { x: 19.3, top: 38.3, width: 202.5, height: 41.1 };
export const ARU_FOOTER = [
  "PT Aru Raharja, Gedung Wisma Raharja Lantai 9, Jl. TB Simatupang, Kav. 1, Cilandak Timur, Jakarta Selatan 12560",
  "Tel : +62-21-7818124, website : www.aruraharja.co.id, email : pusat@aruraharja.co.id",
];
export const ARU_FONT_SIZE = 11;
export const ARU_LINE_HEIGHT = 14;

export type CorrespondenceDocumentInput = {
  direction: "INTERNAL" | "OUTGOING";
  number: string | null;
  date: string;
  subject: string;
  body: string;
  recipient: string;
  confidentiality: string;
  author: string;
  authorTitle: string;
  reference?: string | null;
  layout: CorrespondenceLayout;
};

export function correspondenceLogoPath() {
  return path.join(process.cwd(), "public", "aru-letterhead.png");
}

export function correspondenceDocumentStem(input: Pick<CorrespondenceDocumentInput, "direction" | "number">, id: string) {
  const prefix = input.direction === "INTERNAL" ? "Nota-Dinas-" : "Surat-Keluar-";
  return prefix + (input.number || id.slice(0, 8)).replace(/[^A-Za-z0-9.-]/g, "-").slice(0, 120);
}

export function correspondenceColumnWidths(rows: string[][]) {
  const weights = rows[0].map((title, column) => Math.sqrt(Math.max(
    title.length, ...rows.slice(1).map(row => Math.min(140, row[column].length)), 1,
  )));
  const minWidth = 44;
  const flexWidth = ARU_BODY_WIDTH - minWidth * weights.length;
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map(weight => minWidth + flexWidth * weight / weightTotal);
}

function signatureRows(signers: SignatureLine[]) {
  const rows: SignatureLine[][] = [];
  for (const person of signers) {
    const row = rows.at(-1);
    if (row && !row.some(entry => entry.position === person.position)) row.push(person);
    else rows.push([person]);
  }
  return rows;
}

type MetadataField = { label: string; value: string; bold?: boolean };
export function correspondenceContent(input: CorrespondenceDocumentInput) {
  const { layout } = input;
  const internal = input.direction === "INTERNAL";
  const date = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(input.date + "T00:00:00Z"));
  const sifat = input.confidentiality.slice(0, 1) + input.confidentiality.slice(1).toLowerCase();
  const recipient = /^Yth[.\s]/i.test(input.recipient) ? input.recipient : "Yth. " + input.recipient;
  const number = input.number || "–";
  const fields: MetadataField[] = internal
    ? [
      { label: "Kepada", value: recipient },
      { label: "Dari", value: input.authorTitle || input.author },
      { label: "Nomor Surat", value: number },
      { label: "Tanggal", value: date },
      ...(input.confidentiality === "BIASA" ? [] : [{ label: "Sifat", value: sifat }]),
    ]
    : [{ label: "Nomor", value: number }, { label: "Sifat", value: sifat }];

  if (layout.enclosures) fields.push({ label: "Lampiran", value: layout.enclosures });
  fields.push({ label: internal ? "Perihal" : "Hal", value: input.subject, bold: true });
  if (internal && input.reference) fields.push({ label: "Rujukan", value: input.reference });

  return {
    title: internal ? "NOTA DINAS" : null,
    headingDate: internal ? null : [layout.place, date].filter(Boolean).join(", "),
    fields,
    labelWidth: internal ? 92 : 72,
    colonWidth: internal ? 11.5 : 7.5,
    address: internal ? null : [recipient, layout.address].filter(Boolean).join("\n"),
    closing: internal ? null : layout.closing,
    signatures: signatureRows(layout.signers.length ? layout.signers
      : [{ name: input.author, title: input.authorTitle, position: "LEFT" }]),
  };
}
