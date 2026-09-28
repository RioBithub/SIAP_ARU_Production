SIAP ARU - FINAL BUSINESS FLOW PATCH
====================================

Target branch:
  feature/final-business-flow
dibuat dari:
  sync/server-2026-09-28

FLOW YANG DIIMPLEMENTASIKAN
--------------------------
Surat Masuk:
  Staff -> Manager yang dipilih -> Dirops -> Dirut -> APPROVED

Surat Keluar:
  Staff draft + pilih Manager -> Manager -> Dirops -> Dirut
  -> READY_TO_ISSUE -> Staff terbitkan -> ISSUED

Nota Dinas:
  Staff -> Manager
  - dapat RESPONSE/tanggapan tanpa mengubah status
  - Manager boleh APPROVE_FINAL
  - atau lanjut Dirops, lalu opsional ke Dirut

Return Surat Masuk / Nota Dinas:
  Manager -> Staff
  Dirops -> Manager awal
  Dirut -> Dirops

Disposisi:
  Hanya setelah dokumen selesai approval.
  Surat Masuk / Nota Dinas: mulai APPROVED.
  Surat Keluar: mulai ISSUED.

  Dirut -> Manager/Staff/Finance:
    PIC -> kirim hasil -> Dirops -> Dirut -> selesai

  Dirut -> Dirops:
    Dirops -> kirim hasil -> Dirut -> selesai

  Dirops -> Manager/Staff/Finance:
    PIC -> kirim hasil -> Dirops -> selesai

  Manager -> Staff/Finance:
    PIC -> kirim hasil -> Manager -> selesai

MOBILE CLIENT EXCEPTION
-----------------------
StatusBadge sudah tidak memakai String.prototype.replaceAll.
LettersClient fallback juga diubah ke regex replace.
Ini ditujukan untuk kompatibilitas browser/WebKit mobile yang lebih lama.

CARA PAKAI
----------
1. Extract isi ZIP ke ROOT repo SIAP_ARU_Production (overwrite file yang sama).

2. Dari root repo:
   node patch_letters_client.mjs

3. Hapus patch script setelah sukses:
   del patch_letters_client.mjs

4. Jalankan:
   npm run typecheck
   npm run build

5. Terapkan migration ke LOCAL database:
   node apply_local_migrations.mjs

   Kalau muncul "DB_PORT harus angka", perbaiki .env.local agar DB_PORT hanya angka
   (umumnya 3306), lalu jalankan ulang.

6. Setelah migration sukses, hapus helper:
   del apply_local_migrations.mjs

7. Jalankan npm run dev dan test semua role sebelum commit.

CATATAN
-------
Migration routing-target lama tetap diperlukan jika DB lokal belum memiliki
routing_target_user_id.

Jangan deploy ke VPS sebelum typecheck, build, dan skenario role lolos.
