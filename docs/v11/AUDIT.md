# Audit independen SIAP ARU untuk ARU-SURAT V11

Basis audit: [main 19c308ca452adbd3178fd98861b7f1fa191663d0](https://github.com/RioBithub/SIAP_ARU_Production/commit/19c308ca452adbd3178fd98861b7f1fa191663d0).
GitHub API dan `git ls-remote` sama. Checkout bersih. Audit memeriksa handler, SQL dan UI secara terpisah dari prototipe.
PR #7 telah masuk main. Paket tes dan migrasi lokal PR #8 serta alur Finance di PR #5 masih terpisah.

| Temuan pada main | Status | Bukti kode | Perbedaan dengan target dan prioritas |
|---|---|---|---|
| Next.js 14.2.32, TypeScript, mysql2, MySQL/InnoDB | Sudah ada | `package.json`, `next.config.mjs`, `lib/db.ts:makePool` | P0. Pertahankan Next.js standalone dan transaksi MySQL. |
| Autentikasi sesi, role, ACL dan unduh | Sudah ada | `lib/auth.ts:getCurrentUser`, `lib/letter-access.ts`, `lib/disposition-access.ts`, `app/api/attachments/[id]/route.ts:GET` | P0. Bukti keuangan dan penerimaan V11 perlu ACL peserta. |
| Alur Sekretariat bergantung akun aktif | Sebagian | `app/api/letters/route.ts:POST`, `lib/correspondence-data.ts:hasActiveSecretariat`, migrasi 11 November | P0. Staff masuk ke antrean dan Sekretariat dapat langsung registrasi. Reviewer awal masih dapat dipilih dari Direksi. |
| Data penerimaan | Sebagian | `siap_letters.received_date`, `letters/[id]/actions:REGISTER_INCOMING` | P0. Jam WIB, identitas, metode dan bukti wajib belum ada. |
| Dua Manager | Perlu keputusan | `lib/correspondence-data.ts:activeReviewer`, `app/api/users/lookup`, arsip SQL v1.6 | P0. Seed historis punya Manager Gedung. Jumlah akun live belum diketahui. Penetapan dua ID harus eksplisit. |
| SPK dan invoice | Sebagian | `lib/business-document-data.ts:saveBusinessDocument`, `lib/business-documents.ts:normalizeInvoice` | P0. Rujukan SPK dan perhitungan tersedia. Review belum mensyaratkan bukti unit atau verifikasi sesuai revisi. |
| Pembayaran invoice | Belum ada | `app/api/finance/payables/route.ts`, `siap_payables` | P0. Utang dan total bayar tersendiri. Perlu hubungan bayar, bukti, review dan proteksi mutasi. Nomor invoice di buku utang unik. |
| Disposisi turunan | Sebagian | `app/api/dispositions/route.ts:POST`, `[id]/actions:SUBMIT_RESULT` | P0. Parent dan blocker sudah ada. Direksi masih dapat menugaskan Staff/Finance langsung. |
| Tugas saat review dan closing | Belum ada | `letterCanBeDisposed`, `dispositions/[id]/actions:APPROVE_RESULT`, `letters/[id]/actions:COMPLETE` | P0. Temuan tambahan. Hasil tugas terakhir dapat mengubah surat langsung ke COMPLETED. Perlu state dokumen dan tugas independen. |
| Surat hasil | Sebagian | `lib/correspondence-data.ts:findDispositionResultLetters` | P0. Filter surat terbit ada. Fallback mengizinkan surat PIC tanpa tautan asal. |
| Finalisasi Surat Keluar | Sebagian | `lib/numbering.ts:reserveOutgoingNumber`, `letters/[id]/actions:PREPARE_ISSUE/ISSUE/MARK_SENT` | P0. Reservasi, DIGITAL/BASAH dan tanggal kirim ada. Kanal, penerima, bukti kirim dan provenance belum terstruktur. Jalur Staff lama masih berlaku untuk data historis. |
| Nota Dinas langsung dari Manager | Belum ada | `letters:POST`, `letters/[id]/actions:SUBMIT` | P1. Kedua endpoint memasang target MANAGER. Perlu pengecualian pengusul Manager. |
| Persekot dan SPB | Belum ada | `letters:POST`, skema `siap_letters` | P1. Internal dibatasi NOTA_DINAS tanpa tipe persekot atau bukti SPB. |
| Mekari Sign | Belum ada | `letters/[id]/actions:ISSUE` | P1. Upload lama menguji ekstensi dan tidak melakukan request Mekari. |
| Nomor paralel | Sebagian | `letters:POST` dan `reserveOutgoingNumber` | P0. UAT menemukan deadlock karena baris format dikunci setelah insert Surat Keluar. Kunci format diambil sebelum insert untuk menyelaraskan urutan. |
| Edit utang manual | Sebagian | `finance/payables/[id]:PATCH` | P0. UAT menemukan konversi Date ke string lokal gagal ketika tanggal tidak dikirim ulang. Gunakan DATE_FORMAT pada pembacaan baris. |
| Kredensial seed lama | Perlu keputusan | `README.md` dan dump SQL historis | P0. Rotasi akun bila pernah dipakai. Jangan gunakan dump historis sebagai seed staging atau rilis. |

HTML V11 memakai pemilihan role di browser, localStorage, IndexedDB, dan input nomor manual. Aturan bisnis dan label form jadi referensi. Identitas, transaksi, penomoran dan berkas mengikuti backend SIAP.

Verifikasi jarak jauh dibatasi pada repo GitHub. Hostname SIAP staging, PM2, reverse proxy, akun nyata dan schema migration production belum terverifikasi. Isolasi dan hasil pengujian diukur pada staging lokal dari checkout ini.

## Pemeriksaan dependensi kandidat PR

Patch Next.js 14.2.35 mengikuti jalur 14.x sesuai [advisory Next.js](https://nextjs.org/blog/security-update-2025-12-11). mysql2 diperbarui dalam major 3 ke 3.24.6. Build dan UAT diulang setelah pembaruan. `npm audit --omit=dev` pada lockfile kandidat masih mencatat 1 kritis dan 3 tinggi pada Next.js, postcss, source-map-js dan xlsx. Audit registry menyarankan upgrade major Next.js untuk sebagian temuan yang tersisa. Itu memerlukan validasi kompatibilitas tersendiri. Kandidat dan demonstrasi diperiksa pada staging privat loopback.
