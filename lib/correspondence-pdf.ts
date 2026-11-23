import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { type DraftSignatureSlot, type SignatureLine, SIGNATURE_POSITIONS } from "@/lib/correspondence-layout";
import { ARU_BODY_WIDTH as width, ARU_FONT_SIZE as size, ARU_FOOTER, ARU_LETTERHEAD, ARU_LINE_HEIGHT as leading, ARU_PAGE,
  correspondenceColumnWidths, correspondenceContent, correspondenceLogoPath, type CorrespondenceDocumentInput } from "@/lib/correspondence-document";

const [pageWidth, pageHeight] = PageSizes.A4;
const { left, bottom: pageBottom } = ARU_PAGE;
const lineColor = rgb(0.68, 0.68, 0.68);

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
    const { x, top, width, height } = ARU_LETTERHEAD;
    this.page.drawImage(this.logo, { x, y: pageHeight - top - height, width, height });
    this.y = pageHeight - ARU_PAGE.top;
  }

  private reserve(height: number) {
    if (this.y - height < pageBottom) this.newPage();
  }

  private visible(value: string) {
    return Array.from(value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, " "))
      .map(char => char === "\n" || this.characters.has(char.codePointAt(0)!) ? char : "·").join("");
  }

  private wrap(value: string, maxWidth: number, font: PDFFont, fontSize = size) {
    const lines: string[] = [];
    for (const paragraph of this.visible(value).split("\n")) {
      let row = "";
      for (const word of paragraph.trim().split(/\s+/)) {
        const next = row ? row + " " + word : word;
        if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
          row = next;
          continue;
        }
        if (row) lines.push(row);
        row = "";
        for (const char of word) {
          if (font.widthOfTextAtSize(row + char, fontSize) > maxWidth) {
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

  private text(value: string, x: number, y: number, font: PDFFont = this.font, fontSize = size) {
    if (value) this.page.drawText(value, { x, y, font, size: fontSize });
  }

  gap(amount = 10) { this.y -= amount; }

  paragraph(text: string, options: { bold?: boolean; center?: boolean; space?: number; size?: number } = {}) {
    const font = options.bold ? this.bold : this.font;
    const fontSize = options.size ?? size;
    const lineHeight = fontSize + leading - size;
    for (const row of this.wrap(text, width, font, fontSize)) {
      this.reserve(lineHeight);
      const textWidth = font.widthOfTextAtSize(row, fontSize);
      const x = options.center ? left + (width - textWidth) / 2 : left;
      this.text(row, x, this.y - fontSize, font, fontSize);
      this.y -= lineHeight;
    }
    this.gap(options.space ?? 7);
  }

  field(field: { label: string; value: string; bold?: boolean }, labelWidth: number, colonWidth: number) {
    const colonX = left + labelWidth;
    const valueX = colonX + colonWidth;
    const font = field.bold ? this.bold : this.font;
    const lines = this.wrap(field.value, left + width - valueX, font);
    for (const [index, row] of lines.entries()) {
      this.reserve(leading);
      if (index === 0) {
        this.text(field.label, left, this.y - size);
        this.text(":", colonX, this.y - size);
      }
      this.text(row, valueX, this.y - size, font);
      this.y -= leading;
    }
  }

  table(rows: string[][]) {
    const columnWidths = correspondenceColumnWidths(rows);
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

  signatures(rows: SignatureLine[][]) {
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
      ARU_FOOTER.forEach((line, index) => {
        const footerSize = 9;
        const x = left + (width - this.font.widthOfTextAtSize(line, footerSize)) / 2;
        page.drawText(line, { x, y: 56 - index * 12, size: footerSize, font: this.font });
      });
    }
    return this.doc.save();
  }
}

export async function renderCorrespondencePdf(input: CorrespondenceDocumentInput) {
  const { layout } = input;
  const content = correspondenceContent(input);
  const doc = await PDFDocument.create();
  doc.setTitle(input.subject);
  doc.setAuthor("PT Aru Raharja");
  const [regular, bold] = await bodyFonts(doc);
  const logo = await doc.embedPng(await readFile(correspondenceLogoPath()));
  const pdf = new CorrespondencePdf(doc, regular, bold, logo);
  if (content.title) pdf.paragraph(content.title, { bold: true, center: true, size: 16, space: 10 });
  if (content.headingDate) pdf.paragraph(content.headingDate, { space: 13 });
  for (const field of content.fields) pdf.field(field, content.labelWidth, content.colonWidth);
  if (content.address) {
    pdf.gap(28);
    pdf.paragraph(content.address, { space: 0 });
  }
  pdf.gap(12);
  if (input.body) pdf.paragraph(input.body);
  for (const block of layout.blocks) {
    if (block.type === "TEXT") pdf.paragraph(block.text);
    else pdf.table(block.rows);
  }
  if (content.closing) pdf.paragraph(content.closing);
  pdf.gap(8);
  pdf.signatures(content.signatures);
  if (layout.copies) {
    pdf.gap(8);
    pdf.paragraph("Tembusan:", { space: 0 });
    pdf.paragraph(layout.copies);
  }
  return { bytes: await pdf.bytes(), slots: pdf.slots };
}
