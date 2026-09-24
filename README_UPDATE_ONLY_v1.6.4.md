# SIAP ARU v1.6.4 — UPDATE ONLY

Patch ini dipasang di atas SIAP ARU v1.6.3. **Tidak berisi `.env.local` dan tidak mengubah konfigurasi database lokal.**

## Cara update
1. Stop Next.js (`Ctrl + C`).
2. Backup database bila diperlukan.
3. Import `database/migration_v1.6.3_to_v1.6.4_ar_ap_adjustments.sql` ke database `aru_siap`.
4. Copy seluruh file dari package update ini ke root project SIAP ARU dan pilih **Replace/Overwrite**.
5. Hapus cache Next.js:
   ```powershell
   Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
   ```
6. Jalankan kembali:
   ```powershell
   npm run dev
   ```
7. Opsional: jalankan `database/VERIFY_v1.6.4_AR_AP.sql` di phpMyAdmin untuk memastikan tabel/kolom baru tersedia.

## Cara pakai Piutang/Utang — ringkas
### Update harian
Pada mode **Ringkasan Cepat**:
- **+ Tambah** → menambahkan nominal ke angka sekarang.
- **− Kurangi** → mengurangi nominal dari angka sekarang.
- **Set Total** → mengganti posisi dengan total terbaru.
- Isi **Data per Tanggal** dan **Keterangan** lalu Simpan.

Semua perubahan masuk **Riwayat Perubahan** dan **Audit Log**.

### Kalau salah input
Jangan hapus history. Tekan **Reverse**, isi alasan, lalu sistem membuat pembalikan yang tercatat.

### Edit banyak angka sekaligus
Buka **Edit Posisi Lengkap** untuk mengubah tanggal posisi, outstanding, due ≤30 hari, jumlah item, semua bucket aging, dan catatan sekaligus.

## Dokumen/Laporan
Finance dan Root Admin sekarang dapat menekan **Hapus** pada lampiran. File memang dihapus, tetapi aktivitas penghapusannya tetap tercatat di Audit Log.

## Nota Dinas
Menu internal sekarang bernama **Nota Dinas**. Untuk alur Staff ke Manager/atasan:

`Staff membuat Nota Dinas + lampiran → Manager review → dapat diteruskan/di-approve/di-return sesuai workflow.`

Disposisi tidak digunakan Staff untuk mengajukan dokumen ke atas; disposisi tetap untuk instruksi/tindak lanjut dari pimpinan.
