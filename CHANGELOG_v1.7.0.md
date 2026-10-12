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
- Menu **Perbankan → Dokumen Bank** untuk melampirkan dokumen pendukung per rekening.
- Dokumen memiliki **Tanggal Dokumen**, **Periode Untuk (dari–sampai)**, jenis dokumen, keterangan, nama file, dan informasi uploader sehingga jelas dokumen tersebut berlaku untuk kapan.
- File dokumen dapat diunduh kembali oleh role yang memiliki akses Perbankan.

## Hak akses
- `ROOT_ADMIN`: view + edit/upload.
- `FINANCE`: view + edit/upload.
- `MANAGER`: view-only.
- `DIRECTOR_OPS`: view-only.
- `PRESIDENT_DIRECTOR`: view-only.
- `STAFF`: tidak mendapat menu Rekening Koran/Dokumen Bank.

## Database
Existing production wajib menjalankan migration `database/migration_v1.6.9_to_v1.7.0_bank_statement.sql`.

Migration hanya menambah tabel berikut dan tidak menghapus data lama:
- `siap_bank_accounts`
- `siap_bank_transactions`
- `siap_bank_documents`
