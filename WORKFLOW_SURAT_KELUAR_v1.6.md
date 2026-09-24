# Workflow Surat Keluar — SIAP ARU v1.6

## Alur normal

1. **Staff Administrasi** membuat Draft Surat Keluar.
2. Staff dapat mengunggah file draft/original maksimal 10 MB.
3. Staff klik **Ajukan ke Manager** dan dapat menambah catatan + maksimal 5 lampiran proses.
4. **Manager** memilih:
   - Approve & Teruskan ke Direktur Operasional; atau
   - Kembalikan ke Staff.
5. **Direktur Operasional** memilih:
   - Approve & Teruskan ke Direktur Utama; atau
   - Kembalikan ke Staff.
6. **Direktur Utama** memilih:
   - ACC Final; atau
   - Kembalikan ke Staff.
7. ACC Final mengubah status menjadi `READY_TO_ISSUE`.
8. Staff membuka surat dan klik **Terbitkan Surat**.
9. Staff menentukan tanggal terbit dan dapat mengunggah file final/scan yang ditandatangani.
10. Status menjadi `ISSUED`; ledger nomor menjadi `ISSUED`.
11. File final dapat di-download dari Riwayat Proses.
12. Jika diperlukan, Manager/Direksi dapat membuat Disposisi lanjutan. Status Surat Keluar tetap `ISSUED`.

## Jika dikembalikan

Return dari Manager, Dirops, maupun Dirut selalu menghasilkan:

```text
RETURNED_STAFF
```

Staff membaca catatan reviewer, mengubah metadata/draft, menambah dokumen bila perlu, lalu klik **Ajukan ke Manager**. Approval dimulai ulang dari Manager agar versi revisi melewati seluruh chain.

## Lampiran per proses

Lampiran proses terhubung langsung ke action/timeline:

- SUBMIT
- APPROVE
- RETURN
- ISSUE
- CANCEL

Maksimum 5 file per aksi dan 10 MB per file. Sistem mencoba kompresi untuk attachment proses dan menyimpan versi terkompresi hanya bila lebih kecil.
