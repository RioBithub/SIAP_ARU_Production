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

## Setelah deploy
1. Login Finance atau Root.
2. Buka **Keuangan → Rekening Koran**.
3. Klik **Tambah Rekening**.
4. Isi bank, nomor rekening, nama rekening, saldo awal, dan tanggal saldo awal.
5. Tambahkan transaksi Debit/Kredit.
6. Gunakan filter tanggal atau shortcut mingguan/bulanan.
7. Gunakan **Download Excel** atau **Cetak / Simpan PDF**.

Direktur Operasional dan Direktur Utama dapat melihat rekening koran tetapi tidak dapat mengubah data.

> Backup database sebelum migration production tetap disarankan.
