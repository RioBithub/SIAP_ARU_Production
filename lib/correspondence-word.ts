import { readFile } from "node:fs/promises";
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HorizontalPositionRelativeFrom,
  ImageRun, LineRuleType, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow,
  TextRun, TextWrappingType, VerticalPositionRelativeFrom, WidthType, type ITableBordersOptions,
} from "docx";
import {
  ARU_BODY_WIDTH, ARU_FONT_SIZE, ARU_FOOTER, ARU_LETTERHEAD, ARU_LINE_HEIGHT, ARU_PAGE,
  correspondenceColumnWidths, correspondenceContent, correspondenceLogoPath, type CorrespondenceDocumentInput,
} from "@/lib/correspondence-document";
import { SIGNATURE_POSITIONS, type SignatureLine } from "@/lib/correspondence-layout";

export const WORD_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const twips = (points: number) => Math.round(points * 20);
const emu = (points: number) => Math.round(points * 12_700);
const wordWidth = (points: number) => ({ size: twips(points), type: WidthType.DXA });
const font = "Arial";
const line = { style: BorderStyle.SINGLE, size: 4, color: "B3B3B3" };
const none = { style: BorderStyle.NONE };
const dataBorders = { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line };
const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };

function xmlText(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "");
}

function paragraph(text: string, options: {
  size?: number; bold?: boolean; center?: boolean; before?: number; after?: number; leading?: number;
  title?: boolean; keepNext?: boolean;
} = {}) {
  const size = options.size ?? ARU_FONT_SIZE;
  return new Paragraph({
    style: options.title ? "Title" : "Normal",
    alignment: options.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    keepNext: options.keepNext,
    spacing: {
      before: twips(options.before ?? 0),
      after: twips(options.after ?? 0),
      line: twips(options.leading ?? (size + ARU_LINE_HEIGHT - ARU_FONT_SIZE)),
      lineRule: LineRuleType.EXACT,
    },
    children: xmlText(text).split(/\r\n?|\n/).map((part, index) => new TextRun({
      text: part, size: size * 2, font, bold: options.bold, break: index ? 1 : undefined,
    })),
  });
}

function fixedTable(widths: number[], rows: TableRow[], borders: ITableBordersOptions, padding = 0) {
  return new Table({
    width: wordWidth(ARU_BODY_WIDTH),
    columnWidths: widths.map(twips),
    layout: TableLayoutType.FIXED,
    borders,
    margins: { top: twips(padding), bottom: twips(padding), left: twips(padding), right: twips(padding) },
    rows,
  });
}

function fieldsTable(content: ReturnType<typeof correspondenceContent>) {
  const widths = [content.labelWidth, content.colonWidth, ARU_BODY_WIDTH - content.labelWidth - content.colonWidth];
  return fixedTable(widths, content.fields.map(field => new TableRow({
    cantSplit: true,
    children: [field.label, ":", field.value].map((value, index) => new TableCell({
      width: wordWidth(widths[index]),
      children: [paragraph(value, { bold: index === 2 && field.bold })],
    })),
  })), noBorders);
}

function bodyTable(values: string[][]) {
  const widths = correspondenceColumnWidths(values);
  return fixedTable(widths, values.map((row, index) => new TableRow({
    cantSplit: true,
    tableHeader: index === 0,
    children: row.map((value, column) => new TableCell({
      width: wordWidth(widths[column]),
      shading: index === 0 ? { fill: "EEEEEE" } : undefined,
      children: [paragraph(value, { bold: index === 0 })],
    })),
  })), dataBorders, 4.5);
}

function signaturesTable(rows: SignatureLine[][]) {
  const width = ARU_BODY_WIDTH / SIGNATURE_POSITIONS.length;
  return fixedTable(SIGNATURE_POSITIONS.map(() => width), rows.map(row => new TableRow({
    cantSplit: true,
    children: SIGNATURE_POSITIONS.map(position => {
      const person = row.find(entry => entry.position === position);
      return new TableCell({
        width: wordWidth(width),
        children: person
          ? [paragraph(person.name, { bold: true, before: 44 }), ...(person.title ? [paragraph(person.title)] : [])]
          : [paragraph("")],
      });
    }),
  })), noBorders);
}

async function letterhead() {
  const { x, top, width, height } = ARU_LETTERHEAD;
  const logo = new ImageRun({
    type: "png", data: await readFile(correspondenceLogoPath()),
    transformation: { width: width * 4 / 3, height: height * 4 / 3 },
    altText: { title: "PT Aru Raharja", description: "Logo PT Aru Raharja", name: "Kop ARU" },
    floating: {
      horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: emu(x) },
      verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: emu(top) },
      behindDocument: true,
      allowOverlap: true,
      wrap: { type: TextWrappingType.NONE },
    },
  });
  return new Header({ children: [new Paragraph({ children: [logo] })] });
}

export async function renderCorrespondenceWord(input: CorrespondenceDocumentInput) {
  const content = correspondenceContent(input);
  const { layout } = input;
  const children: (Paragraph | Table)[] = [];
  if (content.title) children.push(paragraph(content.title, {
    size: 16, bold: true, center: true, after: 10, title: true, keepNext: true,
  }));
  if (content.headingDate) children.push(paragraph(content.headingDate, { after: 13, keepNext: true }));
  children.push(fieldsTable(content));

  if (content.address) children.push(paragraph(content.address, { before: 28 }));
  const body: (Paragraph | Table)[] = [];
  if (input.body) body.push(paragraph(input.body, { after: 7 }));
  for (const block of layout.blocks) {
    if (block.type === "TEXT") body.push(paragraph(block.text, { after: 7 }));
    else body.push(bodyTable(block.rows), paragraph("", { leading: 7 }));
  }
  if (content.closing) body.push(paragraph(content.closing, { after: 7 }));
  if (body.length) children.push(paragraph("", { leading: 12 }), ...body);
  children.push(paragraph("PT Aru Raharja", { before: 8, keepNext: true }), signaturesTable(content.signatures));
  if (layout.copies) {
    children.push(paragraph("Tembusan:", { before: 10, keepNext: true }), paragraph(layout.copies));
  }

  const footer = new Footer({ children: ARU_FOOTER.map(line => paragraph(line, { center: true, size: 9, leading: 12 })) });
  const sections = [{
    properties: { page: { size: { width: twips(ARU_PAGE.width), height: twips(ARU_PAGE.height) }, margin: {
      left: twips(ARU_PAGE.left), right: twips(ARU_PAGE.right), top: twips(ARU_PAGE.top), bottom: twips(ARU_PAGE.bottom),
      header: twips(35), footer: twips(38),
    } } },
    headers: { default: await letterhead() },
    footers: { default: footer },
    children,
  }];
  return Packer.toBuffer(new Document({
    title: xmlText(input.subject),
    creator: "PT Aru Raharja",
    styles: {
      default: { document: { run: { font, size: ARU_FONT_SIZE * 2, color: "000000" } } },
      paragraphStyles: [{ id: "Title", name: "Title", basedOn: "Normal", next: "Normal",
        run: { font, size: 32, bold: true, color: "000000" } }],
    },
    sections,
  }));
}
