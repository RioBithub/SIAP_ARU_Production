# SIAP ARU v1.8.0 — Review Finance, Status Baca, dan Disposisi Berantai

## Perubahan alur

- Surat Masuk tetap diregistrasi oleh Staff/Root. Saat registrasi dapat dipilih **Langsung ke Manager** atau **Melalui Finance terlebih dahulu**. Manager tujuan tetap wajib dipilih.
- Jalur biasa tidak berubah: Staff → Manager → Dirops → Dirut.
- Jalur opsional: Staff → Finance → Manager → Dirops → Dirut.
- Staff juga dapat memilih jalur Finance untuk Nota Dinas. Nota Dinas yang dibuat Finance langsung diajukan ke Manager. Manager/Dirops masih dapat menyelesaikan Nota Dinas sesuai kewenangannya.
- Jika jalur Finance dipilih, pengembalian dari Manager kembali ke Finance; Finance dapat mengembalikan kepada penyusun. Pengembalian Dirops/Dirut mengikuti tingkat sebelumnya. Surat Keluar tetap kembali ke penyusun dari seluruh level, dan pengajuan ulang dimulai dari Manager.
- Status `READY_TO_ISSUE` dan tindakan penerbitan Surat Keluar tetap terpisah. Perubahan ini tidak menghubungkan transaksi bank ke pendapatan/biaya.

## Untuk Diketahui dan tanda baca

- Surat Masuk biasa/penting dapat diketahui Manager tujuan, Finance yang dipilih, Dirops, dan Dirut sejak registrasi, tanpa menunggu giliran ACC.
- Surat Masuk baru secara default dibatasi pada pihak terkait; Staff tetap dapat memilih visibilitas lebih luas. Surat rahasia tetap dibatasi pada penerima jalur yang memiliki akses, pemilik tahap saat ini, pihak yang pernah berproses, dan Root. Akses awal berdasarkan jabatan Dirops/Dirut tidak membuka surat rahasia.
- Tombol **Tandai Sudah Dibaca** menyimpan waktu pertama pengguna menandai dokumen. Membuka detail saja tidak menandainya secara otomatis.
- Tanda baca tidak mengubah status, reviewer, atau hak persetujuan. Klik ulang tidak mengganti waktu pertama.
- Daftar menyediakan **Semua Surat**, **Perlu Review Anda**, dan **Untuk Diketahui • Belum Dibaca** pada Surat Masuk. Dashboard mempunyai tautan ke surat masuk yang belum ditandai dibaca.

## Disposisi

- Finance dapat menugaskan Staff. Staff tidak wajib melewati Finance dalam pengajuan biasa.
- Tugas mandiri dari Finance kepada Staff diperiksa Finance, kemudian Manager yang dipilih. Tugas langsung dari direksi ke Finance/Staff melewati Manager pemeriksa yang ditentukan sebelum naik ke direksi.
- Penerima yang sedang mengerjakan dapat membuat tugas lanjutan ke level lebih rendah. Tugas lanjutan mengembalikan hasil kepada pemberi tugasnya; tugas asal tetap mempertahankan jalur review awal.
- Hasil tugas asal baru bisa dikirim setelah semua tugas lanjutannya selesai diperiksa. Tugas lanjutan yang dikembalikan perlu **Kirim Ulang Tugas** oleh pemberinya.
- Disposisi lama dengan `review_step_index` kosong mempertahankan alur review lama; migration tidak memindahkan status atau pemilik tugas yang sudah ada.
- Detail menampilkan tugas asal, tugas lanjutan, jalur pemeriksa, histori, dan lampiran masing-masing. Berkas disposisi private diperiksa berdasarkan akses tugas, meskipun surat sumber bersifat public.

## Dokumen dan batas unggahan

- Nota Dinas mendukung Word `.doc`/`.docx`, PDF, dan tipe lampiran yang sudah didukung sebelumnya.
- Dokumen utama **tidak dikompresi** dan dibatasi **10 MB**.
- Lampiran tambahan/proses: maksimal **5 file**, **10 MB per file**, dan **50 MB total sebelum kompresi** per aksi. Saat membuat surat, total dokumen utama beserta seluruh tambahan juga maksimal 50 MB.
- Lampiran tambahan memakai gzip hanya jika hasilnya lebih kecil; unduhan mengembalikan berkas aslinya. Format PDF/DOCX/gambar yang sudah efisien tidak dipaksa menjadi lebih besar.
- Pihak yang berwenang dapat menambah catatan/lampiran tanpa memindahkan status. Catatan, berkas, perpindahan status, dan audit pada aksi baru disimpan dalam transaksi yang sama. Bila gagal, perubahan dibatalkan dan file baru dibersihkan.
- Sesuaikan batas request reverse proxy Nginx jika masih lebih kecil daripada batas unggahan aplikasi. `client_max_body_size 55m;` memberi ruang bagi maksimal 50 MB berkas beserta multipart overhead; terapkan pada konfigurasi domain SIAP yang persisten di HestiaCP jika diperlukan.

## Migration production

Prasyarat: database production sudah sesuai v1.7.1. Backup database melalui phpMyAdmin, lalu jalankan **satu kali**:

`database/migration_v1.7.1_to_v1.8.0_finance_workflow_reads.sql`

Migration hanya menambah kolom, index, foreign key, dan tabel tanda baca/jalur pemeriksa. Tidak ada penghapusan data atau penggantian database/storage. Kolom baru nullable sehingga kode lama masih dapat berjalan selama migration disiapkan. File ini bukan dump untuk menimpa database production.

## Deployment setelah PR di-merge ke main

1. Ambil source dan jalankan pemeriksaan tipe:

```bash
cd /opt/apps/siap-aru &&
git pull --ff-only origin main &&
npm ci &&
npm run typecheck
```

2. Sebelum menjalankan kode v1.8.0, import migration di atas melalui phpMyAdmin pada database `aru_siap`. Hentikan deployment jika migration gagal.

3. Setelah migration berhasil:

```bash
cd /opt/apps/siap-aru &&
npm run build &&
pm2 restart siap-aru --update-env &&
pm2 save &&
curl -I http://127.0.0.1:3200/login &&
curl -I https://siap.aruraharja.co.id/login
```

Rangkaian `&&` menghentikan tahap berikutnya jika pemeriksaan/build gagal. Hanya proses `siap-aru` yang di-restart. Target login HTTP 200.

## Validasi pengembangan

```bash
npm run typecheck
npm run test:workflow
npm run build
```

Tes workflow memerlukan Node.js >=22.13 dan menggunakan database SQLite sementara dengan adapter sintaks MySQL untuk menjalankan handler aplikasi sebenarnya. Tes memeriksa route, permission, return/resubmit, idempotensi tanda baca, disposisi berantai, privasi lampiran, kompresi, batas unggahan, dan rollback. Ini tidak menggantikan pemeriksaan migration pada MySQL/MariaDB serta smoke test production setelah deployment.
