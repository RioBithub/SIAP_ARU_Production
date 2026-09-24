# SIAP ARU v1.3

## Finance Dual Mode
- Piutang dan Utang memiliki dua mode pengelolaan: Ringkasan Cepat dan Detail Invoice.
- Mode dapat diganti Finance/Root kapan saja tanpa menghapus data yang sudah tersimpan.
- Dashboard dan Aging otomatis mengambil sumber data dari mode aktif.
- Ringkasan Cepat mencatat posisi per tanggal, outstanding, jatuh tempo ≤30 hari, aging 1-30 / 30-60 / 60-90 / 90+, catatan, dan dokumen pendukung.
- Detail Invoice tetap mendukung tambah/edit invoice, pembayaran, due date, aging otomatis, dan lampiran per invoice.
- Manager, Direktur Operasional, dan Direktur Utama tidak melihat indikator teknis bahwa sumber data menggunakan Ringkasan Cepat.
- Lampiran Ringkasan Piutang/Utang maksimal 10 MB dan dikompresi jika efektif.
- Audit log mencatat perubahan mode dan perubahan posisi ringkas.

## Database
- Default database diperbaiki menjadi `aru_siap`.
- Tabel baru: `siap_finance_source_modes`.
- Tabel baru: `siap_finance_position_summaries`.
- `siap_finance_attachments` mendapat relasi `ledger_summary_id`.
- Disertakan full SQL phpMyAdmin-safe dan migration dari versi sebelumnya.
