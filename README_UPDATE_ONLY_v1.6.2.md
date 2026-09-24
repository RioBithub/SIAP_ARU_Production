# SIAP ARU v1.6.2 — UPDATE ONLY Finance Flexible Periods

Update ini dipasang di atas SIAP ARU v1.6.1. Tidak ada `.env.local` di paket dan tidak ada full database.

## Yang berubah

- Tombol **Tutup Periode / Buka Kembali** dihapus dari alur Finance.
- Semua bulan dalam **tahun berjalan** dapat dikoreksi kembali.
- Finance/Root dapat menyiapkan bulan mendatang maksimal **4 bulan ke depan**, tetapi tidak melewati Desember tahun berjalan.
- Status yang menentukan data resmi di dashboard sekarang diperjelas:
  - **Draft** = data sementara, hanya Finance/Root.
  - **Published / Data Aktif** = data yang tampil ke Manager/Direksi.
- `+ Tambah`, `− Kurangi`, `Set Total`, `Reverse`, pengaturan YTD, perubahan status, dan upload dokumen tetap masuk Finance History/Audit Log.
- Panduan singkat Finance ditampilkan langsung pada dashboard.
- Bug upload lampiran `Cannot read properties of null (reading 'reset')` diperbaiki.
- Dokumen bulanan dapat dilengkapi kapan saja. Panduan upload 1–10 bulan berikutnya tidak mengunci periode.

## Cara pasang

1. Pastikan project sudah memakai v1.6.1.
2. Backup project dan database terlebih dahulu.
3. Import:
   `database/migration_v1.6.1_to_v1.6.2_finance_flexible_periods.sql`
4. Copy seluruh isi folder update ini ke root project SIAP ARU, lalu **Replace/Overwrite** file yang sama.
5. Jangan ubah `.env.local`.
6. Stop server Next.js lalu jalankan:

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev
```

## Perilaku periode

Jika sekarang September 2026, Finance dapat mengelola Januari–Desember 2026 karena 4 bulan ke depan dari September sudah melewati akhir tahun dan otomatis dibatasi Desember.

Jika sekarang Mei 2026, Finance dapat mengelola Januari–September 2026. Oktober–Desember belum dapat diedit sampai masuk ke jendela maksimal 4 bulan ke depan.

Data bulan lama tidak pernah dihapus ketika diperbaiki. Nilai terbaru menjadi posisi aktif, sementara histori perubahan tetap dapat dilihat melalui Finance History dan Audit Log.

## Catatan status data

`Published` bukan berarti periode terkunci. Published hanya berarti **angka aktif yang dilihat manajemen**. Finance tetap dapat melakukan koreksi pada periode yang masih berada dalam jendela edit. Setelah koreksi, audit trail tetap menyimpan perubahan sebelumnya.
