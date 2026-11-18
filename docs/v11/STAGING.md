# Staging, deployment dan rollback V11

Panduan interaktif untuk memasang kredensial, membuat data simulasi dan membuka SIAP ARU dari VPS tersedia di [VPS-SANDBOX.md](VPS-SANDBOX.md).

## Staging lokal

Gunakan schema kosong dan user database khusus staging. Schema dapat berada pada instance MySQL/MariaDB yang sama dengan aplikasi kantor, dengan izin user terbatas pada schema staging. Pengujian PR memakai instance lokal terpisah, Node.js 24 untuk runner UAT dan MariaDB 11.8.6 dari skema kosong serta penyimpanan lampiran privat per run.

1. Buat skema kosong bernama `siap_aru_sqa_v11_<suffix>` pada koneksi database yang ditentukan. Buat user `v11_stage_<suffix>` dengan izin skema tersebut. Atur lokasi unggahan privat absolut.
2. Atur environment lokal di luar repo. Pakai `DB_HOST=127.0.0.1`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `UPLOAD_DIR`, `SESSION_SECRET`, `SIAP_V11_ENABLED=1`, dan `SIAP_V11_STAGE=1`. Atur `SIAP_V11_STAGE_URL` ke URL loopback pada port bebas dan `SIAP_V11_STAGE_PROFILE` ke path JSON privat yang belum ada.
3. Buat nilai privat untuk `SIAP_V11_STAGE_PASSWORD` (minimum 16 karakter) dan `SIAP_V11_WEBHOOK_SECRET` (minimum 32 karakter). Atur `SIAP_V11_MEKARI_MODE=mock` untuk demo. Akun fixture memakai domain `@simulasi.siap.invalid` dan hanya digunakan di staging.
4. Jalankan `npm ci`, `npm run v11:bootstrap`, `npm run typecheck`, `npm run build`, dan `npm run v11:start` dari branch fitur. Profil privat mencatat daftar akun SIMULASI. `v11:start` mencocokkan marker database, lalu mengikat proses ke loopback.
5. Untuk pengujian, siapkan Chromium (misalnya `npx playwright install chromium`) atau set `SIAP_V11_CHROMIUM` ke binary yang kompatibel. Set `SIAP_V11_UAT_OUTPUT` ke direktori absolut untuk bukti. Setelah tiga perintah instalasi/typecheck/build sukses untuk checkout yang sama, set `SIAP_V11_BUILD_CHECK_FILE` ke JSON privat berisi exit code ketiga perintah. Jalankan `npm run v11:uat` di jaringan yang sama dengan staging.
6. Perkenalkan alur dengan akun Sekretariat, Manager Operasional, Staff Operasional, Manager KSU, dan Finance. Buat surat penerimaan dan invoice baru berlabel SIMULASI. Lihat hasil parsial dan lunas, Nota Dinas persekot dengan SPB, serta Surat Keluar bertanda tangan manual atau mock.

Untuk bukti restore, buat skema kosong `<DB_NAME>_restore` di instance uji dan beri user uji akses yang sesuai. Set `SIAP_V11_RESTORE_SCHEMA` ke skema tersebut serta `SIAP_V11_BACKUP_FILE` ke path baru privat. Jalankan `node tests/v11/restore-check.mjs` sebelum UAT. Skrip membuat backup logis fixture, memulihkannya ke skema kosong kedua, dan membandingkan baris.

Bootstrap menolak schema berisi tabel. Untuk menjalankan set baru dari kosong, sediakan skema dan direktori baru. Akun simulasi dari bootstrap dibuat dengan kredensial privat milik operator. Pengaturan pemakaian produksi tetap berbeda.

## Penerapan yang perlu ditinjau operator

- Periksa SHA dan migrasi 10 serta 11 November di schema target, akun Sekretariat aktif, konfirmasi dua ID Manager yang resmi dan lingkup unit. Lakukan uji salinan data yang telah disanitasi.
- Ambil backup database dan penyimpanan lampiran. Uji restore pada lingkungan terisolasi. Pastikan tidak ada kode atau tugas V11 aktif pada build lama saat melakukan rollback.
- Setelah review, jalankan `database/migrations/2026-11-17-v11-workflow.sql`, `database/migrations/2026-11-18-v11-notifications.sql`, `database/migrations/2026-11-18-v11-mekari-attachments.sql`, dan `database/migrations/2026-11-18-v11-payment-documents.sql` pada schema yang benar. SQL berisi CREATE TABLE IF NOT EXISTS dan FK. Objek lama dan baris historis tidak ditulis ulang. Jangan menjalankan bootstrap demo pada database yang berisi data operasional.
- Masukkan pemetaan `OPS` dan `KSU` dalam `siap_v11_managers` setelah kedua ID dipastikan `role='MANAGER'` dan aktif. Jangan mengubah akun Manager Gedung atau histori.
- Build versi baru dari commit yang disetujui. Verifikasi health, login, lookup dua Manager, routing, validasi upload, penomoran dan privasi di staging. Tempatkan kredensial di konfigurasi privat operator.
- `SIAP_V11_ENABLED=1` mengaktifkan workflow pada dokumen baru. Matikan flag untuk menahan pembuatan jalur baru. Aturan dokumen V11 yang sudah tersimpan tetap aktif agar verifikasi, ledger dan pembayaran tidak terlewati.
- Rollback aplikasi sebelum ada data V11 dapat memakai build lama setelah memastikan data dan lampiran tetap tersedia. Jika sudah ada data V11, gunakan build kompatibel V11 dengan flag mati dan selesaikan atau rekonsiliasi pekerjaan aktif sebelum penggunaan build yang tidak membaca tabel V11. Pertahankan tabel tambahan. Restore ke lingkungan uji terlebih dahulu.
- Go/no-go kerja kantor berdasarkan hasil UAT, persetujuan SOP persekot dan penetapan dua Manager, pemeriksaan versi database/server, kebijakan keamanan dependency dan hasil sandbox bila akan diaktifkan.

## Mekari Sign

Di staging, mode mock/sandbox memerlukan profil database terpisah. Untuk pengujian Sandbox dari domain production, ikuti [Panduan uji Sandbox dari situs utama](MEKARI-SANDBOX.md). Dengan mode tanpa pengiriman, gunakan unggah manual PDF. Untuk sandbox eksternal, simpan `MEKARI_CLIENT_ID`, `MEKARI_CLIENT_SECRET` dan `SIAP_V11_WEBHOOK_SECRET` pada secret store. Aplikasi menandatangani request pada server menuju gateway HMAC sandbox. Pengiriman hanya bisa aktif dengan flag `SIAP_V11_MEKARI_ALLOW_SEND` dan daftar email uji `SIAP_V11_MEKARI_TEST_RECIPIENTS` milik penguji yang menyetujuinya. Gunakan file fiktif.

1. Untuk cek awal di Postman, pilih environment sandbox dan isi `client_id` serta `client_secret` di environment privat. Pastikan `host_url` menunjuk ke `https://sandbox-api.mekari.com`. Jalankan `Get Profile / Quota` dan `List Documents` dari folder `00 - MULAI DI SINI (Read Only)`. Gunakan jam sistem yang tersinkronisasi.
2. Dari staging yang dapat menjangkau sandbox, jalankan `npm run v11:mekari:smoke` dengan `SIAP_V11_STAGE=1` serta kredensial sandbox yang dimuat secara privat. Perintah ini hanya melakukan GET dan mencetak kode HTTP. UAT-043 lulus jika daftar dokumen mengembalikan 200 dengan HMAC valid dan 401 dengan HMAC yang sengaja dibuat salah.
3. Untuk UAT-045, mulai dari Surat Keluar fiktif yang menunggu tanda tangan. Aktifkan `SIAP_V11_MEKARI_MODE=sandbox` dan cantumkan semua alamat penguji di `SIAP_V11_MEKARI_TEST_RECIPIENTS`, dipisahkan koma. Dari akun Sekretariat buka **Mekari Sign Sandbox**, pilih PDF draf dan isi nama serta email setiap penandatangan. Pilih **Paralel** untuk mengundang semua sekaligus atau **Berurutan** untuk mengundang sesuai urutan pada form. Gunakan **Naikkan** dan **Turunkan** untuk mengubah urutan.
4. Klik **Prediksi Posisi Tanda Tangan** untuk meminta saran posisi pada PDF pilihan. Mekari memakai PDF draf dan daftar penandatangan untuk prediksi. Pilih saran untuk tiap penandatangan, lalu periksa halaman dan koordinat. Isi posisi manual apabila saran kosong atau akun sandbox belum memiliki fitur `predict_annotation` dan paket yang mendukungnya. Mekari mendokumentasikan bahwa prediksi membaca maksimal 50 halaman pertama. [Spesifikasi Predict Annotation](https://api-docs.esign.mekari.com/#tag/send-for-signature/POST/v1/documents/predict_annotations)
5. Klik **Ajukan Tanda Tangan Sandbox** satu kali. Cek status setelah penandatangan pertama selesai dan verifikasi bahwa PDF final baru tersedia setelah semua penandatangan selesai. Gunakan **Segarkan Status Mekari** dan **Unduh PDF final**. Saat menerbitkan surat, riwayat harus mencatat `MEKARI_SANDBOX`.

Origin publik callback staging yang valid dapat dimasukkan ke `SIAP_V11_MEKARI_CALLBACK_BASE_URL`. Hapus query token dari access log untuk rute ini. Token callback per pekerjaan divalidasi dengan perbandingan waktu konstan. Callback hanya mencatat pemberitahuan dan menduplikasi event dengan kunci unik. Pengecekan status ulang mengambil kondisi otoritatif dari Mekari. Download final dilakukan setelah completed. HTTP 424 menahan retry hingga interval yang ditentukan.

Pada kegagalan setelah create yang hasilnya tidak diketahui, status RECONCILE memberi ruang pemeriksaan manual sebelum mengulang proses. Sistem tidak mengirim ulang request pembuatan secara otomatis. Pengguna masih bisa memakai hasil PDF yang ditandatangani di luar sistem dan dicatat sebagai unggah manual. PDF mock diberi tanda SIMULASI.

Referensi vendor: [Mekari Sign API](https://api-docs.esign.mekari.com/) dan [HMAC Authentication](https://developers.mekari.com/docs/kb/hmac-authentication).
