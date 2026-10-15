# Google Chat Training — daftar dan approval sederhana

Project latihan terpisah. Baca dua file utama:

- [index.js](index.js): server, daftar pengguna, kirim kartu, dan proses keputusan.
- [index.html](index.html): form HTML dan tabel hasil, tanpa framework/JavaScript browser.

Satu proses Node.js dan dua dependency: Express serta google-auth-library. Data sementara dalam Map; tidak memakai database, hub, gateway, NIK, API client, atau BRIDGE_SECRET.

## Alur

~~~text
1. Pengguna DM bot: /daftar
   Google → POST /google-chat → users.set(email, data DM)

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

.env lokal sudah disiapkan dengan JSON pengirim dan password admin dari konfigurasi hub. Nilai tersebut tidak ikut Git. URL publik dan email add-on masih perlu dilengkapi.

| Nama | Isi |
| --- | --- |
| PUBLIC_BASE_URL | Origin HTTPS yang menuju server latihan, tanpa /google-chat |
| GOOGLE_SERVICE_ACCOUNT_JSON | Satu JSON lengkap service account bot pengirim |
| GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL | Email service account identitas add-on pada Google Chat API Configuration |
| ADMIN_PASSWORD | Password halaman demo, minimal 12 karakter |
| PORT | Opsional, default 3003 |

Pengirim bot harus sesuai project Google Chat yang digunakan latihan. Email add-on berbeda fungsi dari client_email JSON pengirim.

Jangan memakai URL gateway lama sebagai PUBLIC_BASE_URL latihan: URL itu harus benar-benar mengarah ke proses server latihan ini.

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

Project memakai memori satu proses dan ditujukan untuk lokal/server Node yang terus berjalan. Jangan deploy versi ini ke Vercel serverless: state pengguna/approval tidak dijamin bertahan atau dibagi antarpanggilan.

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
4. Buka DM bot, jalankan /daftar.
5. Muat ulang halaman. Email pengguna muncul pada pilihan approver.
6. Isi judul/detail lalu klik Kirim ke Google Chat.
7. Buka kartu pada DM, klik Approve atau Reject.
8. Muat ulang halaman untuk melihat hasil.
9. Coba klik kembali: keputusan pertama dipertahankan.
10. Restart server untuk mulai latihan dari kosong.

Tidak ada validasi NIK pada latihan ini. Identitas email/DM diambil dari event Google yang sudah diverifikasi.

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

- Server restart menghapus semua data. Kartu lama tidak dapat diputuskan karena ID sudah tidak ada.
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

Tes mencakup daftar, kartu/tujuan, approve/reject, pengklik lain, klik ulang, autentikasi, kegagalan kirim, escaping teks dan reset state. Google dimock; tes tidak mengirim notifikasi nyata.

Referensi: [event Google add-on](https://developers.google.com/workspace/add-ons/chat/build), [validasi ID token](https://developers.google.com/workspace/add-ons/guides/alternate-runtimes#validate_json_requests).
