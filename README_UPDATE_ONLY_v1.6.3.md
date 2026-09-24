# SIAP ARU v1.6.3 — Finance Period Fix (UPDATE ONLY)

Patch kecil untuk SIAP ARU v1.6.2.

## Masalah yang diperbaiki
Upload Dokumen/Laporan Keuangan Bulanan dapat menampilkan `Periode tidak valid.` meskipun bulan yang dipilih valid (contoh Januari 2026).

Penyebab: kolom MySQL `DATE` dari `mysql2` dapat dikembalikan sebagai object JavaScript `Date`. Kode v1.6.2 mengubah object tersebut menjadi string seperti `Thu Jan ...` lalu mengambil 7 karakter pertama, sehingga validator tidak lagi menerima format `YYYY-MM`.

## Perbaikan
- Normalisasi periode Finance sekarang menerima:
  - `YYYY-MM`
  - `YYYY-MM-DD`
  - JavaScript `Date` hasil mysql2
- Validasi upload lampiran SUMMARY diperbaiki.
- Validasi upload lampiran ADJUSTMENT diperbaiki.
- Validasi Reverse Adjustment juga diperbaiki karena memakai pola yang sama.
- Tidak ada perubahan database.
- Tidak ada `.env.local`.

## Cara pasang
1. Stop server Next.js.
2. Extract ZIP ini ke root project SIAP ARU v1.6.2 dan Replace/Overwrite file yang sama.
3. Bersihkan cache `.next`.
4. Jalankan kembali `npm run dev`.

PowerShell:

```powershell
Ctrl + C
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev
```

Tidak perlu import SQL migration.
