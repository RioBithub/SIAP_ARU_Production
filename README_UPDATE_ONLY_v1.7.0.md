# Update SIAP ARU ke v1.7.0 — Rekening Koran

Untuk instalasi production yang sudah berjalan:

```bash
cd /opt/apps/siap-aru
git pull
npm install
mysql -u <DB_USER> -p <DB_NAME> < database/migration_v1.6.9_to_v1.7.0_bank_statement.sql
npm run typecheck
npm run build
pm2 restart siap-aru
pm2 save
```

## Implementasi bertahap
Modul **Rekening Koran** sengaja dipisahkan dari Ringkasan Finance utama.

Transaksi bank yang dimasukkan pada Rekening Koran **belum otomatis mengubah** data Pendapatan, Biaya, Laba, Anggaran, Piutang, Utang, maupun YTD di dashboard Finance. Integrasi tersebut dapat dilakukan pada tahap berikutnya setelah alur input Rekening Koran stabil di production.

## Setelah deploy
1. Login Finance atau Root.
2. Buka **Perbankan → Rekening Koran**.
3. Klik **Tambah Rekening**.
4. Isi bank, nomor rekening, nama rekening, saldo awal, dan tanggal saldo awal.
5. Tambahkan transaksi Debit/Kredit.
6. Gunakan filter tanggal atau shortcut mingguan/bulanan.
7. Gunakan **Download Excel** atau **Cetak / Simpan PDF**.

Manager, Direktur Operasional, dan Direktur Utama dapat melihat Rekening Koran secara view-only. Finance dan Root tetap menjadi pihak yang dapat input/koreksi data.

> Backup database sebelum migration production tetap disarankan.
