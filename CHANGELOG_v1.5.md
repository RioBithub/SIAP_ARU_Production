# Changelog SIAP ARU v1.5

- Menambah menu **Pengajuan Internal**.
- Staff → Manager menggunakan **Nota Dinas** atau **Lembar Pengantar**, bukan lembar disposisi.
- Pengajuan Internal dapat selesai di Manager, diteruskan ke Dirops, selesai di Dirops, atau diteruskan ke Dirut.
- Disposisi tetap khusus instruksi/tindak lanjut dari Manager/Direksi kepada PIC.
- Root Admin dipertahankan sebagai superuser penuh.
- Navbar active route tetap menggunakan route paling spesifik sehingga Ringkasan Keuangan tidak ikut aktif saat Piutang/Utang dibuka.
- Penomoran tetap per jenis: angka tampil ringkas pada list, collision menjadi `.1`, `.2`, dst.
- Full SQL sekarang sudah menyertakan seluruh akun operasional awal.
- Paket source tidak menyertakan `.env.local`.
