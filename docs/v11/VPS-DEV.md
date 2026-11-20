# Pasang SIAP ARU dev di VPS

Branch `dev` disiapkan untuk `https://siap-dev.aruraharja.co.id` pada VPS HestiaCP. Aplikasi berjalan sebagai user Linux `siap-dev` di `127.0.0.1:33318`. HTTP diarahkan ke HTTPS, lalu Nginx meminta kredensial akses staging sebelum layar login SIAP ARU. Gunakan Node.js 24 dan MariaDB atau MySQL lokal.

## 1. Siapkan aplikasi dan akun

Jalankan di VPS dari shell admin. Jika `/opt/apps/siap-aru-dev` sudah ada, lihat bagian **Pembaruan**.

```bash
getent passwd siap-dev >/dev/null || useradd --system --user-group --no-create-home --home-dir /var/lib/siap-aru-dev --shell /usr/sbin/nologin siap-dev
install -d -m 0700 -o siap-dev -g siap-dev /var/lib/siap-aru-dev
git clone --single-branch --branch dev https://github.com/RioBithub/SIAP_ARU_Production.git /opt/apps/siap-aru-dev
cd /opt/apps/siap-aru-dev
node -v
npm ci --include=dev
node scripts/v11/setup-vps.mjs /var/lib/siap-aru-dev/stage.json --dev
chown -R siap-dev:siap-dev /var/lib/siap-aru-dev /opt/apps/siap-aru-dev
```

Wizard menerima socket MariaDB lokal atau TCP loopback. Pertahankan port web **33318** agar cocok dengan templat Hestia. Untuk identitas akun, pilih **ya** lalu konfirmasi akun yang dipakai. Wizard membaca ID, nama, email, peran, dan unit delapan akun aktif di `aru_siap`. Konfirmasi Manager Operasional dan Manager KSU sesuai pemetaan yang tampil. Database staging mendapat hash baru, schema dan user DB sendiri, secret sesi baru, serta folder unggahan privat. Penguji masuk melalui akun Root Admin dengan kata sandi staging baru, lalu memakai **Ganti akun** untuk role lain. Opsi **tidak** membuat delapan identitas fiktif untuk pemasangan tanpa akses baca akun sumber.

## 2. Build, jalankan, dan isi bahan latihan

```bash
cd /opt/apps/siap-aru-dev
sudo -u siap-dev -H node scripts/v11/run.mjs /var/lib/siap-aru-dev/stage.json typecheck
sudo -u siap-dev -H node scripts/v11/run.mjs /var/lib/siap-aru-dev/stage.json build
install -m 0644 deploy/staging/siap-aru-dev.service /etc/systemd/system/siap-aru-dev.service
systemctl daemon-reload
systemctl enable --now siap-aru-dev.service
curl -fsS http://127.0.0.1:33318/api/health
sudo -u siap-dev -H node scripts/v11/run.mjs /var/lib/siap-aru-dev/stage.json demo-dev
```

Tunggu `/api/health` mengembalikan `healthy` sebelum menjalankan `demo-dev`. Perintah `demo-dev` memeriksa identitas database staging, mengisi lima Surat Masuk pada antrean Sekretariat dan melewati surat latihan yang sudah ada. Menu **Bahan Simulasi** menyediakan 25 PDF. Skenario balasan dimulai dari tugas Staff yang dibuat pada skenario pertama.

Jika Node.js terpasang di luar PATH systemd, ubah `ExecStart` di unit staging agar memakai path Node.js yang dapat diakses user `siap-dev`. Jika servis belum aktif, periksa `journalctl -u siap-aru-dev -n 50 --no-pager`.

## 3. Pasang proxy dan HTTPS pada domain staging

Pastikan DNS domain utama mengarah ke VPS. Jika alias `www.siap-dev.aruraharja.co.id` dipakai, pastikan DNS dan sertifikat mencakupnya. Bila hanya memakai domain utama, hapus alias tersebut dari konfigurasi domain staging sebelum menerbitkan sertifikat.

1. Di HestiaCP buka **Web → siap-dev.aruraharja.co.id → Edit**. Aktifkan SSL dan pilih **Let's Encrypt** bila domain belum memiliki sertifikat yang valid.
2. Siapkan akses Nginx khusus penguji. Gunakan username individu atau ganti nilai `penguji` di perintah. File ini sengaja berada di luar document root.
3. Pasang kedua templat, lalu pilih **siap-aru-dev** di **Proxy Template** hanya pada domain staging. Dalam Hestia Nginx + Apache, nama ini adalah templat proxy Nginx.

```bash
cd /opt/apps/siap-aru-dev
if [ ! -e /etc/nginx/siap-aru-dev.htpasswd ]; then
  install -m 0640 -o root -g www-data /dev/null /etc/nginx/siap-aru-dev.htpasswd
fi
htpasswd -B /etc/nginx/siap-aru-dev.htpasswd penguji
chown root:www-data /etc/nginx/siap-aru-dev.htpasswd
chmod 0640 /etc/nginx/siap-aru-dev.htpasswd
install -m 0644 deploy/staging/siap-aru-dev.{tpl,stpl} /usr/local/hestia/data/templates/web/nginx/
```

Jika mengatur templat lewat CLI, ganti `aru` dengan pemilik domain staging di HestiaCP bila berbeda. Argumen terakhir `no` menunda reload hingga konfigurasi lulus validasi.

```bash
/usr/local/hestia/bin/v-change-web-domain-proxy-tpl aru siap-dev.aruraharja.co.id siap-aru-dev 'html,css,js,png,pdf' no
nginx -t && systemctl reload nginx
curl -sSI http://siap-dev.aruraharja.co.id/login
curl -sSI https://siap-dev.aruraharja.co.id/login
curl -fsS --user penguji https://siap-dev.aruraharja.co.id/api/health
```

HTTP mengarah ke HTTPS dengan status 308. HTTPS tanpa kredensial proxy memberi 401. Perintah terakhir meminta sandi proxy lalu menampilkan `healthy`. Buka `/login`, cek banner **STAGING**, masuk dengan Root Admin staging, lalu buka **Bahan Simulasi**.

## Pembaruan

Jalankan dari checkout staging yang bersih. Migrasi dan `demo-dev` aman diulang dengan konfigurasi staging yang sama.

```bash
cd /opt/apps/siap-aru-dev
sudo -u siap-dev -H git pull --ff-only origin dev
sudo -u siap-dev -H npm ci --include=dev
sudo -u siap-dev -H node scripts/v11/run.mjs /var/lib/siap-aru-dev/stage.json migrate
sudo -u siap-dev -H node scripts/v11/run.mjs /var/lib/siap-aru-dev/stage.json build
systemctl restart siap-aru-dev.service
curl -fsS http://127.0.0.1:33318/api/health
sudo -u siap-dev -H node scripts/v11/run.mjs /var/lib/siap-aru-dev/stage.json demo-dev
```

- [Panduan enam skenario](PANDUAN-DEV.md)
- [Templat proxy Nginx custom HestiaCP](https://hestiacp.com/docs/server-administration/web-templates)
- [Referensi CLI HestiaCP](https://hestiacp.com/docs/reference/cli)
