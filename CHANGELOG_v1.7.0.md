# v1.7.0 — Rekening Koran Finance

## Fitur baru
- Modul **Perbankan → Rekening Koran** dipisahkan dari dashboard Finance utama agar implementasi dapat dilakukan bertahap.
- Transaksi Rekening Koran **tidak otomatis mengubah** angka Pendapatan, Biaya, Laba, Anggaran, Piutang, atau Utang pada dashboard Finance.
- Finance/Root dapat membuat dan mengubah data rekening perusahaan.
- Finance/Root dapat input transaksi bank dengan tanggal & waktu, uraian, Teller/User ID, nomor referensi, debit/kredit, dan catatan.
- Saldo berjalan dihitung otomatis dari saldo awal rekening + transaksi aktif.
- Filter periode bebas dengan shortcut **Minggu Ini**, **Minggu Lalu**, **7 Hari Terakhir**, dan **Bulan Ini**.
- Tampilan laporan menyerupai rekening koran: data rekening, periode, tabel transaksi, saldo awal, total debit, total kredit, saldo akhir, dan **terbilang**.
- Branding laporan menggunakan logo **PT Aru Raharja**.
- **Download Excel** (sheet Rekening Koran + Data Transaksi).
- **Cetak / Simpan PDF** melalui tampilan print A4.
- Finance/Root dapat mengoreksi transaksi; pembatalan memakai status `VOIDED`, tidak hard-delete, dan tetap tercatat di Audit Log.

## Hak akses
- `ROOT_ADMIN`: view + edit.
- `FINANCE`: view + edit.
- `MANAGER`: view-only.
- `DIRECTOR_OPS`: view-only.
- `PRESIDENT_DIRECTOR`: view-only.
- `STAFF`: tidak mendapat menu Rekening Koran.

## Database
Existing production wajib menjalankan migration:

```bash
mysql -u <DB_USER> -p <DB_NAME> < database/migration_v1.6.9_to_v1.7.0_bank_statement.sql
```

Migration hanya menambah tabel `siap_bank_accounts` dan `siap_bank_transactions`; tidak menghapus data lama.
