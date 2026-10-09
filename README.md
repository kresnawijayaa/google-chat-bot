# GChat Integration Workspace

Tiga aplikasi terpisah dalam satu repository. Tidak ada kredensial yang dibagikan ke repository.

| Folder | Peran |
| --- | --- |
| program-cuti | Aplikasi/demo sebelumnya, dipertahankan tanpa perubahan pada tahap ini |
| gchat-hub | Registrasi, database, kartu approval, kepemilikan pengajuan dan keputusan |
| integration-gateway | Verifikasi callback Google dan transport HTTPS ke/dari Google; tanpa database bisnis |

## Alur

Program sumber → login gchat-hub → kirim pengajuan ke hub → hub login gateway → gateway meneruskan pengiriman ke Google.

Google → callback gateway dengan ID token Google → gateway memverifikasi token → gateway login hub → hub memproses event → respons hub dikembalikan gateway ke Google.

Program sumber mengambil keputusan dari hub memakai tokennya, menerapkan aturan bisnis, lalu mengirim acknowledgment. Tidak ada polling antrean di gateway; kedua layanan akan ditempatkan di Vercel dan saling memanggil langsung. Program cuti belum diintegrasikan dengan API baru.

## Local development

Node.js 22 atau lebih baru (diuji dengan Node 24).

1. npm install --prefix gchat-hub
2. npm install --prefix integration-gateway
3. Salin .env.example masing-masing aplikasi ke .env dan isi konfigurasinya.
4. Untuk lokal: hub memakai PORT=3001 dan HUB_PUBLIC_URL=http://localhost:3001; gateway memakai PORT=3002, HUB_URL=http://localhost:3001; hub memakai GATEWAY_URL=http://localhost:3002. GATEWAY_PUBLIC_URL tetap URL HTTPS callback nyata saat mengirim kartu Google, bukan localhost.
5. Jalankan npm run start:hub dan npm run start:gateway pada terminal terpisah.
6. npm test pada root menjalankan tes dua service dan PostgreSQL lokal. Tes tidak mengirim pesan Google nyata.

## Deployment Vercel

Buat dua project Vercel dari repository ini:

- Project gchat-hub: Root Directory = gchat-hub.
- Project integration-gateway: Root Directory = integration-gateway.

Jangan deploy seluruh repository root sebagai website statis. Konfigurasi fungsi Node sudah tersedia pada vercel.json di masing-masing folder. Gunakan Node 22+ dan domain Production yang stabil. Endpoint service-to-service harus bisa dijangkau tanpa halaman login Vercel Deployment Protection; autentikasi aplikasi tetap diwajibkan oleh kode.

Isi environment variables sesuai .env.example masing-masing folder. Tidak ada secret default. TOKEN_SECRET dan credentials client minimal 32 karakter acak. Buat setiap secret secara terpisah dan simpan lewat pengaturan Environment Variables Vercel. Untuk menghasilkan satu nilai acak lokal: node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))".

### Pasangan konfigurasi antar-service

| Hub | Gateway | Keterangan |
| --- | --- | --- |
| GATEWAY_CLIENT_SECRET | HUB_CLIENT_SECRET | Nilai sama; login hub ke gateway |
| GATEWAY_RELAY_SECRET | HUB_RELAY_CLIENT_SECRET | Nilai sama; login gateway ke hub |
| GATEWAY_CLIENT_ID=gchat-hub | HUB_CLIENT_ID=gchat-hub | Identitas hub |
| Identitas relay tetap integration-gateway | HUB_RELAY_CLIENT_ID=integration-gateway | Identitas gateway |
| GATEWAY_URL | Domain gateway | Origin HTTPS, tanpa path |
| GATEWAY_PUBLIC_URL | Domain gateway | URL untuk action.function pada kartu |
| HUB_PUBLIC_URL | HUB_URL | Domain hub yang sama |

TOKEN_SECRET masing-masing layanan harus berbeda. Key JWT milik hub bukan key JWT gateway. Google ID token juga tidak diterima sebagai token aplikasi hub.

### Konfigurasi Google

- Hub: GOOGLE_SERVICE_ACCOUNT_JSON berisi JSON lengkap service account pengirim bot. Private key hanya disimpan di hub.
- Gateway: GOOGLE_CALLBACK_AUDIENCE = https://DOMAIN-GATEWAY/google-chat.
- Gateway: GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL = email identitas add-on yang ditunjukkan konfigurasi Google Chat/Workspace add-on. Ini bukan otomatis client_email JSON pengirim bot.
- Di Google Chat API, arahkan common endpoint dan App command trigger ke https://DOMAIN-GATEWAY/google-chat. Command /regist memakai ID 1.
- Avatar URL: https://DOMAIN-GATEWAY/profile-picture-bot.jpeg.
- Endpoint Google menolak token hilang, kedaluwarsa, signature/audience salah, serta identitas add-on yang tidak cocok. Verifikasi dilakukan dengan OAuth2Client Google.
- Endpoint /google-chat berada di gateway; hub hanya menerima /internal/google-chat dengan token khusus role gateway.

### Database hub

DATABASE_URL hanya berada di hub. Gunakan database pengujian atau branch Neon terpisah ketika mencoba arsitektur baru. Jalankan gchat-hub/db/schema.sql di SQL Editor pada database target. Seluruh schema mendukung CREATE IF NOT EXISTS dan tidak menghapus data.

Registrasi: isi allowed_users, jalankan /regist lalu kirim NIK. bot_users, bot_approvals, dan sesi NIK disimpan oleh hub. Gateway tidak memiliki DATABASE_URL dan tidak menyimpan keputusan.

### Aplikasi pemanggil

INTEGRATION_CLIENTS_JSON pada hub berisi array client, contoh format:

```json
[{"id":"program-cuti","secret":"ISI_DENGAN_SECRET_ACAK_MINIMAL_32_KARAKTER"}]
```

Setiap aplikasi memperoleh secret berbeda. ID integration-gateway dicadangkan untuk relay dan tidak boleh dipakai aplikasi sumber. Identitas aplikasi ditentukan dari token, bukan request body.

## API aplikasi sumber

Login:

```http
POST /auth/token
Content-Type: application/json

{"client_id":"program-cuti","client_secret":"SECRET_APLIKASI"}
```

Respons access_token berlaku 600 detik. Request berikutnya mengirim Authorization: Bearer TOKEN. Program menyimpan secret di server, bukan browser pengguna.

Pengajuan:

```json
{
  "requestId": "CUTI-2026-001",
  "approverNik": "00123456",
  "employeeName": "Budi Santoso",
  "type": "Cuti",
  "date": "12–13 Oktober 2026",
  "reason": "Keperluan keluarga"
}
```

| Endpoint hub | Peran |
| --- | --- |
| POST /api/approvals | Mengirim pengajuan; approver harus sudah registrasi NIK |
| GET /api/approvals/:id | Membaca pengajuan milik aplikasi pemanggil |
| GET /api/decisions | Mengambil maksimal 100 keputusan yang belum diakui aplikasi pemanggil |
| POST /api/decisions/:id/ack | Konfirmasi keputusan sudah diterapkan; aman dipanggil ulang |

Pasangan client_id + requestId menentukan ID pengajuan. Pengiriman ulang data identik mengembalikan record yang sama tanpa mengirim kartu kedua. Data berbeda dengan requestId sama ditolak 409. Record dengan deliveryStatus FAILED/SENDING tidak otomatis dikirim ulang; pemulihan pengiriman masih menjadi pekerjaan lanjutan.

Status keputusan APPROVED/DECLINED terpisah dari syncStatus AWAITING_ACK/ACKNOWLEDGED. ACK hanya mencatat laporan program sumber; hub tidak memverifikasi update database program sumber. Integrasi dan aturan cuti tetap milik program sumber.

## Admin hub

/users, /approvals, /approval-demo dan /send-approval dilindungi login Basic admin lewat HTTPS. ADMIN_PASSWORD minimal 12 karakter; tanpa konfigurasi halaman tertutup. Halaman kirim demo juga memeriksa Origin sesuai HUB_PUBLIC_URL. Penghapusan pengguna tetap memerlukan token konfirmasi; tidak menghapus riwayat.

## Batasan tahap pertama

Ini fondasi simulasi, belum sertifikasi production/pentest. Belum ada integrasi program-cuti, pencabutan token per sesi, rate limiting terdistribusi, retry otomatis pengiriman, atau sinkronisasi pembaruan kartu sesudah ACK. Token aplikasi berlaku singkat dan registry client berasal dari environment variables. Tidak ada endpoint proxy URL bebas; gateway hanya memanggil OAuth token endpoint dan Chat messages endpoint Google yang ditetapkan di kode. Semua callback Google diteruskan sinkron; hub perlu tersedia dan merespons cepat.

## Referensi

- https://developers.google.com/workspace/add-ons/guides/alternate-runtimes#validate_json_requests
- https://developers.google.com/workspace/add-ons/chat/convert
- https://developers.google.com/identity/protocols/oauth2/service-account

Root vercel.json menonaktifkan deployment Git pada project yang masih menunjuk root repository. Dua layanan memakai konfigurasi Vercel masing-masing dalam subfolder. Project lama dapat diarahkan ke program-cuti bila ingin melanjutkan demo lama.

Panduan langkah singkat dan asal environment variables: [docs/setup-vercel.md](docs/setup-vercel.md).
