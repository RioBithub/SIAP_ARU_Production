import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { type CorrespondenceLayout, type DraftSignatureSlot, type SignatureLine, SIGNATURE_POSITIONS } from "@/lib/correspondence-layout";

const [pageWidth, pageHeight] = PageSizes.A4;
const left = 72;
const right = pageWidth - 50;
const width = right - left;
const pageBottom = 70;
const size = 11;
const leading = 14;
const lineColor = rgb(0.45, 0.45, 0.45);
const footer = [
  "PT Aru Raharja, Gedung Wisma Raharja Lantai 9, Jl. TB Simatupang, Kav. 1, Cilandak Timur, Jakarta Selatan 12560",
  "Tel : +62-21-7818124, website : www.aruraharja.co.id, email : pusat@aruraharja.co.id",
];

export type CorrespondencePdfInput = {
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

async function bodyFonts(doc: PDFDocument) {
  const dir = process.env.ARU_ARIAL_FONT_DIR;
  let regular: Buffer | undefined;
  let bold: Buffer | undefined;
  if (dir) {
    try {
      [regular, bold] = await Promise.all([readFile(path.join(dir, "arial.ttf")), readFile(path.join(dir, "arialbd.ttf"))]);
    } catch {
      throw new Error("Berkas Arial untuk PDF belum tersedia. Hubungi administrator SIAP.");
    }
  } else {
    for (const root of ["/usr/share/fonts/truetype/liberation2", "/usr/share/fonts/truetype/liberation"]) {
      try {
        [regular, bold] = await Promise.all([
          readFile(path.join(root, "LiberationSans-Regular.ttf")), readFile(path.join(root, "LiberationSans-Bold.ttf")),
        ]);
        break;
      } catch (cause) {
        if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT")) throw cause;
      }
    }
  }
  if (regular && bold) {
    doc.registerFontkit(fontkit);
    return Promise.all([doc.embedFont(regular, { subset: true }), doc.embedFont(bold, { subset: true })]);
  }
  return Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
}

class CorrespondencePdf {
  private page!: PDFPage;
  private y = 0;
  private readonly characters: Set<number>;
  readonly slots: DraftSignatureSlot[] = [];

  constructor(private readonly doc: PDFDocument, private readonly font: PDFFont, private readonly bold: PDFFont,
    private readonly logo: PDFImage) {
    this.characters = new Set(font.getCharacterSet());
    this.newPage();
  }

  private newPage() {
    this.page = this.doc.addPage(PageSizes.A4);
    const logo = this.logo.scaleToFit(145, 34);
    this.page.drawImage(this.logo, { x: left, y: pageHeight - 70, ...logo });
    this.y = pageHeight - 92;
  }

  private reserve(height: number) {
    if (this.y - height < pageBottom) this.newPage();
  }

  private visible(value: string) {
    return Array.from(value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, " "))
      .map(char => char === "\n" || this.characters.has(char.codePointAt(0)!) ? char : "·").join("");
  }

  private wrap(value: string, maxWidth: number, font: PDFFont) {
    const lines: string[] = [];
    for (const paragraph of this.visible(value).split("\n")) {
      let row = "";
      for (const word of paragraph.trim().split(/\s+/)) {
        const next = row ? row + " " + word : word;
        if (font.widthOfTextAtSize(next, size) <= maxWidth) {
          row = next;
          continue;
        }
        if (row) lines.push(row);
        row = "";
        for (const char of word) {
          if (font.widthOfTextAtSize(row + char, size) > maxWidth) {
            lines.push(row);
            row = "";
          }
          row += char;
        }
      }
      lines.push(row);
    }
    return lines;
  }

  private text(value: string, x: number, y: number, font: PDFFont = this.font) {
    if (value) this.page.drawText(value, { x, y, font, size });
  }

  gap(amount = 10) { this.y -= amount; }

  paragraph(text: string, options: { bold?: boolean; align?: "center" | "right"; space?: number } = {}) {
    const font = options.bold ? this.bold : this.font;
    for (const row of this.wrap(text, width, font)) {
      this.reserve(leading);
      const textWidth = font.widthOfTextAtSize(row, size);
      const x = options.align === "center" ? left + (width - textWidth) / 2
        : options.align === "right" ? right - textWidth : left;
      this.text(row, x, this.y - size, font);
      this.y -= leading;
    }
    this.gap(options.space ?? 7);
  }

  field(label: string, value: string, isBold = false) {
    const valueX = left + 113;
    const font = isBold ? this.bold : this.font;
    const lines = this.wrap(value, right - valueX, font);
    for (const [index, row] of lines.entries()) {
      this.reserve(leading);
      if (index === 0) {
        this.text(label, left, this.y - size);
        this.text(":", valueX - 13, this.y - size);
      }
      this.text(row, valueX, this.y - size, font);
      this.y -= leading;
    }
  }

  table(rows: string[][]) {
    const weights = rows[0].map((title, column) => Math.sqrt(Math.max(
      title.length, ...rows.slice(1).map(row => Math.min(140, row[column].length)), 1,
    )));
    const minWidth = 44;
    const flexWidth = width - minWidth * weights.length;
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    const columnWidths = weights.map(weight => minWidth + flexWidth * weight / weightTotal);
    const prepare = (row: string[], font: PDFFont) => row.map((value, index) => this.wrap(value, columnWidths[index] - 12, font));
    const height = (cells: string[][]) => 10 + Math.max(...cells.map(lines => lines.length)) * leading;
    const header = prepare(rows[0], this.bold);
    const headerHeight = height(header);
    const draw = (cells: string[][], font: PDFFont, heading = false) => {
      const h = height(cells);
      let x = left;
      cells.forEach((lines, index) => {
        this.page.drawRectangle({ x, y: this.y - h, width: columnWidths[index], height: h,
          borderColor: lineColor, borderWidth: .55, color: heading ? rgb(.94, .94, .94) : undefined });
        lines.forEach((line, i) => this.text(line, x + 6, this.y - size - 4 - i * leading, font));
        x += columnWidths[index];
      });
      this.y -= h;
    };
    let needsHeader = true;
    for (const row of rows.slice(1)) {
      const cells = prepare(row, this.font);
      if (this.y - height(cells) - (needsHeader ? headerHeight : 0) < pageBottom) {
        this.newPage();
        needsHeader = true;
      }
      if (needsHeader) draw(header, this.bold, true);
      const lineCount = Math.max(...cells.map(cell => cell.length));
      for (let start = 0; start < lineCount;) {
        const fit = Math.floor((this.y - pageBottom - 10) / leading);
        draw(cells.map(cell => cell.slice(start, start + fit)), this.font);
        start += fit;
        if (start < lineCount) {
          this.newPage();
          draw(header, this.bold, true);
        }
      }
      needsHeader = false;
    }
    this.gap();
  }

  signatures(signers: SignatureLine[]) {
    const rows: SignatureLine[][] = [];
    for (const person of signers) {
      const row = rows.at(-1);
      if (row && !row.some(entry => entry.position === person.position)) row.push(person);
      else rows.push([person]);
    }
    const columnWidth = width / SIGNATURE_POSITIONS.length;
    for (const [index, row] of rows.entries()) {
      const lines = row.map(person => ({
        person, name: this.wrap(person.name, columnWidth - 12, this.bold),
        title: person.title ? this.wrap(person.title, columnWidth - 12, this.font) : [],
      }));
      const rowHeight = 63 + leading * Math.max(...lines.map(line => line.name.length + line.title.length));
      this.reserve(rowHeight + (index === 0 ? 24 : 0));
      if (index === 0) this.paragraph("PT Aru Raharja", { space: 0 });
      const top = this.y;
      for (const entry of lines) {
        const { person } = entry;
        const leftEdge = left + SIGNATURE_POSITIONS.indexOf(person.position) * columnWidth;
        const x = Math.round(leftEdge + (person.position === "LEFT" ? 0 : 7));
        this.slots.push({ name: person.name, annotation: {
          type_of: "signature", page: this.doc.getPageCount(),
          canvas_width: Math.round(pageWidth), canvas_height: Math.round(pageHeight),
          position_x: x, position_y: Math.round(pageHeight - top + 5),
          element_width: Math.floor(columnWidth - 15), element_height: 41,
        } });
        entry.name.forEach((text, i) => this.text(text, x, top - 55 - i * leading, this.bold));
        entry.title.forEach((text, i) => this.text(text, x, top - 55 - (i + entry.name.length) * leading));
      }
      this.y -= rowHeight;
    }
  }

  async bytes() {
    for (const page of this.doc.getPages()) {
      page.drawLine({ start: { x: left, y: 53 }, end: { x: right, y: 53 }, thickness: .5, color: lineColor });
      footer.forEach((line, index) => {
        const footerSize = 8;
        const x = left + (width - this.font.widthOfTextAtSize(line, footerSize)) / 2;
        page.drawText(line, { x, y: 40 - index * 10, size: footerSize, font: this.font });
      });
    }
    return this.doc.save();
  }
}

export async function renderCorrespondencePdf(input: CorrespondencePdfInput) {
  const { direction, layout } = input;
  const internal = direction === "INTERNAL";
  const doc = await PDFDocument.create();
  doc.setTitle(input.subject);
  doc.setAuthor("PT Aru Raharja");
  const [regular, bold] = await bodyFonts(doc);
  const logo = await doc.embedPng(await readFile(path.join(process.cwd(), "public", "aru-letterhead.png")));
  const pdf = new CorrespondencePdf(doc, regular, bold, logo);
  const date = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(input.date + "T00:00:00Z"));
  const sifat = input.confidentiality.slice(0, 1) + input.confidentiality.slice(1).toLowerCase();
  if (internal) {
    pdf.paragraph("NOTA DINAS", { align: "center", bold: true, space: 12 });
    pdf.field("Kepada", /^Yth[.\s]/i.test(input.recipient) ? input.recipient : "Yth. " + input.recipient);
    pdf.field("Dari", input.authorTitle || input.author);
    pdf.field("Nomor Surat", input.number || "–");
    pdf.field("Tanggal", date);
    if (input.confidentiality !== "BIASA") pdf.field("Sifat", sifat);
    if (layout.enclosures) pdf.field("Lampiran", layout.enclosures);
    pdf.field("Perihal", input.subject, true);
    if (input.reference) pdf.field("Rujukan", input.reference);
  } else {
    pdf.paragraph([layout.place, date].filter(Boolean).join(", "), { align: "right" });
    pdf.field("Nomor", input.number || "–");
    pdf.field("Sifat", sifat);
    if (layout.enclosures) pdf.field("Lampiran", layout.enclosures);
    pdf.field("Hal", input.subject, true);
    pdf.gap(12);
    pdf.paragraph(/^Yth[.\s]/i.test(input.recipient) ? input.recipient : "Yth. " + input.recipient, { space: 0 });
    if (layout.address) pdf.paragraph(layout.address);
  }
  pdf.gap(12);
  if (input.body) pdf.paragraph(input.body);
  for (const block of layout.blocks) {
    if (block.type === "TEXT") pdf.paragraph(block.text);
    else pdf.table(block.rows);
  }
  if (!internal && layout.closing) pdf.paragraph(layout.closing);
  const signers = layout.signers.length ? layout.signers : [{ name: input.author, title: input.authorTitle, position: "LEFT" } as const];
  pdf.gap(8);
  pdf.signatures(signers);
  if (layout.copies) {
    pdf.gap(8);
    pdf.paragraph("Tembusan", { bold: true });
    pdf.paragraph(layout.copies);
  }
  return { bytes: await pdf.bytes(), slots: pdf.slots };
}
