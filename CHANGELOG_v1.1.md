# SIAP ARU v1.1 — Finance Simplification

Perubahan utama:

- Pendapatan, biaya, dan anggaran tidak lagi perlu diinput transaksi satu-per-satu untuk penggunaan awal.
- Ringkasan keuangan bulanan dapat diedit langsung dari kartu Dashboard Keuangan.
- Laba dihitung otomatis dari pendapatan dikurangi biaya.
- Periode dapat dipilih/backfill per bulan sehingga data bulan lama tetap dapat diisi.
- Dokumen laporan keuangan dapat diunggah per periode; acuan upload 1–10 bulan berikutnya.
- Upload setelah tanggal 10 tetap diterima namun ditandai terlambat.
- Lampiran Finance maksimal 10 MB dan dikompresi bila hasil kompresinya lebih kecil.
- Piutang dan utang tetap detail per invoice karena tanggal jatuh tempo wajib tersedia.
- Lampiran dapat ditambahkan ke setiap invoice piutang/utang.
- Aging tetap menggunakan 1-30, 30-60, 60-90, 90+.
- Dashboard utama menampilkan highlight keuangan dan grafik terlebih dahulu untuk role yang memiliki akses Finance.
- Menu Pendapatan/Biaya/Anggaran individual disederhanakan; URL lama diarahkan ke `/finance`.
- Audit log ditambah untuk update ringkasan Finance serta upload/download lampiran Finance.
