# Empat skenario demo Pak Nor

Demo menggunakan aplikasi SIAP ARU pada branch V11 dan akun simulasi hasil setup. Data perusahaan, nomor invoice dan nominal mengikuti contoh Pak Nor. PDF berlabel SIMULASI.

## Menyiapkan data

Untuk staging VPS yang sudah berjalan, hentikan proses staging, ambil commit terbaru di worktree staging yang bersih, jalankan migrasi, build dan mulai kembali.

```bash
cd /opt/apps/siap-aru-v11-sandbox
git fetch origin feat/aru-surat-v11-integration
git merge --ff-only FETCH_HEAD
pm2 stop siap-aru-v11-sandbox
node scripts/v11/run.mjs /etc/siap-aru-v11/stage.json migrate
node scripts/v11/run.mjs /etc/siap-aru-v11/stage.json typecheck
node scripts/v11/run.mjs /etc/siap-aru-v11/stage.json build
pm2 restart siap-aru-v11-sandbox
node scripts/v11/run.mjs /etc/siap-aru-v11/stage.json demo
```

Pemasangan baru mengikuti [VPS-SANDBOX.md](VPS-SANDBOX.md), kemudian jalankan perintah `demo`. Skrip memeriksa marker database dan identitas web sebelum membuat data melalui API. Pengulangan memakai data yang sudah dibuat. Daftar tautan disimpan dalam file privat `demo-pak-nor.json` di sebelah profil staging.

Data awal menempatkan penawaran dan proyek pada tahap review Direksi dengan disposisi yang sudah dibuat. Invoice menunggu verifikasi Operasional. Draf balasan terkait dengan tugas dari penawaran. Tahap awal tersebut terlihat di histori sehingga presenter dapat langsung melanjutkan proses.

## Akun presenter

| Peran | Username |
| --- | --- |
| Staff Operasional | `staff@simulasi.siap.invalid` |
| Sekretariat | `secretariat@simulasi.siap.invalid` |
| Manager Operasional | `ops@simulasi.siap.invalid` |
| Manager Keuangan, SDM & Umum | `ksu@simulasi.siap.invalid` |
| Dirops | `dirops@simulasi.siap.invalid` |
| Dirut | `dirut@simulasi.siap.invalid` |
| Finance | `finance@simulasi.siap.invalid` |

Password adalah password simulasi yang dipilih saat setup pertama. Logout dan login saat berpindah peran. Mekari memakai email penandatangan uji yang dimasukkan dalam setup sandbox.

## 1. Penawaran Jasa Pengamanan PT ABC

Dokumen asal bernomor **012/ABC/XI/2026**. Registrasi Sekretariat dan review menuju Direksi sudah tercatat.

1. Login Manager Operasional. Buka notifikasi disposisi penawaran PT ABC. Perlihatkan nama pemberi tugas, instruksi dan tanggal target dua hari kalender setelah penyiapan data.
2. Buka histori disposisi. Tunjukkan instruksi Direksi ke Manager dan tugas penyusunan balasan kepada Staff.
3. Lanjutkan kasus 4 untuk menyelesaikan surat tanggapan.
4. Setelah surat terbit, Staff membuka tugasnya dan mengirim hasil dengan memilih surat balasan yang terkait.
5. Manager memeriksa dan menyetujui hasil Staff. Manager kemudian mengirim hasil pada tugas dari Direksi dengan memilih surat balasan tersebut.
6. Direksi menerima notifikasi hasil, memeriksa surat tanggapan, dan menyetujui hasil disposisi. Selesaikan review dokumen asal melalui aksi persetujuan yang tersedia.

Tampilkan posisi surat, pemilik tugas, tenggat, lampiran dan histori persetujuan. Nomor surat tanggapan terhubung ke tugas asal.

## 2. Invoice CV Sinar Jaya

Invoice **INV/115**, total **Rp45.000.000**, untuk pengadaan ATK. Unit pemeriksa pada contoh ini ditetapkan Operasional sesuai arahan kasus.

1. Login Manager Operasional. Buka invoice dan tunjukkan **Menunggu Verifikasi**.
2. Buat tugas **Verifikasi invoice oleh unit** kepada Staff Operasional.
3. Staff menerima notifikasi, memulai tugas, mengisi hasil pemeriksaan kesesuaian ATK, lalu mengunggah laporan/bukti dan mengirim hasil.
4. Manager menerima notifikasi hasil, memeriksa bukti dan menyetujui. Bagian verifikasi invoice menampilkan **Disetujui**.
5. Manager memilih persetujuan dokumen di tahapnya atau meneruskan review ke Direksi sesuai keputusan kasus.
6. Setelah dokumen disetujui, Manager KSU menerima notifikasi dan menugaskan **Pembayaran dan pencatatan** kepada Finance.
7. Finance menerima notifikasi, mencatat pembayaran simulasi Rp45.000.000 dan mengunggah bukti. Manager KSU menyetujui pencatatan tersebut. Saldo tagihan menjadi nol dan invoice dapat diselesaikan.

Untuk memperlihatkan **Ditolak**, buat invoice simulasi tambahan, misalnya nomor **INV/115-TOLAK**. Manager memilih **Tolak Final** saat review dan mengisi alasan. Dokumen tersebut menyimpan status Ditolak beserta alasan dan aktornya. Invoice yang ditolak tidak diproses ke pembayaran.

## 3. Proyek Pengadaan PT XYZ

Surat **Permintaan Kerjasama Proyek Pengadaan** sudah memiliki tugas dari Direksi ke Manager Operasional.

1. Manager membuka notifikasi proyek, memulai disposisi dan membuat tugas turunan kepada Staff. Pilih kebutuhan hasil berupa lampiran.
2. Staff menerima notifikasi, memulai tugas, menulis ringkasan survei dan mengunggah PDF laporan.
3. Staff mengirim hasil. Manager menerima notifikasi, memeriksa laporan dan menyetujuinya. Gunakan pengembalian hasil dengan catatan bila ingin menunjukkan revisi.
4. Manager mengirim ringkasan hasil pada tugas induk setelah tugas Staff selesai.
5. Direksi menerima notifikasi dan menyetujui hasil Manager. Selesaikan review surat asal melalui aksi persetujuan yang tersedia.

Perlihatkan hubungan tugas induk-anak, pemilik pekerjaan pada setiap tahap dan histori laporan yang kembali naik.

## 4. Surat Balasan Direksi kepada PT ABC

Draf sudah disiapkan oleh akun Staff dan terkait dengan tugas penyusunan balasan pada kasus 1.

1. Staff membuka draf, memeriksa lampiran dan mengajukan ke Manager.
2. Manager memeriksa dan meneruskan ke Dirops. Dirops memeriksa lalu meneruskan ke Dirut.
3. Dirut melakukan ACC final. Sekretariat menerima notifikasi dan memfinalisasi nomor.
4. Sekretariat membuka panel Mekari, memilih PDF draf, mengatur penandatangan, urutan serta posisi. Gunakan Predict Annotation jika akses sandbox mendukung.
5. Penandatangan menyelesaikan tanda tangan. Sekretariat memperbarui status sampai PDF final tersedia.
6. Sekretariat menerbitkan surat dan mencatat pengiriman, penerima, tanggal, kanal serta bukti. Cari nomor dan PDF di Arsip Dokumen.
7. Staff menyerahkan hasil surat pada tugas asal untuk melanjutkan penyelesaian kasus 1.

Staff penyusun menangani naskah dan hasil tugas. Petugas yang menangani registrasi, finalisasi dan pencatatan pengiriman menggunakan role Sekretariat. Dirops berada dalam rangkaian review Direksi. Manager KSU mengendalikan instruksi dan ACC pencatatan pembayaran kepada Finance.

## Notifikasi dan hasil yang diperlihatkan

Notifikasi muncul pada tombol di bagian atas aplikasi. Daftar diperbarui otomatis setiap 15 detik ketika halaman aktif dan saat jendela kembali fokus. Klik satu notifikasi untuk membukanya dan menandainya dibaca. Tugas baru, pengembalian hasil, permintaan review dan hasil yang disetujui menghasilkan notifikasi sesuai penerima.

Tracking menampilkan posisi dan pemilik saat ini. Histori tetap menyimpan aktor, waktu, perubahan status, alasan serta lampiran. Mode mock menampilkan PDF simulasi. Pengujian Mekari Sandbox langsung menggunakan kredensial dan penguji yang diatur pada VPS.
