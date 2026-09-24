# SIAP ARU v1.6.8 — Readable Nominal Inputs

- Semua input nominal utama Finance kini langsung memakai pemisah ribuan saat diketik.
- Format tampilan mengikuti Rupiah/Indonesia: `333333232323` tampil sebagai `333.333.232.323`.
- Nilai yang dikirim ke API/database tetap angka mentah (`333333232323`), jadi perhitungan backend tidak berubah.
- Berlaku pada penyesuaian Pendapatan/Biaya/Anggaran, pengaturan YTD, Piutang/Utang Ringkasan Cepat, aging, detail invoice, serta form nominal Finance legacy.
- Field non-nominal seperti tahun, jumlah item, nomor surat, dan tanggal tidak diubah.
- Tidak ada perubahan database.
