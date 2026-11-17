# Hasil UAT SIAP ARU V11

17 November 2026 · Run 7BD1D23

**48 PASS, 0 FAIL, 2 SKIP dari 50 skenario.** Lihat hasil per kasus di [UAT.csv](UAT.csv).

- Aplikasi Next.js 14.2.35 standalone, mysql2 3.24.6, MariaDB 11.8.6, Node.js 24 dan Chromium headless. Login dan akses diuji dengan 12 akun SIMULASI yang dibuat oleh bootstrap.
- Uji menggunakan API HTTP sungguhan dan lampiran dari storage staging. Browser menjalankan registrasi dengan bukti dan pembuatan disposisi. Form penerimaan dan hasil tampil pada 390 px tanpa overflow horizontal. Form desktop diperiksa pada 1440 px.
- `npm ci`, `npm run typecheck`, dan `npm run build` keluar dengan kode 0.
- Dua pengajuan paralel memakai nomor dan variant yang berbeda. Catatan pembayaran paralel hanya menghasilkan satu transaksi untuk referensi yang sama. Verifikasi revisi, bukti dan akses telah diuji di API.
- Skema dasar dan 11 migrasi awal dibuat di lingkungan terisolasi. Migrasi V11 diterapkan dua kali. Snapshot data lama identik. Backup logis dipulihkan ke skema kosong lain dan baris dari 35 tabel cocok.
- Pengujian regresi memeriksa perubahan utang manual, Rekening Koran, impor PDF BRI fiktif dan deduplikasi, serta ledger custom/backdate. Sumber Finance dan Rekening Koran existing tetap memakai tabel semula.
- UAT-043 SKIP untuk panggilan HMAC ke vendor. HMAC full path dan query lulus secara lokal.
- UAT-044 PASS pada mock. Token yang salah ditolak dan webhook duplikat tercatat sekali.
- UAT-045 SKIP untuk signing vendor. Mock lulus pada polling, penyimpanan PDF final terproteksi, idempotensi dan penerbitan dengan provenance. PDF manual diuji pada UAT-036.

Fase awal menemukan deadlock reservasi nomor dan kegagalan konversi tanggal pada edit utang manual. Keduanya diperbaiki, lalu suite dijalankan lagi dari skema kosong. Dokumentasi staging dan cara mengulang demo ada di [STAGING.md](STAGING.md) dan [DEMO.md](DEMO.md).
