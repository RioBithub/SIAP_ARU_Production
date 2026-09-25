# SIAP ARU v1.6.9 — Dashboard Bulan Ini + Tahun Berjalan

Update-only untuk dashboard utama.

## Perubahan
- Highlight Finance sekarang menjelaskan periode secara eksplisit.
- Pendapatan, Biaya, Laba, dan Anggaran menampilkan dua angka berdampingan:
  - Bulan Ini (contoh: September 2026)
  - Tahun Berjalan / YTD 2026
- Data yang belum dipublikasikan ditampilkan sebagai `Belum tersedia`, bukan Rp0.
- Setiap card menampilkan `Data bulan per ...` dan `YTD per ...`.
- Piutang/Utang diberi label `Posisi saat ini`, karena bukan angka kinerja bulanan.
- Grafik menjelaskan bahwa hanya bulan published yang ditampilkan.
- Label Pengajuan Internal di dashboard disederhanakan menjadi `Nota Dinas`.

## Instalasi
1. Stop `npm run dev`.
2. Copy folder `components`, `app`, dan `lib` dari update ini ke root project SIAP ARU.
3. Replace/overwrite file yang sama.
4. Hapus cache `.next` lalu jalankan ulang.

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev
```

Tidak ada SQL migration dan tidak ada `.env.local` pada package ini.
