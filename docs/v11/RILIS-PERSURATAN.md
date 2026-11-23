# Rilis persuratan SIAP ARU di VPS

Jalankan dari sesi operator VPS yang mengelola PM2 `siap-aru`. Langkah ini untuk instalasi `/opt/apps/siap-aru` yang sudah memakai migrasi V11, dokumen pembayaran, Sandbox lampiran, dan ganti akun Root. Pilih waktu rilis saat pengguna dapat berhenti mengubah dokumen selama backup dan restart. Portal produksi memakai skema `aru_siap` dan port lokal 3200.

## Backup, pembaruan, dan pengecekan

```bash
(
  set -euo pipefail
  cd /opt/apps/siap-aru
  test "$(git branch --show-current)" = main
  test -z "$(git status --porcelain --untracked-files=no)"
  git fetch --no-tags origin main
  target="$(git rev-parse FETCH_HEAD)"
  git merge-base --is-ancestor HEAD "$target"
  migrations=(
    database/migrations/2026-11-18-persuratan-production.sql
    database/migrations/2026-11-18-letter-purge.sql
    database/migrations/2026-11-19-v11-invoice-payment-mode.sql
    database/migrations/2026-11-19-v11-bpk-nota-documents.sql
    database/migrations/2026-11-22-v11-nota-collaboration.sql
    database/migrations/2026-11-23-v11-nota-drafting-recipients.sql
    database/migrations/2026-11-23-v11-system-correspondence.sql
    database/migrations/2026-11-23-v11-correspondence-word.sql
    database/migrations/2026-11-23-bank-account-lock-mandiri.sql
  )
  for migration in "${migrations[@]}"; do
    git cat-file -e "$target:$migration"
  done
  git log -1 --oneline "$target"

  unset MYSQL_PWD
  db_args=(--no-defaults --protocol=socket -uroot)
  if ! mariadb "${db_args[@]}" aru_siap -Nse 'SELECT 1' >/dev/null 2>&1; then
    db_args+=(-p)
  fi

  umask 077
  mkdir -p /root/siap-aru-backups
  backup="$(mktemp -d /root/siap-aru-backups/persuratan-XXXXXXXX)"
  git rev-parse HEAD > "$backup/commit-sebelum-rilis.txt"
  mariadb-dump "${db_args[@]}" --single-transaction --quick aru_siap |
    gzip > "$backup/aru_siap.sql.gz"
  gzip -t "$backup/aru_siap.sql.gz"

  upload_dir="$(node -e "require('@next/env').loadEnvConfig(process.cwd(),false);process.stdout.write(require('path').resolve(process.env.UPLOAD_DIR||'./storage'))")"
  tar -czf "$backup/lampiran.tar.gz" -C "$upload_dir" .
  tar -tzf "$backup/lampiran.tar.gz" >/dev/null
  if [ -f .next/siap-static-rilis.tar.gz ]; then
    cp .next/siap-static-rilis.tar.gz "$backup/next-static.tar.gz"
  elif [ -d .next/static ]; then
    tar -czf "$backup/next-static.tar.gz" -C .next static
  fi
  printf 'Backup tersimpan di %s\n' "$backup"

  git pull --ff-only origin main
  test "$(git rev-parse HEAD)" = "$target"
  npm ci --include=dev
  npm run typecheck
  npm run build
  tar -czf .next/siap-static-rilis.tar.gz -C .next static
  if [ -f "$backup/next-static.tar.gz" ]; then
    tar --skip-old-files -xzf "$backup/next-static.tar.gz" -C .next
  fi

  cat "${migrations[@]}" | mariadb "${db_args[@]}" aru_siap
  if [ -d .next/standalone ]; then
    cp -a public .next/standalone/
    cp -a .next/static .next/standalone/.next/
  fi
  pm2 restart siap-aru --update-env
  curl -fsS --retry 10 --retry-connrefused --retry-delay 2 --max-time 5 http://127.0.0.1:3200/api/health
  printf '\n'
  pm2 save
  git log -1 --oneline
)
```

Ketik password admin MariaDB saat muncul prompt. Jika backup basis data atau lampiran gagal, periksa penyebabnya sebelum meneruskan rilis. Jika proses berhenti di migrasi atau build, lihat baris error pertama. Migrasi bisa dijalankan ulang. Setelah restart, health yang diharapkan ialah `{"ok":true,"status":"healthy","database":"connected"}`.

Satu rilis aset statis sebelumnya tetap tersedia setelah restart untuk tab yang masih memuat versi lama. Arsip `.next/siap-static-rilis.tar.gz` berisi aset build baru saja, sehingga rilis berikutnya mengambil satu set aset sebelumnya.

## Verifikasi dari situs utama

- Sebagai pengguna, buka **Profil Saya** dari avatar dan simpan nama. Sebagai Root Admin, buka **User & Role → Edit Profil** untuk mengubah nama atau email login pengguna. Cari `USER_PROFILE_UPDATE` di Audit Log untuk melihat pelaku dan nilai sebelum serta sesudah perubahan.

- Setelah restart, buka **Surat Masuk**, **Nota Dinas**, **Surat Keluar**, dan **Disposisi** dari tab baru dan tab yang sudah terbuka sebelum rilis. Jika halaman menampilkan pesan gagal dimuat, klik **Muat ulang halaman** untuk mengambil tampilan terbaru.
- Sebagai Sekretariat, buka Surat Masuk dan Surat Keluar. Daftar awal memuat semua surat yang dapat diakses. Gunakan **Antrian Sekretariat** untuk memfilter ke pekerjaan yang masih berada di Sekretariat.
- Buka satu lampiran PDF simulasi lewat **Pratinjau**. Untuk menguji undangan, gunakan dokumen dan email penguji yang disetujui mengikuti [panduan Mekari Sandbox](MEKARI-SANDBOX.md).
- Sebagai Root Admin, buka **Pengaturan Persuratan** lalu pastikan pilihan tujuan Surat Masuk dan PIC sesuai akun dan unit perusahaan. **Sampah** menyediakan **Pulihkan** dan **Hapus Permanen**. Uji hapus permanen hanya pada surat simulasi yang dibuat untuk uji tersebut. Masukkan alasan dan ketik `HAPUS PERMANEN`. Status tanda tangan aktif, catatan Finance yang terhubung, dan rujukan bisnis dapat mencegah penghapusan.
- Sebagai Staff atau PIC, buka **Keuangan → Bukti Pengeluaran (BPK)**. Buat draf simulasi dan cek PDF. Dari invoice simulasi, **BPK untuk Invoice** mengisi data awal dan menautkan PDF saat BPK diajukan.
- Buat Surat Keluar dan Nota Dinas fiktif dengan **Buat dari sistem (PDF ARU)**. Periksa kop, tanggal, nomor, tujuan, isi, ruang tanda tangan, dan pratinjau. Buat satu dokumen dengan tabel dan satu dengan paragraf saja. Ulangi dengan **Unggah sendiri**. Setelah Nota Dinas diajukan, reviewer dapat membuka PDF dan menggunakan **Tanggapan**.
- Dari akun Manager, Dirops, atau Dirut, klik **Minta Staff Siapkan Nota Dinas**. Dari notifikasi Staff, isi draf dan beberapa tujuan, lalu klik **Serahkan Draf ke Pengirim**. Pengirim memeriksa dan menyiapkan tanda tangan. Pastikan penerima tambahan dapat membuka nota setelah dikirim atau disetujui.
- Saat Mekari Sandbox lampiran aktif, gunakan **Minta bantuan Sekretariat**. Akun Sekretariat yang ditunjuk bisa membuka **Tanda Tangan Mekari Sandbox** pada PDF utama, menyegarkan status, dan memastikan hasil terlihat pada akun pengirim.
- Uji hasil disposisi Dirut yang ditugaskan langsung ke Manager. Periksa urutan **Review Dirops → Review Dirut → Selesai**. Dari detail tugas selesai, unduh **Lembar Disposisi (PDF)** dan **Unduh Riwayat (.xlsx)**.


## Format PDF ARU dan sumber penomoran

**Buat dari sistem (PDF ARU)** memakai perihal, tujuan, tanggal, serta nomor yang disimpan SIAP. Isi utama dicetak lebih dulu, lalu paragraf dan tabel tambahan sesuai urutannya. Kolom **Keterangan lampiran** bersifat opsional. Blok tanda tangan bisa di kiri, tengah, atau kanan. Ulangi pilihan posisi untuk memakai baris berikutnya. Di Mekari Sandbox, pilih PDF yang dibuat SIAP lalu klik **Pakai posisi dari draf** dan isi email penguji. Nama pada blok PDF menunjukkan penandatangan yang dimaksud. Tanda tangan tetap mengikuti proses Mekari atau unggahan bukti.

Pada detail Surat Keluar dan Nota Dinas yang dibuat sistem, **Unduh Word Draf** menyediakan `.docx` yang bisa diedit dengan Arial 11 pada isi. PDF tetap tersedia untuk pratinjau dan tanda tangan. Setelah memperbarui isi, buat ulang atau unggah PDF terbaru sebelum mengajukan surat. PDF yang sudah disimpan sebelumnya tetap bisa ditinjau sesuai aksesnya.

**Edit Metadata** mengubah perihal, tujuan, dan isi utama. Setelah isi draf berubah, gunakan **Ubah Format / Buat Ulang PDF**, atau unggah versi terbaru. Pilih **Unggah sendiri** saat membuat draf jika PDF sudah disiapkan di luar SIAP.

Untuk menyematkan Arial, simpan `arial.ttf` dan `arialbd.ttf` berlisensi pada direktori yang bisa dibaca oleh proses PM2 dan isi `ARU_ARIAL_FONT_DIR` di konfigurasi aplikasi. Ukuran teks isi adalah 11 pt. Tanpa direktori Arial, aplikasi memakai Liberation Sans jika tersedia, lalu Helvetica. Uji satu PDF sesudah konfigurasi.

### Memakai workbook secara langsung

1. Aktifkan Google Sheets API pada proyek Google Cloud yang dipakai SIAP. Siapkan service account khusus dan simpan file JSON-nya di VPS dengan akses baca untuk akun proses PM2. Isi `ARU_SHEETS_SERVICE_ACCOUNT_FILE` dengan path absolut file, misalnya `/etc/siap-aru/google-sheets.json`. Muat ulang proses setelah pengaturan environment berubah.
2. Bagikan **workbook uji** sebagai **Viewer** kepada alamat `client_email` service account. Gunakan tautan edit atau tautan salin workbook yang dibagikan. Pada tautan salin, SIAP membaca workbook yang ditunjuk oleh `copySourceId`.
3. Dari **Root Admin → Pengaturan Persuratan → Sumber Nomor Surat**, tempel tautan dan klik **Uji koneksi Sheets**. Setelah lima tab terbaca, pilih **Google Sheets langsung** lalu klik **Simpan sumber nomor**. Ketika workbook utama siap, ulangi langkah ini dengan tautan baru.
4. Buat draf simulasi. Pada perkiraan nomor, pastikan sumber bertuliskan **Google Sheets + register SIAP**. Cek nomor yang tersimpan dan tercetak di PDF. Pilih **Data impor / register SIAP** untuk mengambil nomor dari register lokal. **Unduh register Excel** termasuk tab Nota Dinas yang dapat dilihat akun tersebut. Impor historis tetap dari **Surat Keluar → Import Excel Lama**.

| Tab yang dibaca | Seri |
| --- | --- |
| Perjanjian Kerjasama | `P/{seq}/AR/{year}` |
| Surat Keluar- Direksi | `Dir/{seq}/AR/{year}` |
| Surat Keluar - Bag. Operasional | `Oprsl/{seq}/AR/{year}` |
| Purchase Order | `PO/{seq}/AR/{year}` |
| Surat keluar- Bag. umum | `UM/{seq}/AR/{year}` |

Tab memakai kolom **No. Surat** dan **Tanggal Surat** pada B4:C4. Nota Dinas menggunakan seri UM secara bawaan, dengan pilihan seri Operasional atau Direksi pada draf baru. Seri di luar tabel mengikuti penomoran SIAP. Pada mode Sheets, SIAP membaca dua kolom register setiap kali memperkirakan atau mereservasi nomor. Gangguan koneksi menghentikan pengambilan nomor untuk seri yang terhubung. Nomor diambil dari ruang urut per tahun dan ikut memperhitungkan reservasi lokal serta varian .1, .2, dan seterusnya. Baris bertanggal kosong tetap diperhitungkan sebagai slot terpakai ketika nomor itu bertabrakan.

Google Sheets digunakan dalam mode baca. Jika petugas juga mengambil nomor baru secara manual di Sheet, kedua aplikasi bisa mengambil slot sama pada waktu berdekatan. Gunakan satu jalur penerbitan nomor saat mulai beralih ke SIAP.


## Impor rekening koran dan kunci Finance

Di **Perbankan → Impor Rekening Koran**, pilih **BRI** untuk PDF IBBIZ atau **Mandiri** untuk PDF Account Statement. Pilih rekening tujuan atau biarkan nomor rekening dideteksi dari PDF. Setelah berhasil, **Lihat periode yang diimpor** membuka rekening dan periode tertera di PDF. PDF asli tersedia di **Dokumen Bank**. Pada format Mandiri yang didukung, validasi mencocokkan jumlah transaksi, total debit dan kredit, serta saldo tiap baris dengan ringkasan. Impor berhenti ketika pemeriksaan tidak cocok.

Root Admin memilih rekening di **Rekening Koran** lalu klik **Kunci untuk Finance** atau **Buka Kunci Finance**. Ketika terkunci, Finance dapat melihat dan mengunduh laporan. Perubahan data rekening, transaksi, saldo, impor, pembatalan impor, dan dokumen bank diblokir untuk Finance. Audit Log mencatat `BANK_ACCOUNT_LOCK` dan `BANK_ACCOUNT_UNLOCK`. Rekening yang ada mulai dalam keadaan dapat diedit oleh Finance hingga dikunci oleh Root Admin.
