# SIAP ARU App Patch v1.6.8.1 — Favicon ARU

Patch kecil ini memastikan favicon ARU benar-benar dirender sebagai `<link>` di `<head>`, bukan hanya mengandalkan Metadata API Next.js.

Copy folder `app` dan `public` ke root project SIAP ARU, overwrite file yang sama, lalu restart Next.js dan hapus `.next` bila perlu.

Tidak ada SQL migration dan tidak mengubah `.env.local`.
