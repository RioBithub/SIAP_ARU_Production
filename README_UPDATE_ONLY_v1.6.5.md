# UPDATE ONLY — SIAP ARU v1.6.5

Update ini ditujukan untuk project SIAP ARU yang sudah berada di v1.6.4.

## Isi update
- dialog aplikasi yang rapi menggantikan native browser prompt/confirm;
- nomor awal/minimum format surat bisa diedit Root Admin;
- format PKS, Direksi, Operasional, PO, dan Umum mengikuti `Form Persuratan ARU.xlsx`;
- import Excel lama ke database;
- export Excel dengan susunan sheet yang familiar;
- metadata legacy Excel dan proteksi konflik nomor historis;
- optional SQL untuk mengimpor workbook yang dipakai sebagai referensi update ini.

## Cara pasang

### 1. Stop aplikasi
```powershell
Ctrl + C
```

### 2. Import migration database
Import:
```text
database/migration_v1.6.4_to_v1.6.5_persuratan_excel_ui.sql
```

Database yang dipakai tetap:
```text
aru_siap
```

### 3. Copy file update
Copy isi ZIP update ke root project SIAP dan pilih **Replace / Overwrite**.

`.env.local` tidak ada di package update dan tidak perlu diubah.

### 4. Install dependency Excel
v1.6.5 menambahkan `xlsx` untuk import/export workbook.

Jalankan:
```powershell
npm install
```

### 5. Bersihkan cache dan start lagi
```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev
```

## Memindahkan Excel lama ke database
Ada dua opsi. Pilih salah satu.

### Opsi A — lewat web (paling mudah)
Login Root → **Surat Keluar** → **Import Excel Lama** → pilih `Form Persuratan ARU.xlsx` → **Import ke Database**.

Sheet yang dibaca:
1. Perjanjian Kerjasama
2. Surat Keluar- Direksi
3. Surat Keluar - Bag. Operasional
4. Purchase Order
5. Surat keluar- Bag. umum

Sheet `Kwitansi` tidak ikut karena fokus sistem penomoran update ini adalah lima seri surat keluar tersebut.

### Opsi B — SQL current workbook
Setelah migration v1.6.5, import:
```text
database/OPTIONAL_IMPORT_CURRENT_FORM_PERSURATAN_ARU_2026.sql
```

SQL ini disiapkan langsung dari workbook referensi update. Import ulang aman karena memiliki `legacy_import_key`.

> Jangan perlu menjalankan Opsi A dan B sekaligus. Jika terlanjur, mekanisme key mencegah duplikasi surat, tetapi satu metode saja lebih sederhana.

## Tentang data lama yang kurang lengkap
Workbook sumber memiliki beberapa baris tanpa tanggal surat. SIAP tidak menebak tanggal karena dapat merusak histori. Baris tersebut dilaporkan sebagai catatan import dan dilewati sampai datanya dilengkapi.

Nomor yang tidak standar atau duplicate tetap terlihat di database sebagai data historis, tetapi tidak ikut menguasai slot ledger otomatis. Dengan begitu data lama tidak hilang dan nomor baru tetap aman.

## Export Excel
Di halaman Surat Keluar tekan **Export Excel**. File hasil export mempertahankan konsep workbook lama:
- judul sheet;
- baris keterangan format;
- `No. Surat`;
- `Tanggal Surat`;
- `User Input` pada sheet yang memang memilikinya;
- `Tujuan Surat`;
- `Perihal`;
- `Link File` legacy.

Data baru yang dibuat langsung di SIAP tetap menjadi sumber database; lampiran baru diunduh melalui SIAP karena memiliki autentikasi/permission.

## Verifikasi
Jalankan:
```text
database/VERIFY_v1.6.5_PERSURATAN.sql
```

Query verifikasi menggunakan nama database lengkap `aru_siap.*` agar tidak terkena masalah phpMyAdmin sedang berada di `information_schema`.
