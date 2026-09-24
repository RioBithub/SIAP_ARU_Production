# Update Only v1.6.8

Tidak memerlukan SQL migration dan tidak mengubah `.env.local`.

1. Stop Next.js.
2. Salin folder `components` dari paket ini ke root project SIAP ARU dan pilih Replace/Overwrite.
3. Hapus cache `.next` bila perlu.
4. Jalankan kembali `npm run dev`.

Contoh: input `333333232323` akan langsung terlihat `333.333.232.323`, sementara nilai yang diproses backend tetap `333333232323`.
