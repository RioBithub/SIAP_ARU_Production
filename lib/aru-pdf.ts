import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { safeFilename } from "@/lib/upload";
import { devStaging } from "@/lib/dev-staging";

const ink = rgb(0.10, 0.16, 0.22);
const navy = rgb(0.04, 0.18, 0.36);
const muted = rgb(0.30, 0.36, 0.43);
const line = rgb(0.76, 0.81, 0.85);
const pale = rgb(0.95, 0.97, 0.99);
const margin = 38;

type Field = { label: string; value: unknown };

export class AruPdf {
  private page!: PDFPage;
  private y = 0;
  private readonly characters: Set<number>;
  private readonly usableWidth: number;

  private constructor(
    private readonly document: PDFDocument, private readonly font: PDFFont, private readonly bold: PDFFont,
    private readonly logo: PDFImage | undefined, private readonly title: string, private readonly reference: string,
    private readonly pageSize: [number, number],
  ) {
    this.characters = new Set(font.getCharacterSet());
    this.usableWidth = pageSize[0] - 2 * margin;
    this.newPage();
  }

  static async create(title: string, reference: string, landscape = false) {
    const document = await PDFDocument.create();
    document.setTitle(title);
    document.setAuthor("PT Aru Raharja");
    const font = await document.embedFont(StandardFonts.Helvetica);
    const bold = await document.embedFont(StandardFonts.HelveticaBold);
    const logo = await readFile(path.join(process.cwd(), "public", "aru-logo.png"))
      .then(bytes => document.embedPng(bytes)).catch(() => undefined);
    const [width, height] = PageSizes.A4;
    return new AruPdf(document, font, bold, logo, title, reference, landscape ? [height, width] : [width, height]);
  }

  private content(value: unknown) {
    const text = String(value ?? "").replace(/\r\n?/g, "\n").replaceAll("\t", " ");
    return Array.from(text).map(char => {
      if (char === "\n" || this.characters.has(char.codePointAt(0)!)) return char;
      if (char === "→") return ">";
      const latin = char.normalize("NFKD").replace(/\p{M}/gu, "");
      return /^[\x20-\x7e]+$/.test(latin) ? latin : "?";
    }).join("");
  }

  private wrap(value: unknown, width: number, size: number, font = this.font) {
    const text = this.content(value).trim() || "-";
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      let current = "";
      for (const word of paragraph.trim().split(/\s+/)) {
        const combined = current ? current + " " + word : word;
        if (font.widthOfTextAtSize(combined, size) <= width) {
          current = combined;
          continue;
        }
        if (current) lines.push(current);
        current = "";
        for (const char of word) {
          if (font.widthOfTextAtSize(current + char, size) > width) {
            lines.push(current);
            current = "";
          }
          current += char;
        }
      }
      lines.push(current);
    }
    return lines;
  }

  private text(value: string, x: number, y: number, size: number, bold = false, color = ink) {
    this.page.drawText(value, { x, y, size, color, font: bold ? this.bold : this.font });
  }

  private newPage() {
    this.page = this.document.addPage(this.pageSize);
    const top = this.page.getHeight() - margin;
    if (this.logo) {
      const logo = this.logo.scaleToFit(26, 26);
      this.page.drawImage(this.logo, { x: margin, y: top - 24, ...logo });
    }
    this.text("PT ARU RAHARJA", margin + (this.logo ? 34 : 0), top - 7, 12, true, navy);
    this.text(this.title, margin, top - 44, 22, true, navy);
    let baseline = top - 63;
    for (const row of this.wrap(this.reference, this.usableWidth, 9)) {
      this.text(row, margin, baseline, 9, false, muted);
      baseline -= 12;
    }
    this.page.drawLine({ start: { x: margin, y: baseline - 1 },
      end: { x: margin + this.usableWidth, y: baseline - 1 }, color: navy, thickness: 1 });
    this.y = baseline - 13;
  }

  private reserve(height: number) {
    if (this.y - height < 46) this.newPage();
  }

  section(label: string) {
    this.reserve(46);
    this.page.drawRectangle({ x: margin, y: this.y - 22, width: this.usableWidth, height: 22, color: pale });
    this.text(this.content(label), margin + 9, this.y - 15, 10, true, navy);
    this.y -= 28;
  }

  paragraph(value: unknown) {
    for (const row of this.wrap(value, this.usableWidth - 18, 10)) {
      this.reserve(15);
      this.text(row, margin + 9, this.y - 12, 10);
      this.y -= 15;
    }
    this.y -= 7;
  }

  fields(fields: Field[]) {
    const width = this.usableWidth / fields.length;
    const cells = fields.map(({ label, value }) => ({
      label, lines: this.wrap(value, width - 18, 10),
    }));
    const height = 23 + 14 * Math.max(...cells.map(cell => cell.lines.length));
    this.reserve(height);
    for (const [index, cell] of cells.entries()) {
      const x = margin + index * width;
      this.page.drawRectangle({ x, y: this.y - height, width, height, borderColor: line, borderWidth: 0.55 });
      this.text(this.content(cell.label), x + 9, this.y - 14, 8, true, muted);
      cell.lines.forEach((value, row) => this.text(value, x + 9, this.y - 28 - row * 14, 10));
    }
    this.y -= height + 4;
  }

  classification(values: string[], selected: string) {
    this.reserve(32);
    let x = margin + 9;
    for (const label of values) {
      this.page.drawRectangle({ x, y: this.y - 16, width: 11, height: 11, borderColor: navy, borderWidth: 0.7 });
      if (selected.toUpperCase() === label.toUpperCase()) this.text("X", x + 2.1, this.y - 14.5, 8, true, navy);
      const display = this.content(label);
      this.text(display, x + 16, this.y - 14, 9);
      x += this.font.widthOfTextAtSize(display, 9) + 42;
    }
    this.y -= 29;
  }

  signatureLines(people: Field[]) {
    this.reserve(85);
    const width = this.usableWidth / people.length;
    for (const [i, person] of people.entries()) {
      const x = margin + i * width + 9;
      this.text(this.content(person.label), x, this.y - 12, 9, true, muted);
      this.page.drawLine({ start: { x, y: this.y - 56 }, end: { x: x + width - 18, y: this.y - 56 }, color: line, thickness: 0.7 });
      this.wrap(person.value, width - 18, 8).slice(0, 2).forEach((name, index) => {
        this.text(name, x, this.y - 68 - index * 9, 8);
      });
    }
    this.y -= 88;
  }

  async bytes() {
    const pages = this.document.getPages();
    pages.forEach((page, i) => {
      page.drawLine({ start: { x: margin, y: 33 }, end: { x: margin + this.usableWidth, y: 33 }, color: line, thickness: 0.55 });
      page.drawText(devStaging() ? "SIAP ARU STAGING - SIMULASI" : "SIAP ARU",
        { x: margin, y: 21, size: 8, color: muted, font: this.font });
      page.drawText(`${i + 1} / ${pages.length}`, {
        x: page.getWidth() - margin - 26, y: 21, size: 8, color: muted, font: this.font,
      });
    });
    return this.document.save();
  }
}

export function aruPdfResponse(bytes: Uint8Array, filename: string) {
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${safeFilename(filename)}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
