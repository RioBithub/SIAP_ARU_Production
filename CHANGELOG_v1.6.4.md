# SIAP ARU v1.6.4 — Piutang/Utang Adjustment + Nota Dinas

## Piutang & Utang
- Ringkasan Cepat tetap bisa diedit langsung melalui **Edit Posisi Lengkap**.
- Tambah update harian dengan **+ Tambah**, **− Kurangi**, dan **Set Total**.
- Berlaku untuk Total Outstanding, Jatuh Tempo ≤30 Hari, serta setiap bucket Aging.
- Setiap perubahan menyimpan nilai sebelum/sesudah, tanggal data, catatan, user, dan waktu input.
- Penyesuaian salah tidak dihapus: gunakan **Reverse** agar jejak tetap utuh.
- Setiap adjustment dapat memiliki lampiran pendukung.
- Tambah panduan singkat langsung di halaman Piutang/Utang.

## Dokumen Finance
- Finance/Root dapat **menghapus lampiran** dari Ringkasan Bulanan, Piutang, Utang, posisi ringkas, dan adjustment.
- File dihapus dari penyimpanan dan record lampiran dihapus.
- Aktivitas penghapusan tetap tercatat di **Audit Log** beserta nama file dan referensinya.

## Nota Dinas
- Menu **Pengajuan Internal** diganti menjadi **Nota Dinas**.
- Staff → Manager/atasan menggunakan **Nota Dinas + lampiran**.
- Disposisi tetap khusus instruksi/tindak lanjut pimpinan kepada PIC.
- Pembuatan dokumen internal baru hanya menggunakan tipe Nota Dinas; data Lembar Pengantar lama tetap dapat dibaca sebagai data historis.

## Database
Jalankan `database/migration_v1.6.3_to_v1.6.4_ar_ap_adjustments.sql` sebelum menjalankan source v1.6.4.
