# UPDATE ONLY — SIAP ARU v1.6 → v1.6.1

Paket ini hanya berisi file yang berubah / bertambah. Tidak ada `.env.local` dan tidak ada full project.

## Urutan instalasi
1. Backup database `aru_siap` dan folder project v1.6.
2. Import `database/migration_v1.6_to_v1.6.1_finance_daily_ytd_adjustments.sql` melalui phpMyAdmin.
3. Copy isi folder update ini ke root project SIAP ARU v1.6 dan izinkan overwrite file yang sama.
4. Stop Next.js (`Ctrl+C`).
5. Hapus cache build bila perlu: `Remove-Item -Recurse -Force .next` (PowerShell).
6. Jalankan kembali `npm run dev`.

## Tidak perlu dilakukan
- Tidak perlu mengubah `.env.local`.
- Tidak perlu import ulang full database.
- Tidak perlu menghapus data Finance lama.

## Setelah update
Login sebagai Finance atau Root lalu buka **Finance → Ringkasan & Dokumen**.

Pertama kali untuk tahun berjalan:
- klik **Pengaturan YTD**;
- pilih mode;
- untuk transisi dari data lama disarankan **Basis Manual + Bulanan Terpilih**;
- isi basis YTD dan cut-off (mis. s.d. Agustus);
- Publish.

Kemudian untuk September dan bulan berikutnya:
- update melalui `+ Tambah`, `− Kurangi`, atau `Set Total`;
- isi `Data per Tanggal`;
- pilih apakah bulan masuk YTD;
- Publish ketika angka siap dilihat manajemen;
- akhir bulan dapat `Tutup Periode`.
