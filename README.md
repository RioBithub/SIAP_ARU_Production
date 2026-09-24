# SIAP ARU v1.6

Sistem Informasi ARU Terintegrasi untuk Persuratan, Pengajuan Internal, Surat Keluar, Disposisi, Keuangan, Piutang, Utang, Arsip, dan Audit Log.

## Fokus utama v1.6 — workflow Surat Keluar

Alur Surat Keluar sekarang dibuat eksplisit dan berjenjang:

```text
STAFF
Buat Draft Surat Keluar
    ↓
MANAGER_REVIEW
Approve / Return ke Staff
    ↓
DIRECTOR_OPS_REVIEW
Approve / Return ke Staff
    ↓
PRESIDENT_DIRECTOR_REVIEW
ACC Final / Return ke Staff
    ↓
READY_TO_ISSUE
Staff mengunggah file final bila diperlukan
    ↓
Staff klik Terbitkan Surat
    ↓
ISSUED
```

### Prinsip penting

- **Staff Administrasi** adalah penyusun utama Surat Keluar.
- **Manager, Direktur Operasional, dan Direktur Utama** melakukan review/approval.
- Jika salah satu reviewer melakukan **Return**, Surat Keluar selalu kembali ke **Staff** agar revisi dilakukan oleh satu pihak yang jelas.
- Setelah revisi, Staff melakukan submit ulang dan approval chain dimulai kembali dari Manager.
- Setelah ACC Direktur Utama, surat belum langsung terbit. Status menjadi **READY_TO_ISSUE**.
- Hanya **Staff penyusun** atau **Root Admin** yang dapat menekan **Terbitkan Surat**.
- Setelah diterbitkan, status menjadi **ISSUED** dan nomor pada ledger berubah dari `RESERVED` menjadi `ISSUED`.
- Disposisi setelah Surat Keluar terbit tidak mengubah status surat dari `ISSUED`; status tindak lanjut tetap dikelola pada modul Disposisi.

## Lampiran per proses

Setiap aksi workflow dokumen dapat membawa:

- catatan proses;
- maksimal **5 lampiran per aksi**;
- maksimal **10 MB per file**.

Aksi yang dapat mempunyai lampiran proses antara lain:

- Submit Staff ke Manager;
- Approval Manager;
- Return Manager;
- Approval Direktur Operasional;
- Return Direktur Operasional;
- ACC Final Direktur Utama;
- Return Direktur Utama;
- Penerbitan oleh Staff;
- pembatalan dokumen.

Lampiran proses disimpan sebagai attachment terpisah dan terhubung ke `siap_letter_actions`, sehingga di halaman detail file muncul tepat di tahapan proses yang bersangkutan.

### Kebijakan file

- Dokumen original/utama: maksimum 10 MB, **tanpa kompresi**.
- Lampiran tambahan/proses: maksimum 10 MB, dikompresi jika hasil kompresi lebih kecil.
- PDF/DOCX/JPG yang sudah efisien tidak dipaksa gzip jika hasilnya lebih besar.
- File tidak berada di folder `public`.
- Download selalu melalui endpoint dengan autentikasi dan pemeriksaan akses.

## Root Admin

`ROOT_ADMIN` adalah superuser. Root dapat melakukan seluruh operasi sistem, termasuk:

- melihat surat public/private/rahasia;
- membuat draft Surat Keluar sebagai override;
- approve/return pada seluruh tahap;
- menerbitkan surat;
- mengunggah/download seluruh attachment;
- mengelola disposisi;
- mengelola Finance, Piutang, Utang;
- mengelola user & role;
- mengelola format/nomor awal surat;
- melihat Audit Log.

## Penomoran Surat Keluar

Tampilan web menggunakan nomor ringkas:

```text
124
125
135
135.1
135.2
```

Jenis surat ditampilkan terpisah.

- seri nomor dipisahkan per jenis/format surat;
- Root Admin mengatur nomor awal/minimum per jenis;
- nomor custom diperbolehkan;
- backdate diperbolehkan;
- collision menghasilkan `.1`, `.2`, dst.;
- nomor CANCELLED tidak digunakan ulang.

Nomor telah di-reserve sejak draft dibuat untuk mencegah collision antar-user. Nomor berubah menjadi `ISSUED` ketika Staff benar-benar menerbitkan surat.

## Pengajuan Internal

Staff ke Manager menggunakan:

- Nota Dinas; atau
- Lembar Pengantar + dokumen pendukung.

Pengajuan internal **bukan disposisi**. Disposisi digunakan setelah pimpinan ingin memberikan instruksi/tindak lanjut kepada PIC.

## Finance

Manager, Direktur Operasional, Direktur Utama, Finance, dan Root dapat melihat dashboard Finance.

Finance/Root dapat mengubah data. Manager/Direksi bersifat view-only.

Piutang dan Utang mendukung:

- Ringkasan Cepat;
- Detail Invoice.

Aging:

- 1–30
- 30–60
- 60–90
- 90+

## Database

Database:

```text
aru_siap
```

### Instalasi baru

Import satu file:

```text
database/SIAP_ARU_FULL_DATABASE_v1.6.sql
```

File tersebut berisi schema lengkap + seluruh akun operasional awal + format nomor surat awal.

### Upgrade dari v1.5

Import:

```text
database/migration_v1.5_to_v1.6_outgoing_workflow.sql
```

Migration hanya menambahkan relasi attachment ke action workflow dan tidak menghapus data lama.

## Akun awal

### Root Admin

```text
Email    : root@aruraharja.co.id
Password : AdminARU!2026
```

### User operasional

Password awal:

```text
SiapARU!2026
```

| User | Email |
|---|---|
| Staff Administrasi | staff@aruraharja.co.id |
| Manager Keu, SDM & Umum | manager@aruraharja.co.id |
| Manager Operasional | manager.ops@aruraharja.co.id |
| Manager Gedung | manager.gedung@aruraharja.co.id |
| Direktur Operasional | dirops@aruraharja.co.id |
| Direktur Utama | dirut@aruraharja.co.id |
| Finance | finance@aruraharja.co.id |

Ganti password sebelum go-live.

## Menjalankan aplikasi

Paket **tidak berisi `.env.local`**, sehingga konfigurasi lokal yang sudah benar tidak ditimpa.

```powershell
npm install
npm run dev
```

Buka:

```text
http://localhost:3000
```

## Skenario cepat Surat Keluar

1. Login Staff.
2. Buat Draft Surat Keluar + upload file draft bila ada.
3. Klik **Ajukan ke Manager**, tambahkan catatan/lampiran proses bila diperlukan.
4. Login Manager → buka surat → **Approve & Teruskan** atau **Kembalikan ke Staff**.
5. Login Dirops → approve/return.
6. Login Dirut → **ACC Final** atau return.
7. Jika ACC final, status menjadi `READY_TO_ISSUE`.
8. Login Staff → buka surat → **Terbitkan Surat**.
9. Pada tahap penerbitan Staff dapat mengunggah file final/scan yang sudah ditandatangani.
10. Status menjadi `ISSUED`; file final dapat di-download dari histori proses.
11. Manager/Direksi dapat membuat Disposisi lanjutan dari surat yang sudah terbit tanpa mengubah status `ISSUED`.

## Audit Log

Aksi penting tetap tercatat, termasuk:

- login;
- create/edit dokumen;
- submit/approve/return/issue/cancel;
- lampiran proses;
- disposisi;
- Finance;
- perubahan user/role;
- perubahan format nomor.
