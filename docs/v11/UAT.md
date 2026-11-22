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

## Pemeriksaan Sandbox eksternal dari VPS

UAT-043 **PASS** berdasarkan output terminal VPS dengan Node 20.20.2. Get Profile / Quota dan List Documents mengembalikan HTTP 200. List Documents dengan HMAC yang sengaja dibuat salah mengembalikan HTTP 401. Tes hanya melakukan GET dengan kredensial Sandbox yang dimasukkan secara privat.

Hasil kumulatif 50 skenario menjadi **49 PASS, 0 FAIL, 1 SKIP**. UAT-045 untuk pengiriman, penandatanganan dan PDF final pada Mekari Sandbox eksternal masih SKIP. Hasil ini menggabungkan suite staging dengan smoke VPS.

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

## Uji awal dengan pembatasan satu surat (riwayat)

Typecheck dan build lulus pada Node 20.20.2. Lima tes adapter dan suite regresi lokal lulus (48 PASS, 2 SKIP untuk panggilan vendor). Uji API dan Chromium memakai database lokal terisolasi, konfigurasi service tanpa mode staging, serta gateway simulasi. Surat lain, PDF lain, akun tanpa izin, dan email di luar daftar ditolak. Prediksi dua posisi, dua penandatangan berurutan, polling dan unduhan bukti uji lulus. Penerbitan ditolak lewat opsi Mekari maupun unggah manual. Setelah konfigurasi pilot dilepas, panel tersembunyi dan surat simulasi tetap ditolak saat diajukan untuk penerbitan.

[Langkah tes UAT-045 pada situs utama](MEKARI-SANDBOX.md)


## Sandbox per lampiran surat dan disposisi

Typecheck dan build lulus pada Node 20.20.2. Skema lokal menerima migrasi tambahan dua kali dengan snapshot baris lama identik. Backup dan restore mencocokkan 37 tabel. Lima tes adapter lulus.

Tes API dan Chromium di database terisolasi dengan gateway Mekari simulasi memproses dua PDF independen pada satu Surat Keluar dan satu laporan hasil disposisi. API menolak akun yang tidak berwenang, email di luar daftar, dan permintaan tanpa konfirmasi. Prediksi, kedua penandatangan, deduplikasi pengajuan serentak, polling dan unduhan lulus. Persetujuan disposisi dan penerbitan surat tidak berubah ketika PDF Sandbox selesai. UAT-045 lewat undangan Mekari eksternal masih menunggu uji dari VPS.

[Panduan deploy dan uji Sandbox per lampiran](MEKARI-SANDBOX.md)

## Validasi dokumen sebelum Finance

Build dan typecheck lulus pada Node 20.20.2. Regresi lokal mencatat 48 lulus, tanpa kegagalan. Dua skenario Sandbox eksternal dilewati oleh runner lokal.

UAT-019 memblokir instruksi pembayaran Invoice Masuk dengan SPK tertaut ketika dokumen dasar belum lengkap. UAT-024 menunjukkan bahwa Invoice Masuk tanpa referensi wajib memiliki berkas SPK, tanpa SPB. UAT-026 menguji Persekot dengan SPB lama dan syarat rekening vendor, serta Nota Dinas pembayaran nonpersekot tanpa SPB. Finance hanya menerima disposisi setelah Manager KSU membuat instruksi yang memenuhi syarat. Migrasi dapat diterapkan dua kali. Backup dan restore lokal mencocokkan 39 tabel.

## BPK, Nota Dinas dan lembar disposisi

19 November 2026 · Run 43C0C1B menghasilkan **64 PASS, 0 FAIL, 2 SKIP dari 66 skenario** dalam staging lokal. `npm ci`, typecheck, dan build sukses. Migrasi tambahan diterapkan dua kali dengan data lama identik. Backup dipulihkan dan diverifikasi pada 43 tabel.

| Kasus | Hasil |
| --- | --- |
| UAT-063 | Nota Dinas menerima PDF dari SIAP atau unggahan. Pengajuan tertahan sebelum ada tanda tangan. Revisi membatalkan keterkaitan PDF sebelumnya. Reviewer bisa melihat pernyataan tanda tangan manual dan mengirim tanggapan dengan lampiran. |
| UAT-064 | Hasil Manager dari penugasan langsung Dirut wajib melalui Dirops. Tugas lama yang masih di Dirut bisa dirutekan ulang. Peserta berwenang bisa mengunduh PDF saat tugas selesai. |
| UAT-065 | Pengajuan dan pengembalian BPK mandiri, neto dengan desimal, penomoran, bukti pembayaran, PDF BPK/SPB, dan tautan checklist invoice lulus. Setelah invoice beralih ke persekot, SPB bisa diunduh. |
| UAT-066 | Chromium 390 px dan 1440 px memverifikasi badge tanggapan, PDF Nota Dinas, form dan unduhan BPK, serta tombol PDF disposisi. |

Sepuluh tes adapter Mekari lulus. Uji tambahan memakai gateway simulasi untuk prediksi posisi, dua penandatangan berurutan, status tertunda, dan unduhan PDF final oleh reviewer setelah Nota Dinas diajukan. Akses hasil oleh akun lain ditolak. UAT-043 dan UAT-045 dilewati pada run lokal karena memerlukan koneksi vendor. Hasil smoke VPS sebelumnya tercatat di bagian Pemeriksaan Sandbox eksternal dari VPS.

Keempat kasus Pak Nor juga lulus pada skema terpisah. PT XYZ memperlihatkan hasil yang naik dari Staff ke Manager, Dirops, lalu Dirut, dengan PDF tersedia setelah selesai.

## Draf bersama dan balasan Nota Dinas

22 November 2026 · Run A78B931 menghasilkan **67 PASS, 0 FAIL, 2 SKIP dari 69 skenario** pada MariaDB lokal. Typecheck, build, sepuluh tes adapter Mekari, migrasi ulang dan pemulihan 43 tabel lulus. Dua uji Mekari eksternal dilewati.

| Kasus | Hasil |
| --- | --- |
| UAT-067 | Staff menyiapkan draf untuk Manager. Manager menunjuk Sekretariat, berkas bertanda tangan dapat diunduh dengan isi yang sama, dan revisi membatalkan keterkaitan tanda tangan lama. |
| UAT-068 | Chromium menguji Staff memilih Dirut sebagai pengirim. Dirut mengunggah PDF dan mengirim nota ke Manager. Staff penyusun tidak dapat memakai aksi kirim. |
| UAT-069 | Dirops mengirim balasan yang tertaut ke nota asal dan mewarisi sifat RAHASIA. Penerima balasan adalah pengirim resmi nota asal. |
