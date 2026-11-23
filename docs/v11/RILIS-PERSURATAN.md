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

- Setelah restart, buka **Surat Masuk**, **Nota Dinas**, **Surat Keluar**, dan **Disposisi** dari tab baru dan tab yang sudah terbuka sebelum rilis. Jika halaman menampilkan pesan gagal dimuat, klik **Muat ulang halaman** untuk mengambil tampilan terbaru.
- Sebagai Sekretariat, buka Surat Masuk dan Surat Keluar. Daftar awal memuat semua surat yang dapat diakses. Gunakan **Antrian Sekretariat** untuk memfilter ke pekerjaan yang masih berada di Sekretariat.
- Buka satu lampiran PDF simulasi lewat **Pratinjau**. Untuk menguji undangan, gunakan dokumen dan email penguji yang disetujui mengikuti [panduan Mekari Sandbox](MEKARI-SANDBOX.md).
- Sebagai Root Admin, buka **Pengaturan Persuratan** lalu pastikan pilihan tujuan Surat Masuk dan PIC sesuai akun dan unit perusahaan. **Sampah** menyediakan **Pulihkan** dan **Hapus Permanen**. Uji hapus permanen hanya pada surat simulasi yang dibuat untuk uji tersebut. Masukkan alasan dan ketik `HAPUS PERMANEN`. Status tanda tangan aktif, catatan Finance yang terhubung, dan rujukan bisnis dapat mencegah penghapusan.
- Sebagai Staff atau PIC, buka **Keuangan → Bukti Pengeluaran (BPK)**. Buat draf simulasi dan cek PDF. Dari invoice simulasi, **BPK untuk Invoice** mengisi data awal dan menautkan PDF saat BPK diajukan.
- Buat Nota Dinas fiktif, pilih **Buat PDF dari Isi Nota** atau **Unggah PDF sendiri**, lalu cek pilihannya di **PDF & Tanda Tangan Nota Dinas**. Setelah diajukan, reviewer dapat membuka PDF dan menggunakan **Tanggapan**. Periksa badge di detail dan notifikasi penerima.
- Uji hasil disposisi Dirut yang ditugaskan langsung ke Manager. Periksa urutan **Review Dirops → Review Dirut → Selesai**. Dari detail tugas selesai, unduh **Lembar Disposisi (PDF)** dan **Unduh Riwayat (.xlsx)**.
