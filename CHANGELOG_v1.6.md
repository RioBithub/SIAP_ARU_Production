# SIAP ARU v1.6

## Surat Keluar

- Penyusun default dibatasi ke Staff Administrasi; Root tetap superuser.
- Workflow final: DRAFT → MANAGER_REVIEW → DIRECTOR_OPS_REVIEW → PRESIDENT_DIRECTOR_REVIEW → READY_TO_ISSUE → ISSUED.
- Return dari Manager/Dirops/Dirut selalu kembali ke Staff (`RETURNED_STAFF`).
- Setelah return, Staff revisi dan submit ulang dari Manager.
- ACC Dirut tidak lagi otomatis menerbitkan surat.
- Staff memiliki aksi `Terbitkan Surat` setelah ACC final.
- Tanggal terbit dipilih pada saat penerbitan.
- Ledger nomor baru berubah menjadi ISSUED pada saat surat benar-benar diterbitkan.

## Lampiran Proses

- `siap_attachments` memiliki `letter_action_id`.
- Submit/approve/return/issue/cancel dapat membawa maksimal 5 lampiran.
- Lampiran proses maksimal 10 MB/file dan dikompresi bila efektif.
- Halaman detail menampilkan file tepat di action timeline yang bersangkutan.
- File dapat di-download kembali melalui endpoint attachment yang telah dilindungi permission.

## Disposisi Surat Keluar

- Surat Keluar yang sudah ISSUED tetap berstatus ISSUED ketika dibuatkan disposisi.
- Seen/Start/Complete pada disposisi tidak mengubah lifecycle Surat Keluar.
