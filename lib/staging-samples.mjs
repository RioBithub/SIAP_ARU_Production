import { PDFDocument, PageSizes, StandardFonts, degrees, rgb } from "pdf-lib";

export const sampleCases = [
  { number: 1, title: "Penawaran Jasa Pengamanan PT ABC", sender: "PT ABC (Simulasi)", reference: "SIM-ABC/012/2026",
    original: "penawaran-abc", receipt: "terima-abc", confidentiality: "BIASA", summary: "Telaah penawaran jasa pengamanan." },
  { number: 2, title: "Invoice ATK CV Sinar Jaya", sender: "CV Sinar Jaya (Simulasi)", reference: "SIM-INV/115",
    original: "invoice-atk", receipt: "terima-invoice", confidentiality: "PENTING", summary: "Verifikasi penerimaan dan jumlah ATK.", invoice: true },
  { number: 3, title: "Permintaan Kerja Sama PT XYZ", sender: "PT XYZ (Simulasi)", reference: "SIM-XYZ/021/2026",
    original: "surat-xyz", receipt: "terima-xyz", confidentiality: "RAHASIA", summary: "Tinjau rencana kerja sama dan survei lokasi." },
  { number: 4, title: "Balasan Penawaran PT ABC", original: "draf-balasan" },
  { number: 5, title: "Konfirmasi Jadwal Kunjungan", sender: "Vendor Simulasi Cakra", reference: "SIM-KONF/015/2026",
    original: "surat-jadwal", receipt: "terima-jadwal", confidentiality: "BIASA", summary: "Konfirmasi jadwal kunjungan yang diusulkan." },
  { number: 6, title: "Pemeriksaan Area Simulasi", sender: "Vendor Simulasi Nusa", reference: "SIM-AREA/018/2026",
    original: "surat-area", receipt: "terima-area", confidentiality: "PENTING", summary: "Periksa area dan buat berita acara." },
];

const files = [
  ["penawaran-abc", 1, "Penawaran Jasa Pengamanan PT ABC", [
    "Dari PT ABC (Simulasi) kepada PT Aru Raharja.", "Layanan contoh mencakup penjagaan akses dan patroli area kerja.",
    "Rencana awal mencakup dua petugas per giliran dan laporan mingguan."]],
  ["terima-abc", 1, "Bukti Terima Penawaran PT ABC", ["Kurir Simulasi menyerahkan satu berkas penawaran dalam kondisi lengkap."]],
  ["invoice-atk", 2, "Invoice ATK CV Sinar Jaya", [
    "Tagihan kepada PT Aru Raharja dengan termin 14 hari kalender.",
    "100 paket kertas x Rp150.000 = Rp15.000.000.", "200 paket alat tulis x Rp80.000 = Rp16.000.000.",
    "140 paket map arsip x Rp100.000 = Rp14.000.000.", "Total tagihan latihan Rp45.000.000."]],
  ["terima-invoice", 2, "Bukti Terima Invoice ATK", ["Sekretariat Simulasi menerima satu invoice dan lembar pengantar latihan."]],
  ["bukti-atk", 2, "Bukti Pemeriksaan Penerimaan ATK", [
    "Staff Operasional memeriksa 100 paket kertas, 200 paket alat tulis, dan 140 paket map arsip.",
    "Jumlah dan kondisi sesuai surat pesanan simulasi."]],
  ["bpk-atk", 2, "Bukti Pengeluaran ATK", ["Pengajuan pembayaran contoh atas invoice SIM-INV/115.",
    "Pembebanan perlengkapan kantor Rp45.000.000."]],
  ["nota-keuangan", 2, "Nota Dinas Pengajuan Pembayaran ATK", [
    "Dari Unit Operasional kepada Keuangan. Mohon review pembayaran atas penerimaan ATK.",
    "Total latihan Rp45.000.000. Surat pesanan dan bukti pemeriksaan tersedia."]],
  ["kontrak-atk", 2, "Kontrak Perjanjian Pengadaan ATK", [
    "Paket perlengkapan kantor simulasi dengan nilai Rp45.000.000.",
    "Pembayaran dilakukan setelah jumlah dan kondisi barang diverifikasi dalam latihan."]],
  ["spk-atk", 2, "Surat Perintah Kerja ATK", [
    "SIM-SPK-001. CV Sinar Jaya (Simulasi) menyiapkan paket kertas, alat tulis dan map arsip.",
    "Staff Operasional memeriksa jumlah saat paket diterima."]],
  ["margin-atk", 2, "Perhitungan Margin Pengadaan ATK", [
    "Nilai penagihan contoh Rp50.000.000. Biaya pembelian contoh Rp45.000.000.",
    "Selisih contoh Rp5.000.000 atau 10% dari nilai penagihan."]],
  ["pesanan-atk", 2, "Surat Pesanan ATK", [
    "SIM-PO-001. Pengiriman contoh ke Unit Operasional.",
    "Kertas 100 paket, alat tulis 200 paket, dan map arsip 140 paket."]],
  ["rekening-vendor", 2, "Informasi Pembayaran Vendor", [
    "Nama penerima CV Sinar Jaya (Simulasi). Referensi rekening fiktif REK-SIM-001.",
    "Seluruh nilai dan identitas pembayaran pada berkas ini untuk latihan."]],
  ["spb-atk", 2, "Surat Permintaan Bayar Persekot", [
    "Referensi SIM-SPB-001. Nilai contoh Rp45.000.000.",
    "Alasan persekot contoh untuk latihan persetujuan mode persekot."]],
  ["bukti-bayar", 2, "Bukti Pencatatan Pembayaran Simulasi", [
    "Referensi pencatatan SIM-BAYAR-115. Nilai Rp45.000.000.",
    "Finance menggunakan referensi ini sebagai contoh bukti pencatatan di staging."]],
  ["surat-xyz", 3, "Permintaan Kerja Sama PT XYZ", [
    "PT XYZ (Simulasi) mengusulkan kerja sama pengelolaan area kerja dan survei awal.",
    "Tim Operasional diminta meninjau akses, kondisi area, dan ruang lingkup."]],
  ["terima-xyz", 3, "Bukti Terima Surat PT XYZ", ["Petugas menerima satu surat usulan survei lokasi dengan sifat rahasia untuk latihan."]],
  ["laporan-xyz", 3, "Laporan Survei Awal PT XYZ", [
    "Akses kendaraan dan jalur masuk dinilai memadai untuk kunjungan contoh.",
    "Rekomendasi tindak lanjut mencakup pengukuran area dan rapat pembahasan ruang lingkup."]],
  ["draf-balasan", 4, "Draf Balasan Penawaran PT ABC", [
    "Kepada PT ABC (Simulasi). Terima kasih atas penawaran jasa pengamanan.",
    "Tim Operasional akan menelaah ruang lingkup, pembagian giliran, dan rencana pelaporan.",
    "Mohon siapkan rincian biaya untuk pembahasan lanjutan dalam latihan."]],
  ["bukti-kirim", 4, "Bukti Pencatatan Pengiriman PT ABC", [
    "Penerima PT ABC (Simulasi). Kanal contoh Diantar langsung / kurir.",
    "Bukti ini dibuat untuk latihan pencatatan pengiriman Surat Keluar."]],
  ["surat-jadwal", 5, "Permintaan Konfirmasi Jadwal Kunjungan", [
    "Vendor Simulasi Cakra mengusulkan kunjungan di hari kerja pukul 10.00 WIB.",
    "Manager Operasional diminta mengonfirmasi kesiapan tempat dan PIC."]],
  ["terima-jadwal", 5, "Bukti Terima Permintaan Jadwal", ["Sekretariat Simulasi menerima usulan jadwal dari Vendor Simulasi Cakra."]],
  ["lembar-jadwal", 5, "Lembar Konfirmasi Jadwal", ["Manager Operasional mengonfirmasi pukul 10.00 WIB.",
    "Lokasi latihan Ruang Rapat Simulasi. Agenda pemeriksaan jadwal kunjungan."]],
  ["surat-area", 6, "Permintaan Pemeriksaan Area Simulasi", [
    "Vendor Simulasi Nusa meminta pemeriksaan akses, kondisi ruang, dan daftar temuan.",
    "Hasil latihan disajikan dalam Berita Acara Pemeriksaan Area."]],
  ["terima-area", 6, "Bukti Terima Permintaan Pemeriksaan", ["Kurir Simulasi menyerahkan surat permintaan pemeriksaan area."]],
  ["berita-acara", 6, "Berita Acara Pemeriksaan Area", [
    "Staff Operasional memeriksa akses, penerangan, dan kesiapan ruang simulasi.",
    "Temuan contoh berupa kebutuhan pembaruan label jalur masuk.",
    "Rekomendasi contoh memasang label dan memeriksa kembali pada kunjungan berikutnya."]],
];

export const sampleDocs = files.map(([id, scenario, title, paragraphs]) => ({
  id, scenario, title, paragraphs, filename: "SIMULASI-" + id + ".pdf",
}));

export function demoDate(days = 0) {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date());
  return new Date(Date.parse(today + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

export async function samplePdf(id, date = demoDate()) {
  const entry = sampleDocs.find(doc => doc.id === id);
  if (!entry) return null;
  const scenario = sampleCases.find(item => item.number === entry.scenario);
  const doc = await PDFDocument.create();
  doc.setTitle(entry.title + " - Simulasi SIAP ARU");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage(PageSizes.A4);
  const navy = rgb(0.06, 0.19, 0.36);
  const red = rgb(0.66, 0.13, 0.16);
  const label = "SIMULASI - KHUSUS LATIHAN";
  const draw = (text, y, size, type = font, color = navy) => page.drawText(text, { x: 48, y, size, font: type, color });
  const top = page.getHeight() - 56;
  draw("SIAP ARU / STAGING", top, 11, bold);
  draw(label, top - 21, 11, bold, red);
  draw(entry.title, top - 67, 18, bold);
  draw("Skenario " + scenario.number + "  /  " + (scenario.reference ?? "Draf balasan SIM-ABC") + "  /  " + date, top - 95, 10);
  page.drawLine({ start: { x: 48, y: top - 109 }, end: { x: 547, y: top - 109 }, color: navy, thickness: 0.65 });
  page.drawText(label, { x: 84, y: 340, size: 32, font: bold, color: red, opacity: 0.16, rotate: degrees(27) });
  let y = top - 143;
  for (const paragraph of entry.paragraphs) {
    page.drawText(paragraph, { x: 48, y, size: 11, font, color: navy, lineHeight: 16, maxWidth: 499 });
    y -= 42;
  }
  draw("Data fiktif untuk latihan alur di siap-dev.aruraharja.co.id.", 54, 9);
  return doc.save();
}
