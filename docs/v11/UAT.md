# Hasil UAT SIAP ARU V11

18 November 2026 · Run DE10F30

**48 PASS, 0 FAIL, 2 SKIP dari 50 skenario.** Lihat hasil per kasus di [UAT.csv](UAT.csv).

- Aplikasi Next.js 14.2.35 standalone, mysql2 3.24.6, MariaDB 11.8.6, Node.js 24 dan Chromium headless. Login dan akses diuji dengan 12 akun SIMULASI yang dibuat oleh bootstrap.
- Uji menggunakan API HTTP sungguhan dan lampiran dari storage staging. Browser menjalankan registrasi dengan bukti dan pembuatan disposisi. Form penerimaan dan hasil tampil pada 390 px tanpa overflow horizontal. Form desktop diperiksa pada 1440 px.
- `npm ci`, `npm run typecheck`, dan `npm run build` keluar dengan kode 0.
- Dua pengajuan paralel memakai nomor dan variant yang berbeda. Catatan pembayaran paralel hanya menghasilkan satu transaksi untuk referensi yang sama. Verifikasi revisi, bukti dan akses telah diuji di API.
- Skema dasar dan 11 migrasi awal dibuat di lingkungan terisolasi. Migrasi V11 dan notifikasi diterapkan dua kali. Snapshot data lama identik. Backup logis dipulihkan ke skema kosong lain dan baris dari 36 tabel cocok.
- Pengujian regresi memeriksa perubahan utang manual, Rekening Koran, impor PDF BRI fiktif dan deduplikasi, serta ledger custom/backdate. Sumber Finance dan Rekening Koran existing tetap memakai tabel semula.
- UAT-043 SKIP untuk panggilan HMAC ke vendor. HMAC full path dan query lulus secara lokal.
- UAT-044 PASS pada mock. Token yang salah ditolak dan webhook duplikat tercatat sekali.
- UAT-045 SKIP untuk signing vendor. Mock lulus pada polling, penyimpanan PDF final terproteksi, idempotensi dan penerbitan dengan provenance. PDF manual diuji pada UAT-036.

Fase awal menemukan deadlock reservasi nomor dan kegagalan konversi tanggal pada edit utang manual. Keduanya diperbaiki, lalu suite dijalankan lagi dari skema kosong. Dokumentasi staging dan cara mengulang demo ada di [STAGING.md](STAGING.md) dan [DEMO.md](DEMO.md).

## Pengujian ulang setelah pencocokan koleksi Postman

Run A4292C3 pada staging lokal dari skema kosong menghasilkan 48 PASS, 0 FAIL dan 2 SKIP. Uji lokal memakai skrip pre-request koleksi Postman dan data fiktif. Header HMAC GET dengan query dan `Digest` untuk byte JSON yang membawa PDF cocok dengan request SIAP ARU. Gateway simulasi menerima pengiriman, mengembalikan status, dan menunda PDF dengan HTTP 424 sebelum unduhan berhasil. Regresi header bisa dijalankan dengan `node --test tests/v11/mekari-sign.test.mjs`.

UAT-043 dan UAT-045 tetap SKIP untuk gateway vendor. Kredensial sandbox belum tersedia dan pemeriksaan koneksi dari lingkungan uji mengalami timeout. Lihat [langkah pengujian sandbox di staging](STAGING.md#mekari-sign).

## Multi-signer dan Predict Annotation

Run 1FBAFB7 mengulang 50 skenario pada skema baru. Hasilnya 48 PASS, 0 FAIL dan 2 SKIP. Empat tes adapter lulus untuk Digest, format berurutan dan paralel, validasi penandatangan, serta permintaan dan respons prediksi.

Uji tambahan menjalankan SIAP ARU dalam mode sandbox dengan gateway Mekari simulasi dan dua alamat fiktif. Dari browser 390 px, Sekretariat bisa meminta saran, memilih posisi per penandatangan, mengubah koordinat, dan mengubah urutan. Setelah pengiriman tunggal, simulasi tetap `IN_PROGRESS` ketika baru satu penandatangan selesai. PDF final dapat diunduh dan surat diterbitkan setelah `COMPLETED`. Uji API juga memverifikasi pengiriman paralel dan penolakan akses atau alamat uji yang tidak valid.

Panggilan vendor dan format konkret hasil AI masih perlu divalidasi di sandbox eksternal. Dokumentasi Mekari menerangkan bahwa `data.data` berisi respons AI mentah. SIAP ARU menampilkan koordinat dengan format anotasi yang bisa divalidasi. Sekretariat dapat mengisi posisi manual ketika hasilnya kosong atau berbeda format. [Spesifikasi Predict Annotation](https://api-docs.esign.mekari.com/#tag/send-for-signature/POST/v1/documents/predict_annotations)

## Setup kredensial pada VPS

18 November 2026. Setup interaktif diuji menggunakan MariaDB lokal pada port 3306 dan kredensial fiktif. Wizard berhasil membuat schema/user baru, melakukan bootstrap, dan menyimpan file JSON privat dengan izin 600. Password dan Client Secret tidak muncul pada rekaman terminal. Karakter kutip, dolar dan backslash pada secret tetap utuh.

Pengulangan setup memperbarui kredensial Mekari dan daftar email penguji. Schema, akun simulasi, password, marker dan tabel sentinel pada schema lain tetap sesuai hasil awal. Enam tes konfigurasi dan adapter lulus. Runner typecheck, build dan start lulus dengan konfigurasi staging dari file. Login melalui browser Chromium pada HTTP loopback berhasil menghasilkan sesi Sekretariat dengan cookie secure.

Koneksi HMAC ke layanan Mekari tetap menunggu kredensial sandbox operator dan jaringan VPS. [Panduan pemasangan](VPS-SANDBOX.md) memuat perintah setup, smoke, PM2, tunnel SSH dan skenario multi-signer.

## Empat kasus Pak Nor

Suite `tests/v11/demo-cases.mjs` lulus untuk keempat kasus pada data simulasi. Seed dijalankan dua kali dengan jumlah tetap empat dokumen utama. API web dan koneksi database dicocokkan melalui marker staging sebelum data dibuat.

| Kasus | Hasil |
| --- | --- |
| DEMO-1 Penawaran PT ABC | PASS. Tenggat dua hari kalender, hasil berupa surat balasan terbit dan tertaut ke tugas. Hasil diterima Direksi dan review dokumen asal diselesaikan |
| DEMO-2 Invoice CV Sinar Jaya | PASS. Menunggu Verifikasi, Disetujui dan cabang Ditolak tersedia. Pembayaran simulasi Rp45 juta lewat Finance dan ACC Manager KSU membuat sisa nol |
| DEMO-3 Proyek PT XYZ | PASS. Tugas turun Direksi–Manager–Staff, laporan diunggah dan kembali naik untuk ACC. Notifikasi baru tampil otomatis pada browser Staff |
| DEMO-4 Surat balasan | PASS. Review lengkap, PDF mock, nomor surat, bukti kirim dan arsip tercatat. Pencatatan pengiriman oleh Staff penyusun ditolak sesuai kewenangan Sekretariat |

Notifikasi diperiksa dengan akun penerima dan akun lain. Akun lain tidak dapat membaca daftar penerima atau mengubah penanda baca miliknya. Penandaan baca berulang mempertahankan waktu baca yang sama. Uji browser 390 px memeriksa label invoice dan membuka tugas melalui notifikasi. Panel notifikasi ditempatkan di luar header agar dapat dipakai pada layar ponsel.

Pengujian tambahan memigrasikan staging lama dari 35 menjadi 36 tabel, menjalankan migrasi kembali dan mencocokkan seluruh baris lama. Panduan presenter ada di [SKENARIO-PAK-NOR.md](SKENARIO-PAK-NOR.md).
