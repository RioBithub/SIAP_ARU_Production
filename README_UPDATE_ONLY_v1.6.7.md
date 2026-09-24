# Update SIAP ARU v1.6.7

## Cara memasang
1. Stop Next.js.
2. Copy seluruh isi folder update ini ke root project SIAP ARU v1.6.6.
3. Pilih Replace/Overwrite untuk file yang sama.
4. Hapus cache `.next`.
5. Jalankan kembali `npm run dev`.

PowerShell:

```powershell
Ctrl + C
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev
```

## Catatan
- Tidak ada SQL migration.
- Tidak ada `.env.local`.
- Update ini fokus pada kejelasan istilah, panduan user, dan pengalaman download dokumen.
