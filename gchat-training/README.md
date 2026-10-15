# Google Chat Training — daftar dan approval sederhana

Project latihan terpisah. Baca dua file utama:

- [index.js](index.js): server, daftar pengguna, kirim kartu, dan proses keputusan.
- [index.html](index.html): form HTML dan tabel hasil, tanpa framework/JavaScript browser.

Satu aplikasi Node.js: Express, google-auth-library dan driver Neon. Data disimpan di Neon saat DATABASE_URL diisi; tanpa DATABASE_URL, lokal memakai Map sementara. Tidak memerlukan hub/gateway, NIK, API client atau BRIDGE_SECRET.

File ketiga [store.js](store.js) berisi penyimpanan singkat untuk mendukung Vercel.

## Alur

~~~text
1. Pengguna menyapa bot → kartu tombol Daftar
   Klik Daftar → Google → POST /google-chat → simpan data DM
   /daftar tetap tersedia sebagai cara alternatif

2. Admin membuka halaman, memilih pengguna dan mengirim pengajuan
   POST /send-approval → approvals.set(id, PENDING)
   → library Google memperoleh access token
   → POST Google Chat API → kartu tampil di DM

3. Pengguna klik Approve atau Reject
   Google → POST /google-chat → cek email approver + PENDING
   → ubah APPROVED/REJECTED → balas updateMessageAction
~~~

Muat ulang halaman setelah klik untuk melihat keputusan.

## Jalankan

Dari root repository:

~~~powershell
npm install --prefix gchat-training
npm run start:training
~~~

Atau dari folder ini:

~~~powershell
npm install
npm start
~~~

Node 22+. Buka http://localhost:3003. Username admin; password adalah ADMIN_PASSWORD pada .env latihan.

Dependency sudah diinstal pada workspace saat project dibuat.

## Konfigurasi .env

.env lokal sudah disiapkan dengan JSON pengirim dan password admin dari konfigurasi hub. Nilai tersebut tidak ikut Git. URL publik dan email add-on masih perlu dilengkapi. DATABASE_URL lokal juga sudah disalin dari hub.

| Nama | Isi |
| --- | --- |
| PUBLIC_BASE_URL | Origin HTTPS yang menuju server latihan, tanpa /google-chat |
| GOOGLE_SERVICE_ACCOUNT_JSON | Satu JSON lengkap service account bot pengirim |
| GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL | Email service account identitas add-on pada Google Chat API Configuration |
| ADMIN_PASSWORD | Password halaman demo, minimal 12 karakter |
| DATABASE_URL | Wajib di Vercel; salin connection string Neon dari hub |
| PORT | Opsional, default 3003 |

Pengirim bot harus sesuai project Google Chat yang digunakan latihan. Email add-on berbeda fungsi dari client_email JSON pengirim.

Jangan memakai URL gateway lama sebagai PUBLIC_BASE_URL latihan: URL itu harus benar-benar mengarah ke proses server latihan ini.

## Deploy Vercel

1. Project Vercel gchat-training → Settings → Build and Deployment → Root Directory = gchat-training.
2. Isi lima env: PUBLIC_BASE_URL, GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL, ADMIN_PASSWORD dan DATABASE_URL.
3. PUBLIC_BASE_URL adalah origin production project latihan, contoh https://NAMA-TRAINING.vercel.app, tanpa /google-chat.
4. DATABASE_URL boleh persis sama dengan project hub. Tabel gchat_training_data dibuat otomatis dan terpisah dari tabel hub. Tidak perlu menjalankan schema manual.
5. Redeploy versi terbaru. Export utama sekarang aplikasi Express; createApp tetap tersedia untuk tes.
6. Google Chat API Configuration: endpoint/command trigger ke PUBLIC_BASE_URL + /google-chat; command /daftar ID 1.
7. Buka domain latihan, login admin, lalu coba daftar dan kirim approval.

Vercel memakai vercel.json untuk menjalankan semua route melalui index.js dan menyertakan index.html dalam bundle. Tidak perlu tunnel ketika memakai Vercel. Jangan mengganti env gateway/hub untuk latihan ini.

Jika halaman menampilkan Isi DATABASE_URL Neon di Vercel lalu redeploy, lengkapi env tersebut dan redeploy. Data latihan ada pada satu tabel: kind=user untuk registrasi dan kind=approval untuk pengajuan. Keputusan memakai UPDATE bersyarat PENDING agar klik paralel dari instance berbeda hanya berhasil sekali.

## Agar Google dapat mencapai server lokal

Google memerlukan endpoint HTTPS publik. Untuk latihan lokal, gunakan tunnel yang diizinkan jaringan kantor. Contoh Quick Tunnel Cloudflare:

1. Pasang cloudflared mengikuti [petunjuk resmi](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/). Binary ini belum dipasang oleh project.
2. Pada terminal terpisah, jalankan:

~~~powershell
cloudflared tunnel --url http://127.0.0.1:3003
~~~

3. Salin URL HTTPS yang dicetak, misalnya https://nama-acak.trycloudflare.com.
4. Isi PUBLIC_BASE_URL dengan origin tersebut, lalu restart server Node agar .env dimuat ulang.
5. Biarkan terminal server dan tunnel tetap berjalan.

Quick Tunnel memberi URL sementara yang berubah saat dibuat ulang, tanpa akun/domain Cloudflare. [Dokumentasi Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Jangan menambahkan login interaktif Cloudflare di depan /google-chat karena Google mengaksesnya sebagai server. Kode memverifikasi ID token Google, sedangkan halaman demo dilindungi Basic admin.

Untuk lokal tanpa DATABASE_URL, Map hilang saat restart. Untuk Vercel, DATABASE_URL wajib agar state dibagikan antar-instance.

## Konfigurasi Google Chat

Gunakan model Google Workspace add-on seperti bot yang sudah berhasil sebelumnya.

1. Google Cloud Console → project bot → Google Chat API → Configuration.
2. Isi HTTP endpoint umum: PUBLIC_BASE_URL + /google-chat.
3. Pastikan App command trigger memakai endpoint yang sama.
4. Tambahkan slash command /daftar, command ID 1.
5. Salin Service Account Email identitas add-on ke GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL.
6. Simpan dan restart server latihan bila env berubah.

Untuk memakai bot lama saat latihan, catat endpoint sebelumnya sebelum mengubah konfigurasi, kemudian kembalikan endpoint gateway sesudah sesi agar command kembali diproses arsitektur hub/gateway. File aplikasi hub/gateway tidak diubah oleh project ini.

Jika memakai bot/project Google baru, gunakan JSON pengirim dan identitas add-on yang sesuai dengan project baru itu.

## Urutan demo saat training

1. Jalankan server dan tunnel.
2. Lengkapi env dan konfigurasi endpoint Google.
3. Buka halaman, login admin. Awalnya daftar kosong.
4. Buka DM bot, kirim halo lalu klik tombol Daftar. /daftar tetap bisa dipakai.
5. Muat ulang halaman. Email pengguna muncul pada pilihan approver.
6. Isi judul/detail lalu klik Kirim ke Google Chat.
7. Buka kartu pada DM, klik Approve atau Reject.
8. Muat ulang halaman untuk melihat hasil.
9. Coba klik kembali: keputusan pertama dipertahankan.
10. Jika lokal tanpa DATABASE_URL, restart mengosongkan data. Dengan Neon, data tetap tersimpan.

Tidak ada validasi NIK pada latihan ini. Email/DM diambil dari event Google yang sudah diverifikasi dan email wajib cocok dengan allowed-emails.json.

## Cara membaca index.js

| Bagian bernomor | Yang dipelajari |
| --- | --- |
| 1 | URL callback publik |
| 2 | Login halaman demo |
| 3 | Format balasan pesan Google |
| 4 | JSON kartu dan parameter tombol |
| 5 | Isi pilihan/tabel pada HTML |
| 6 | Simpan pengajuan dan kirim langsung ke Google |
| 7A | Proses klik dan pembaruan kartu |
| 7B | Daftar dari DM |

createApp dan parameter sendMessage/verifyGoogleToken memungkinkan tes tanpa Google nyata. Saat npm start, keduanya tidak diisi: kode memakai GoogleAuth dan verifikasi ID token Google sungguhan. Tidak ada env untuk melewati verifikasi.

## Contoh payload masuk

Command sebagai pesan biasa (subset field yang digunakan):

~~~json
{
  "chat": {
    "user": { "email": "nama@example.com", "displayName": "Nama Demo" },
    "space": { "name": "spaces/CONTOH", "spaceType": "DIRECT_MESSAGE" },
    "messagePayload": { "message": { "text": "/daftar" } }
  }
}
~~~

Klik tombol:

~~~json
{
  "commonEventObject": {
    "parameters": {
      "approvalId": "<ID_DARI_KARTU>",
      "action": "approve"
    }
  },
  "chat": {
    "user": { "email": "nama@example.com" },
    "buttonClickedPayload": {}
  }
}
~~~

Google mengirim Authorization: Bearer <GOOGLE_ID_TOKEN>. Jangan memakai token login aplikasi hub untuk endpoint ini.

## Batas latihan

- Tanpa DATABASE_URL, restart menghapus data. Dengan Neon, data bertahan.
- Setiap submit form membuat ID/pengajuan baru. Tidak ada retry/idempotency otomatis.
- SENT berarti Google menerima pengiriman. FAILED berarti pengiriman belum terkonfirmasi; cek DM sebelum mengirim ulang karena timeout bisa terjadi setelah kartu diterima.
- Keputusan hanya diterapkan satu kali dan email pengklik harus sesuai approver.
- REJECTED adalah label status latihan. Hub sebelumnya memakai DECLINED; kedua project berdiri sendiri.
- Ini belum mengubah database program cuti atau kantor.
- Log terminal hanya DAFTAR, KIRIM dan KEPUTUSAN; token/private key tidak dicetak.

## Tes

~~~powershell
npm --prefix gchat-training test
~~~

Tes mencakup daftar, kartu/tujuan, approve/reject, pengklik lain, klik ulang, autentikasi, kegagalan kirim, escaping teks, reset memori, export Vercel dan PostgreSQL lintas-instance. Google dimock; tes tidak mengirim notifikasi nyata.

Referensi: [event Google add-on](https://developers.google.com/workspace/add-ons/chat/build), [validasi ID token](https://developers.google.com/workspace/add-ons/guides/alternate-runtimes#validate_json_requests).

## Pendaftaran dengan tombol

Pengguna baru yang menyapa bot atau saat bot ditambahkan ke DM menerima kartu Selamat datang dengan tombol Daftar. Klik tombol mengirim action=register ke /google-chat. Identitas email/nama/ruang berasal dari event Google yang terverifikasi.

Jika pengguna sudah terdaftar, sapaan berikutnya menampilkan kartu Akun terdaftar dan emailnya, tanpa meminta daftar ulang. /daftar tetap didukung. Tidak perlu mengaktifkan App Home untuk fitur ini. Pada DM yang sudah terbuka sebelumnya, kirim satu pesan seperti halo setelah deployment agar kartu baru muncul.

## Daftar email yang diizinkan

File [allowed-emails.json](allowed-emails.json) berisi email akun Google Chat yang boleh menggunakan bot. Isi awal:

~~~json
[
  "kresnawijaya511@indomaret.com"
]
~~~

Pendaftaran hanya berhasil jika email pengirim pada event Google masuk daftar ini. Input/parameter email pada tombol tidak dipakai sebagai identitas. Akun di luar daftar tidak mendapat tombol Daftar dan tetap ditolak lewat /daftar, slash command atau tombol lama.

Untuk menambah pengguna: tambahkan email sebagai item JSON baru, commit/push lalu tunggu deployment Vercel; jika lokal, restart server. Tidak perlu menambahkan env atau menjalankan SQL. Email dicocokkan lowercase/trim; semua email lain ditolak, termasuk yang satu domain. Daftar kosong menolak semua akun.

Daftar izin terlihat pada halaman admin. Data pengguna yang sudah berhasil mendaftar tetap disimpan di Neon dengan kind=user. File izin tidak otomatis mendaftarkan pengguna: akun yang diizinkan tetap perlu klik Daftar sekali agar ruang DM tersimpan.

Akun yang dikeluarkan dari file tidak bisa menggunakan bot atau menjadi tujuan pengiriman baru. Data registrasi/riwayat lama tidak dihapus dari Neon; daftar pengguna dan pilihan approver di halaman latihan hanya menampilkan akun yang masih diizinkan.
