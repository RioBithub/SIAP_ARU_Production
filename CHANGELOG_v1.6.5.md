# SIAP ARU v1.6.5 — Persuratan UX + Excel Compatibility

## Fokus update

### 1. Popup aplikasi dibuat konsisten
Native browser `alert / confirm / prompt` tidak lagi dipakai untuk aksi utama. Konfirmasi, input alasan, reset password, reverse Finance, penghapusan, dan perubahan role memakai dialog SIAP ARU yang konsisten dengan UI aplikasi.

### 2. Format & nomor awal dapat diedit Root
Root Admin dapat mengedit `Nomor Awal / Minimum`, nama format, pola resmi, dan status aktif. Histori nomor yang sudah ada tetap dipertahankan. Nomor berikutnya selalu mempertimbangkan ledger tahun berjalan sehingga perubahan minimum tidak membuat tabrakan.

### 3. Format resmi diselaraskan dengan workbook ARU
- PKS: `P/{seq}/AR/{year}`
- Surat Direksi: `Dir/{seq}/AR/{year}`
- Bagian Operasional: `Oprsl/{seq}/AR/{year}`
- Purchase Order: `PO/{seq}/AR/{year}`
- Surat Keluar Umum: `UM/{seq}/AR/{year}`

Di daftar web cukup tampil angka seperti `135`, `135.1`, dst. Jenis surat tetap berada di kolom terpisah.

### 4. Import / Export Form Persuratan ARU.xlsx
Surat Keluar sekarang punya tombol:
- `Export Excel`
- `Import Excel Lama` (Root)

Export menghasilkan 5 sheet dengan nama dan susunan yang mengikuti workbook lama. Import membaca 5 sheet tersebut dan memindahkan data menjadi database SIAP.

Import bersifat idempotent berdasarkan `sheet + row`, sehingga import ulang file yang sama memperbarui data dan tidak membuat duplikat baris.

### 5. Proteksi nomor historis
Nomor legacy tetap dipertahankan apa adanya. Nomor tidak standar atau duplikat tetap disimpan, tetapi ditandai `legacy_number_conflict` dan tidak dipakai untuk merusak ledger penomoran otomatis baru.

### 6. Optional current-data import SQL
Disertakan `OPTIONAL_IMPORT_CURRENT_FORM_PERSURATAN_ARU_2026.sql`, dibuat dari workbook yang diberikan untuk update ini.
- 1.247 baris valid disiapkan untuk database.
- 6 baris sumber yang tidak memiliki tanggal tidak dipaksakan / tidak ditebak.
- Nomor historis tidak standar tetap disimpan sebagai teks legacy.

Semua import/export dan perubahan format tetap masuk Audit Log.
