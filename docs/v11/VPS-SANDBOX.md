# Menguji Mekari Sandbox melalui SIAP ARU di VPS

Gunakan branch `feat/aru-surat-v11-integration`. Setup ini menjalankan aplikasi Next.js SIAP ARU dengan schema simulasi baru dan proses PM2 `siap-aru-v11-sandbox`. Pengujian sebelumnya menggunakan Node.js 24. Contoh berikut memakai sesi root VPS dan PM2 milik root. Gunakan user Linux yang sama untuk setup dan proses staging.

## Mengambil versi pengujian

Jalankan pada VPS dari terminal SSH.

```bash
cd /opt/apps/siap-aru
git fetch origin feat/aru-surat-v11-integration
git worktree add --detach /opt/apps/siap-aru-v11-sandbox FETCH_HEAD
cd /opt/apps/siap-aru-v11-sandbox
node -v
npm ci --include=dev
```

Jika worktree tersebut sudah ada, perbarui checkout staging yang bersih dengan `git fetch origin feat/aru-surat-v11-integration` dan `git merge --ff-only FETCH_HEAD` dari direktori staging. Selesaikan perubahan lokal bila Git menolak pembaruan.

## Memasukkan kredensial

```bash
npm run v11:setup -- /etc/siap-aru-v11/stage.json
```

Pada pemasangan pertama, wizard meminta koneksi admin MySQL untuk membuat schema baru. Enter menerima socket lokal bila terdeteksi. Ketik `tcp` untuk memakai `127.0.0.1` dan masukkan port MySQL. Gunakan user admin MySQL yang memiliki izin membuat database dan user. Untuk autentikasi socket, password bisa kosong jika didukung oleh akun tersebut. Password admin hanya dipakai saat membuat schema dan user staging.

Wizard kemudian meminta port web staging. Nilai awalnya `33317`. Pilih port lain bila sedang dipakai. Tentukan password akun simulasi dengan minimal 16 karakter. Schema bernama `siap_aru_sqa_v11_<suffix>` dan akun database `v11_stage_<suffix>` dibuat otomatis. User tersebut mendapat izin untuk schema staging yang dibuat. Schema kosong mendapat migrasi dan 12 akun simulasi.

Setelah database siap, wizard meminta tiga isian.

| Isian terminal | Ambil dari |
| --- | --- |
| Client ID HMAC sandbox | `client_id` pada environment Postman sandbox yang berhasil diuji |
| Client Secret HMAC sandbox | `client_secret` dari environment yang sama |
| Email penguji | Alamat email milik penguji yang akan menerima undangan. Pisahkan dengan koma untuk beberapa penandatangan |

Client ID, Client Secret dan password dimasukkan dengan tampilan tersembunyi. JSON privat menyimpan konfigurasi dengan izin `600`. Data staging berada di direktori `runs` di sebelah file konfigurasi. Skrip memuat konfigurasi tersebut ke environment aplikasi setiap kali proses dimulai. Kutip, dolar dan karakter khusus pada secret disimpan sebagai teks JSON.

Untuk mengganti kredensial sandbox atau email penguji, jalankan kembali perintah setup dengan path yang sama. Skrip memverifikasi profil dan marker database sebelum menyimpan pengaturan Mekari. Akun simulasi tetap memakai password yang ditentukan saat schema pertama dibuat. Setelah perubahan, restart proses staging dengan perintah di bawah.

```bash
pm2 restart siap-aru-v11-sandbox
```

## Mengecek koneksi dan menjalankan aplikasi

```bash
node scripts/v11/run.mjs /etc/siap-aru-v11/stage.json smoke
node scripts/v11/run.mjs /etc/siap-aru-v11/stage.json migrate
node scripts/v11/run.mjs /etc/siap-aru-v11/stage.json typecheck
node scripts/v11/run.mjs /etc/siap-aru-v11/stage.json build
pm2 start scripts/v11/run.mjs --name siap-aru-v11-sandbox --interpreter node -- /etc/siap-aru-v11/stage.json start
pm2 save
curl -fsS http://127.0.0.1:33317/api/health
```

Perintah `smoke` memakai import TypeScript native Node.js. Jalankan dengan Node.js 22.18+ atau 24. Hasil yang diharapkan adalah List Documents HTTP 200 dengan HMAC valid dan HTTP 401 dengan HMAC salah. Get Profile juga ditampilkan. Kode HTTP membantu mendeteksi kredensial atau scope yang belum siap. Jika jaringan atau autentikasi gagal, perbaiki lalu ulangi `smoke` sebelum mengirim dokumen.

Ganti port health check jika memilih port lain pada wizard. Proses web mengikat ke loopback VPS. Kredensial dibaca dari file privat saat proses dimulai, termasuk setelah `pm2 restart`.

## Membuka SIAP ARU dari komputer penguji

Pada terminal komputer penguji, buka tunnel SSH menuju VPS. Ganti `ALAMAT_VPS` dengan host SSH yang biasa dipakai.

```bash
ssh -N -L 33317:127.0.0.1:33317 root@ALAMAT_VPS
```

Pertahankan terminal tunnel terbuka. Buka `http://127.0.0.1:33317/login` di browser komputer tersebut. Bila memilih port lain, sesuaikan port tujuan tunnel dan URL lokal. Jika aplikasi staging sudah memiliki subdomain HTTPS sendiri, operator dapat memakai reverse proxy subdomain itu menuju port staging.

## Akun dan skenario

Empat kasus dari Pak Nor dapat dimuat dengan `node scripts/v11/run.mjs /etc/siap-aru-v11/stage.json demo` setelah web staging berjalan. [Panduan demo Pak Nor](SKENARIO-PAK-NOR.md) memuat penawaran PT ABC, invoice Rp45 juta CV Sinar Jaya, proyek PT XYZ dan surat balasan.

Semua akun berikut memakai password simulasi yang dimasukkan saat setup pertama.

| Akun | Tugas |
| --- | --- |
| `staff@simulasi.siap.invalid` | Membuat Surat Keluar dan mengajukan draf |
| `ops@simulasi.siap.invalid` | Review Manager Operasional |
| `dirops@simulasi.siap.invalid` | Review Dirops |
| `dirut@simulasi.siap.invalid` | ACC final |
| `secretariat@simulasi.siap.invalid` | Menyiapkan penerbitan, mengatur tanda tangan, dan menerbitkan surat |
| `root@simulasi.siap.invalid` | Administrasi data simulasi |

1. Login sebagai Staff, buat Surat Keluar dengan subjek SIMULASI dan lampirkan PDF fiktif. Ajukan ke Manager Operasional.
2. Review sebagai Manager Operasional, kemudian Dirops dan Dirut sampai ACC final.
3. Login sebagai Sekretariat dan finalisasi nomor sampai surat berstatus menunggu tanda tangan.
4. Buka **Mekari Sign Sandbox**, pilih PDF, dan isi satu atau beberapa penandatangan memakai alamat penguji yang tercantum dalam setup.
5. Pilih **Paralel** atau **Berurutan**. Untuk berurutan, gunakan tombol naik/turun sesuai urutan yang diinginkan.
6. Klik **Prediksi Posisi Tanda Tangan** dan pilih saran untuk tiap penandatangan. Periksa posisi pada PDF. Posisi dapat diedit manual jika prediksi belum tersedia.
7. Klik **Ajukan Tanda Tangan Sandbox** satu kali. Para penguji menyelesaikan tanda tangan melalui undangan Mekari.
8. Klik **Segarkan Status Mekari**. Setelah semua selesai, unduh PDF final dan terbitkan surat dengan metode **Gunakan PDF final Mekari staging**.

## Jika ada kendala

| Kondisi | Tindakan |
| --- | --- |
| Access denied MySQL | Periksa user/password admin. Jika memakai socket auth, pilih path socket yang benar dan password sesuai akun. Wizard tidak membaca file default CLI MariaDB |
| Port aplikasi terpakai | Pada pemasangan pertama, pilih port staging lain. Sesuaikan health check dan SSH tunnel |
| HTTP 401 dari Mekari | Periksa pasangan HMAC sandbox dan jam sistem VPS |
| HTTP 403 dari Mekari | Periksa scope/akses akun. Predict Annotation juga memerlukan fitur `predict_annotation` dan paket yang mendukung |
| Prediksi kosong | Isi koordinat manual. Respons AI perlu sesuai dengan format anotasi yang bisa divalidasi SIAP ARU |
| Tidak ada panel Mekari | Pastikan checkout dan proses yang dibuka adalah staging ini. Gunakan akun Sekretariat pada Surat Keluar yang menunggu tanda tangan |
| Login web gagal | Periksa URL tunnel atau gunakan subdomain HTTPS staging. Uji dengan password simulasi yang dipilih dan periksa log proses staging |
| REQUESTING atau RECONCILE | Periksa dokumen di sandbox Mekari sebelum mencoba pengiriman lain |

Perintah `pm2 logs siap-aru-v11-sandbox --lines 50 --nostream` menampilkan log proses staging. Saat meminta bantuan, cukup berikan pesan error dan kode HTTP.
