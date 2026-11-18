# Uji Mekari Sandbox dari situs utama SIAP ARU

Uji ini menggunakan situs `siap.aruraharja.co.id` dan gateway HMAC **Mekari Sandbox**. Panel dibatasi ke satu Surat Keluar V11 dan satu lampiran PDF yang dipilih secara eksplisit. Surat, histori, dan bukti uji tersimpan di SIAP ARU. Siapkan satu surat fiktif dan penguji yang memiliki akses ke email undangan.

## Menyiapkan surat dan konfigurasi

1. Setelah V11 disetujui untuk diterapkan, ikuti [langkah migrasi dan deployment](STAGING.md#penerapan-yang-perlu-ditinjau-operator). Gunakan skema aktif SIAP ARU dan prosedur backup yang sudah ada.
2. Buat Surat Keluar fiktif dengan awalan subjek `[SIMULASI]` dan lampiran PDF draf fiktif. Gunakan format nomor **SIMULASI** di luar seri surat resmi karena pengajuan mencatat reservasi nomor di ledger. Ajukan dan review sesuai alur V11. Sekretariat memfinalisasi sampai status **Menunggu Tanda Tangan**.
3. Ambil ID surat dari URL detail yang memuat `letter_id`. Ambil ID lampiran dari link unduh PDF yang disetujui, dengan format `/api/attachments/<id>`. Salin UUID, lalu cocokkan judul dan berkasnya sebelum mengaktifkan pengaturan.
4. Isi konfigurasi privat service `siap-aru` di VPS. Pertahankan koneksi database service tersebut. Kredensial HMAC Sandbox yang lulus smoke test dimasukkan langsung di VPS.

| Variabel | Nilai |
| --- | --- |
| `SIAP_V11_MEKARI_MODE` | `sandbox` |
| `SIAP_V11_MEKARI_PILOT_LETTER_ID` | UUID Surat Keluar V11 bertanda `[SIMULASI]` |
| `SIAP_V11_MEKARI_PILOT_ATTACHMENT_ID` | UUID lampiran PDF draf pada surat yang sama |
| `SIAP_V11_MEKARI_TEST_RECIPIENTS` | Alamat email penguji, dipisahkan koma |
| `SIAP_V11_MEKARI_ALLOW_SEND` | `1` saat penguji siap menerima undangan |
| `MEKARI_CLIENT_ID` | Client ID HMAC Sandbox |
| `MEKARI_CLIENT_SECRET` | Client Secret HMAC Sandbox |

Muat konfigurasi saat restart service. `SIAP_V11_STAGE` dipakai khusus untuk staging terisolasi. Untuk uji dari situs utama, gunakan profil normal service production tanpa flag staging.

## Menjalankan demo

1. Login sebagai Sekretariat. Buka surat simulasi dan panel **Mekari Sign Sandbox**. Pilih PDF draf yang ditampilkan dan masukkan dua nama serta dua email penguji.
2. Pilih **Berurutan**. Gunakan **Prediksi Posisi Tanda Tangan** lalu pilih saran tiap penandatangan. Jika akses Predict Annotation belum tersedia pada akun vendor atau posisi belum sesuai, isi koordinat manual.
3. Klik **Ajukan Tanda Tangan Sandbox** sekali. Setelah penguji pertama selesai, klik **Segarkan Status Mekari** dan periksa status proses. Ulangi setelah penguji kedua selesai. Status diambil langsung dari Mekari ketika disegarkan.
4. Setelah status `COMPLETED`, unduh **PDF bukti uji**. Aksi penerbitan surat ini ditolak, termasuk ketika pengaturan Sandbox telah dilepas setelah permintaan tercatat.
5. Selesai demo, operator dapat membatalkan surat simulasi lewat alur SIAP ARU agar nomor simulasi dan status tercatat di histori. Hapus pengaturan pilot, izin kirim dan kredensial Sandbox dari konfigurasi service bila sesi pengujian selesai. Muat ulang service untuk menutup akses dan pertahankan histori uji.

Hasil UAT-043 dari VPS sudah tercatat. Keberhasilan skenario penandatanganan, prediksi, dan unduhan di vendor memerlukan satu sesi UAT-045 dengan email penguji. [Hasil UAT](UAT.md)
