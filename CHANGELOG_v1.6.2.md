# Changelog v1.6.2

## Finance
- Hapus konsep penutupan periode dari UI Finance.
- Current-year flexible editing + future planning window maksimum 4 bulan.
- Perjelas Draft vs Published/Data Aktif.
- Tambah inline Finance tutorial.
- Tetap mempertahankan YTD Manual, Auto Monthly, dan Hybrid.
- Tetap mempertahankan adjustment ledger + audit log + reversal.
- Reset periode lama berstatus CLOSED menjadi OPEN untuk kompatibilitas.
- Endpoint lama period-status dinonaktifkan agar periode tidak dapat ditutup kembali melalui API lama.
- Reversal mengikuti jendela periode edit v1.6.2.

## Attachment fix
- Perbaiki async form handling saat upload sehingga `form.reset()` tidak lagi membaca `currentTarget` yang sudah null.
- Ubah label deadline menjadi panduan administrasi, bukan penguncian periode.
