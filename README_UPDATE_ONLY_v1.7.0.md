# Update SIAP ARU ke v1.7.0 — Rekening Koran

Untuk instalasi production yang sudah berjalan, database migration boleh di-import manual melalui phpMyAdmin. Setelah migration berhasil, deploy source code seperti biasa.

## Implementasi bertahap
Modul **Rekening Koran** sengaja dipisahkan dari Ringkasan Finance utama.

Transaksi bank yang dimasukkan pada Rekening Koran **belum otomatis mengubah** data Pendapatan, Biaya, Laba, Anggaran, Piutang, Utang, maupun YTD di dashboard Finance. Integrasi tersebut dapat dilakukan pada tahap berikutnya setelah alur input Rekening Koran stabil di production.

## Database migration
Import file berikut ke database SIAP yang sudah berjalan:

`database/migration_v1.6.9_to_v1.7.0_bank_statement.sql`

Migration bersifat additive dan membuat:
- `siap_bank_accounts`
- `siap_bank_transactions`
- `siap_bank_documents`

Backup database sebelum import tetap disarankan.

## Deploy source setelah PR di-merge

```bash
cd /opt/apps/siap-aru
git status
git fetch origin
git checkout main
git pull origin main
npm ci
npm run typecheck
npm run build
pm2 restart siap-aru
pm2 save
pm2 status
curl -I http://127.0.0.1:3200/login
curl -I https://siap.aruraharja.co.id/login
```

## Setelah deploy
1. Login Finance atau Root.
2. Buka **Perbankan → Rekening Koran** dan tambah rekening bila belum ada.
3. Tambahkan transaksi Debit/Kredit dan uji filter tanggal.
4. Buka **Perbankan → Dokumen Bank** untuk melampirkan file pendukung.
5. Pada dokumen, isi **Tanggal Dokumen** dan bila relevan isi **Periode Untuk — Dari/Sampai** agar jelas dokumen tersebut digunakan untuk periode kapan.
6. Uji Download Excel, Cetak/Simpan PDF, dan download dokumen bank.
7. Login Manager/Dirops/Dirut untuk memastikan akses view-only.

Manager, Direktur Operasional, dan Direktur Utama dapat melihat Rekening Koran dan Dokumen Bank secara view-only. Finance dan Root tetap menjadi pihak yang dapat input/koreksi data dan upload dokumen.
