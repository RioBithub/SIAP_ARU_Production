# Mekari Sandbox untuk PDF di SIAP ARU

Sandbox dapat digunakan berulang kali pada PDF yang layak di Surat Masuk, Surat Keluar, Nota Dinas, dan lampiran Disposisi, termasuk laporan hasil tindak lanjut. Surat hasil disposisi juga bisa ditandatangani dari detail Surat Keluar. Setiap PDF mempunyai permintaan dan hasilnya sendiri. Akun Sekretariat atau Root menangani surat yang dapat mereka akses. Pengirim tugas, penerima tugas, pemilik disposisi saat ini, dan Root dapat menguji lampiran pada disposisi yang mereka tangani.

## Menyiapkan versi di VPS

1. Setelah penerapan disetujui, cocokkan commit rilis pada `main`, buat backup database dan penyimpanan lampiran, lalu ikuti [langkah deployment](STAGING.md#penerapan-yang-perlu-ditinjau-operator). Jalankan migrasi V11, notifikasi, dan Sandbox lampiran pada database SIAP ARU. Verifikasi Manager OPS dan KSU serta akun Sekretariat yang aktif.
2. Di konfigurasi privat service `siap-aru`, isi variabel berikut. `SIAP_V11_ENABLED=1` mengaktifkan alur V11 pada dokumen baru. Integrasi Sandbox juga dapat digunakan pada lampiran lama yang memenuhi akses dan format.
3. Build, restart PM2, cek `/api/health` dan buka detail surat serta disposisi dengan akun penguji.

| Variabel | Nilai |
| --- | --- |
| `SIAP_V11_MEKARI_MODE` | `sandbox` |
| `SIAP_V11_MEKARI_ATTACHMENT_SANDBOX` | `1` |
| `SIAP_V11_MEKARI_TEST_RECIPIENTS` | Email penguji yang disetujui, dipisahkan koma |
| `SIAP_V11_MEKARI_ALLOW_SEND` | `1` untuk mengaktifkan pengiriman undangan Sandbox |
| `MEKARI_CLIENT_ID` | Client ID HMAC Sandbox yang lulus smoke test |
| `MEKARI_CLIENT_SECRET` | Client Secret HMAC Sandbox |

Pengaturan di atas berlaku pada service dengan koneksi database yang dipakai production. `SIAP_V11_STAGE=1` berlaku khusus untuk staging terisolasi. Variabel pilot yang dulu menunjuk ke satu surat dan satu PDF sudah tidak dipakai. Client Secret dan konfigurasi privat tetap disimpan di VPS.

## Perintah rilis pada VPS

Mulai dari worktree production yang bersih dan verifikasi backup sudah tersedia. Pastikan commit rilis sudah ada di `origin/main`.

```bash
cd /opt/apps/siap-aru
git status --short --branch
git pull --ff-only origin main
npm ci --include=dev
npm run typecheck
npm run build
```

Sebelum restart, jalankan tiga file SQL yang tercantum di [langkah deployment](STAGING.md#penerapan-yang-perlu-ditinjau-operator) pada skema `aru_siap` memakai akun admin database. Gunakan prompt password atau konfigurasi privat administrator, sesuai metode autentikasi VPS. Jika build gagal, pertahankan proses berjalan dan selesaikan error sebelum restart.

Setelah migrasi, pemetaan Manager dan konfigurasi service siap, jalankan:

```bash
pm2 restart siap-aru --update-env
curl -fsS --retry 6 --retry-connrefused --retry-delay 1 http://127.0.0.1:3200/api/health
pm2 save
```

Buka situs utama dan verifikasi login, antrean Sekretariat, serta panel Sandbox pada satu PDF Surat Keluar dan satu PDF Disposisi.

## Menguji tanda tangan

1. Buka detail surat atau disposisi. Pilih **PDF untuk tanda tangan Sandbox**. Daftar memuat PDF asli atau tambahan dan PDF hasil disposisi, maksimal 10 MB.
2. Pastikan pengiriman PDF tersebut ke Mekari Sandbox diizinkan. Untuk demo, gunakan dokumen fiktif. Centang konfirmasi pada panel.
3. Isi nama dan email tiap penandatangan. Gunakan **Tambah Penandatangan** dan pilih **Paralel** atau **Berurutan** sesuai kebutuhan.
4. Klik **Prediksi Posisi Tanda Tangan**, pilih saran untuk tiap penandatangan dan periksa posisi. Jika akses fitur belum tersedia atau tidak ada saran yang valid, isi koordinat manual.
5. Klik **Ajukan Tanda Tangan Sandbox**. Penandatangan membuka undangan dari Mekari. Klik **Segarkan Status Mekari** untuk mengambil status dari Mekari setelah penandatangan bertindak.
6. Setelah `COMPLETED`, klik **Unduh PDF bukti Sandbox**. Setiap lampiran hasil tetap memakai aturan akses dokumen asal. Persetujuan disposisi, finalisasi, pencatatan pengiriman, dan penerbitan resmi dikerjakan melalui aksi SIAP ARU masing-masing.

Jika status `RECONCILE`, periksa request pada akun Sandbox Mekari sebelum mengirim ulang melalui prosedur operator. Satu permintaan per PDF menghindari undangan ganda, termasuk ketika respons vendor terputus. Unggah PDF versi revisi sebagai lampiran baru jika perlu memulai pengajuan baru setelah status sebelumnya dipastikan. Untuk menghentikan pengiriman, set `SIAP_V11_MEKARI_ALLOW_SEND=0` dan muat ulang service. Untuk menutup seluruh panel, set `SIAP_V11_MEKARI_ATTACHMENT_SANDBOX=0` dan muat ulang service.

## Data demo

Untuk staging yang berisi akun fiktif, [empat skenario Pak Nor](SKENARIO-PAK-NOR.md) dapat dimuat lewat runner `demo`. Di database production, masukkan contoh fiktif yang ingin ditampilkan dari antarmuka. Gunakan seri nomor SIMULASI dan siapkan dokumen terpisah untuk tiap demo. Simulasikan pencatatan pembayaran invoice pada staging yang memiliki ledger terpisah.

[Hasil UAT](UAT.md)
