import { PDFDocument, PageSizes, StandardFonts, degrees, rgb } from "pdf-lib";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

const red = rgb(0.68, 0.15, 0.18);
const blue = rgb(0.09, 0.23, 0.43);
const watermark = "SIMULASI - KHUSUS LATIHAN";

export async function createDevSignedPdf(bytes: Buffer, markCount: 1 | 2) {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new Error("Gunakan PDF yang bisa dibuka dan tidak dilindungi kata sandi.");
  }
  const count = source.getPageCount();
  if (count < 1 || count > 100) throw new Error("Gunakan PDF dengan 1 sampai 100 halaman.");

  const output = await PDFDocument.create();
  output.setTitle("SIAP ARU - Bukti Tanda Tangan Simulasi");
  output.setAuthor("SIAP ARU Staging");
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const regular = await output.embedFont(StandardFonts.Helvetica);
  const pages = await output.copyPages(source, source.getPageIndices());
  for (const page of pages) {
    output.addPage(page);
    const { x, y, width, height } = page.getCropBox();
    const size = Math.min(32, width / 19, height / 17);
    const length = bold.widthOfTextAtSize(watermark, size);
    page.drawText(watermark, { x: x + (width - length * 0.91) / 2, y: y + (height - length * 0.42) / 2,
      font: bold, size, rotate: degrees(25), color: red, opacity: 0.32 });
  }

  const sheet = output.addPage(PageSizes.A4);
  const top = sheet.getHeight() - 66;
  sheet.drawText("SIAP ARU  /  STAGING", { x: 44, y: top, size: 11, font: bold, color: red });
  sheet.drawText("Bukti Tanda Tangan Simulasi", { x: 44, y: top - 45, size: 25, font: bold, color: blue });
  sheet.drawText("SIAP ARU membuat paraf contoh secara otomatis untuk latihan.", {
    x: 44, y: top - 72, size: 11, font: regular, color: blue,
  });
  const timestamp = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" })
    .format(new Date());
  sheet.drawText(timestamp + " WIB", { x: 44, y: top - 92, size: 10, font: regular, color: blue });
  for (let i = 0; i < markCount; i++) {
    const x = 44 + i * 254;
    sheet.drawRectangle({ x, y: top - 244, width: 232, height: 114, borderColor: blue, borderWidth: 0.6 });
    sheet.drawText("PARAF SIMULASI " + (i + 1), { x: x + 15, y: top - 151, size: 10, font: bold, color: red });
    sheet.drawSvgPath(i === 0
      ? "M 0 28 Q 23 -23 41 2 Q 50 22 21 29 L 68 11 Q 78 5 85 24 L 127 12"
      : "M 0 26 Q 36 -24 46 4 Q 54 18 28 26 L 86 2 L 68 27 Q 91 21 128 14", {
      x: x + 37, y: top - 183, scale: 1.05, borderColor: blue, borderWidth: 2.3,
    });
  }
  sheet.drawText(watermark, { x: 44, y: 52, size: 10, font: bold, color: red });
  return output.save();
}

export async function devOutgoingSignature(conn: Pick<PoolConnection, "query">, letterId: string) {
  const [[row]] = await conn.query<RowDataPacket[]>(
    `SELECT job.final_attachment_id FROM siap_letters l
     JOIN siap_v11_attachment_signing job ON job.source_attachment_id=COALESCE(l.active_original_attachment_id,
       (SELECT a.id FROM siap_attachments a WHERE a.letter_id=l.id AND a.disposition_id IS NULL
        AND a.attachment_kind='ORIGINAL' ORDER BY a.created_at DESC,a.id DESC LIMIT 1))
     JOIN siap_attachments f ON f.id=job.final_attachment_id AND f.letter_id=l.id AND f.disposition_id IS NULL
     WHERE l.id=? AND job.mode='local' AND job.status='COMPLETED'`, [letterId],
  );
  return row?.final_attachment_id ? String(row.final_attachment_id) : null;
}
