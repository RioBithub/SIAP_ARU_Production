# SIAP ARU v1.7.1 — Import Rekening Koran BRI PDF

## Fitur
- Upload PDF `LAPORAN TRANSAKSI FINANSIAL / STATEMENT OF FINANCIAL TRANSACTION` BRI IBBIZ.
- Deteksi nomor rekening, tanggal laporan, periode transaksi, saldo awal/akhir, total debit/kredit, dan baris transaksi.
- Deduplikasi lintas PDF menggunakan fingerprint: rekening + tanggal/waktu + uraian + teller + debit + kredit + saldo setelah transaksi.
- PDF periode overlap hanya memasukkan transaksi yang belum ada.
- Import aktif dengan periode paling baru menjadi sumber saldo referensi; sumber lama tetap menjadi histori.
- Koreksi saldo referensi manual oleh Finance/Root.
- Transaksi hasil import tetap bisa diedit/void dari Rekening Koran.
- Undo import menghapus transaksi yang khusus dibuat oleh batch tersebut, tanpa menyentuh transaksi duplikat yang sudah berasal dari batch sebelumnya.
- PDF sumber otomatis disimpan ke Dokumen Bank.
- Batch import, data hasil parser, koreksi, dan undo tetap tercatat untuk audit.

## Dependensi server
Parser memakai `pdftotext` dari Poppler, bukan dependency npm.

Ubuntu 24.04:

```bash
apt-get update
apt-get install -y poppler-utils
pdftotext -v
```

## Database
Import melalui phpMyAdmin:

`database/migration_v1.7.0_to_v1.7.1_bri_pdf_import.sql`

Migration menambah:
- `siap_bank_import_batches`
- metadata import pada `siap_bank_transactions`

## Deploy

```bash
cd /opt/apps/siap-aru
git fetch origin
git checkout main
git pull --ff-only origin main
npm ci
npm run typecheck
npm run build
pm2 restart siap-aru --update-env
pm2 save
```

## Akses
- ROOT_ADMIN: import, koreksi, undo, lihat.
- FINANCE: import, koreksi, undo, lihat.
- MANAGER: lihat riwayat dan saldo referensi.
- DIRECTOR_OPS: lihat.
- PRESIDENT_DIRECTOR: lihat.
- STAFF: tidak mendapat menu Perbankan.

## Catatan format PDF
Parser v1.0 ditujukan untuk PDF teks BRI IBBIZ dengan header `LAPORAN TRANSAKSI FINANSIAL`. PDF hasil scan/foto tanpa text layer akan ditolak agar sistem tidak memasukkan data yang tidak pasti. Jika BRI mengubah layout secara material, parser akan gagal sebelum transaksi ditulis sehingga data production tidak berubah sebagian.
