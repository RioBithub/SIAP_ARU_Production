# SQA SIAP ARU

Suite Playwright menguji aturan aplikasi lewat API dan alur pengguna lewat Chromium. Setup menjalankan skema dasar, 11 migrasi lanjutan, dan seed fiktif pada satu database demo khusus. Gunakan checkout atau worktree terpisah karena build SQA menulis ke `.next` di checkout aktif.

## 1. Siapkan lingkungan uji

Siapkan Node.js 20 atau lebih baru, npm, MariaDB, dan `pdftotext` dari paket `poppler-utils`. Pengujian ini menggunakan Node.js 24.22.1 dan MariaDB 11.8.6. Database dan aplikasi SQA memakai loopback.

| Pengaturan | Nilai bawaan |
| --- | --- |
| Host dan port database | `127.0.0.1:33326` |
| Nama database dan user | `siap_aru_sqa` |
| Password user database demo | `siap-sqa-db-local` |
| Port aplikasi | `33317` |
| Halaman masuk | `http://127.0.0.1:33317/login` |

Jika sudah punya instance MariaDB lokal khusus SQA, beri user demo izin pada skema `siap_aru_sqa` saja. Untuk membuat instance lewat Docker, gunakan contoh berikut dan tunggu sampai MariaDB siap menerima koneksi.

```bash
docker run -d --name siap-aru-sqa-db \
  -p 127.0.0.1:33326:3306 \
  -e MARIADB_DATABASE=siap_aru_sqa \
  -e MARIADB_USER=siap_aru_sqa \
  -e MARIADB_PASSWORD=siap-sqa-db-local \
  -e MARIADB_ROOT_PASSWORD=siap-sqa-db-root-local \
  mariadb:11.8 --default-time-zone=+00:00
```

Bila perlu, ubah `SIAP_SQA_DB_PORT`, `SIAP_SQA_DB_USER`, `SIAP_SQA_DB_PASSWORD`, dan `SIAP_SQA_APP_PORT`. `SIAP_SQA_DB_NAME` menerima `siap_aru_sqa` atau nama berawalan `siap_aru_sqa_` dengan sufiks huruf kecil, angka, dan garis bawah. Server uji memeriksa penanda database SQA saat mulai dan memakai direktori unggahan khusus di `.sqa/uploads/`.

## 2. Buat data dan jalankan tes

```bash
npm ci
npx playwright install chromium
npm run sqa:db
npm run typecheck
npm run sqa:build
npm run sqa:test
```

Jika Linux belum memiliki dependensi Chromium, gunakan `npx playwright install --with-deps chromium`. Set `SIAP_SQA_CHROMIUM_PATH` bila perlu memakai executable Chromium yang sudah terpasang. Playwright menyalakan dan menutup aplikasi saat menjalankan suite. Satu skenario dapat dipilih dengan `npm run sqa:test -- --grep 'DIS-02'`.

Lihat `.sqa/report.json` untuk hasil terbaru. Jika ada kegagalan, lihat trace pada `.sqa/test-results/` dengan `npx playwright show-trace <path-ke-trace.zip>`. Skenario menulis data uji dan beberapa skenario memakai keadaan awal seed. Sebelum mengulang rangkaian lengkap, hentikan aplikasi manual yang sedang berjalan dan reset data.

```bash
npm run sqa:db -- --reset
npm run sqa:test
```

Reset membangun ulang database bertanda SQA beserta data awal dan membersihkan unggahan uji di direktori terkait. Untuk mencoba aplikasi secara manual, jalankan `npm run sqa:start` setelah build dan buka halaman masuk. Jalankan reset setelah tes jika ingin kembali ke data demo awal.

## 3. Ekspor atau impor SQL mandiri

`SIAP_ARU_SQA_Migrasi_dan_Data_Demo.sql` berisi skema, migrasi, dan seed untuk satu instance demo. Jalankan pada MariaDB uji dengan skema `siap_aru_sqa` yang kosong.

```bash
mariadb -h 127.0.0.1 -P 33326 -u siap_aru_sqa -p < SIAP_ARU_SQA_Migrasi_dan_Data_Demo.sql
```

Impor ini dapat menggantikan `npm run sqa:db` pada setup pertama. Setelah impor, jalankan `npm run sqa:build` dan `npm run sqa:start` untuk demo. Untuk menghasilkan SQL baru dari checkout yang sama, gunakan database kosong atau reset database SQA yang sudah ada.

```bash
npm run sqa:db -- --reset --export ./SIAP_ARU_SQA_Migrasi_dan_Data_Demo.sql
```

Seed memuat 9 akun, 4 surat contoh, 1 disposisi, format nomor, ringkasan bulanan dan tahunan, posisi piutang dan utang, serta 1 rekening dengan 2 mutasi. Gunakan periode Januari 2025 untuk contoh Rekening Koran. Ringkasan Keuangan dari perintah seed memakai bulan berjalan di Jakarta. SQL menyimpan periode saat diekspor. File PDF dan Excel fiktif untuk skenario pengujian dibuat oleh suite saat dijalankan.

## 4. Akun demo

Gunakan kredensial berikut hanya di lingkungan SQA lokal. Untuk mengubahnya sebelum membuat atau mereset database, atur `SIAP_SQA_DEMO_PASSWORD` dan `SIAP_SQA_ADMIN_PASSWORD` pada terminal yang sama saat menjalankan setup dan tes.

| Peran atau unit | Username | Password |
| --- | --- | --- |
| Staf Operasional | `staff@siap-test.invalid` | `test-workflow-2026` |
| Staf SDM | `other@siap-test.invalid` | `test-workflow-2026` |
| Sekretariat | `secretariat@siap-test.invalid` | `test-workflow-2026` |
| Manager Operasional | `manager@siap-test.invalid` | `test-workflow-2026` |
| Manager SDM | `manager2@siap-test.invalid` | `test-workflow-2026` |
| Direktur Operasional | `dirops@siap-test.invalid` | `test-workflow-2026` |
| Direktur Utama | `dirut@siap-test.invalid` | `test-workflow-2026` |
| Staf Keuangan | `finance@siap-test.invalid` | `test-workflow-2026` |
| Root Admin | `root@siap-test.invalid` | `Sqa-Admin-2026!` |

## 5. Cakupan dan tindak lanjut temuan

Hasil 12 November 2026 pada database kosong yang diisi dari SQL demo adalah 56 lulus, 0 gagal, dan 0 dilewati. Build, typecheck, bootstrap migrasi, dan reset database SQA juga berhasil.

| Kelompok | Skenario | Bagian yang diuji |
| --- | ---: | --- |
| Sistem, login, administrasi | 8 | Health, akun per peran, password, logout, role dan unit, jenis surat, format, audit |
| Persuratan | 18 | Surat Masuk, Nota Dinas, Surat Keluar, jalur lama, revisi, terbit, kirim, arsip, Excel, SPK, invoice |
| Disposisi | 6 | PIC, review hasil, delegasi, lampiran, Surat Keluar hasil, beberapa PIC, visibilitas |
| Keuangan | 10 | Publikasi, YTD, reversal, piutang dan utang, aging, lampiran, API lama |
| Perbankan | 7 | Master rekening, mutasi, saldo, Excel, dokumen, impor PDF BRI, koreksi, undo |
| Chromium | 7 | 16 menu utama, login dan logout, layar 390 px, antrean, draf Nota Dinas, status kirim, cetak PDF |

Perbaikan dalam cabang SQA mencakup akses draf Nota Dinas privat, pembaruan nominal piutang dan utang dengan tanggal yang sudah tersimpan, serta visibilitas ringkasan tahunan dan lampiran bulanan sebelum publikasi. Tes regresi memeriksa perubahan tersebut.

Lingkup pengujian meliputi fungsi yang tersedia di checkout ini. Pengujian browser memakai Chromium desktop dan viewport 390 px. Tanda tangan memakai dokumen sintetis, sedangkan status kirim diperiksa sebagai pencatatan pengiriman. BPK dan Persekot masih berupa rancangan dalam catatan proyek.
