# GChat Hub — demo dengan gateway

Demo yang sudah berjalan ditambahkan gateway dan token. Fitur: /regist + NIK, kirim approval, Approve/Decline, daftar/hapus pengguna dan riwayat.

| Folder | Fungsi |
| --- | --- |
| gchat-hub | Demo, admin, Neon, registrasi dan keputusan |
| integration-gateway | Login/token dan penerus komunikasi Google Chat |
| program-cuti | Program lama; belum dihubungkan |

Alur kirim: halaman hub → login gateway otomatis → Bearer token → gateway → Google Chat.
Alur klik/registrasi: Google Chat → gateway memverifikasi token Google → token relay → hub → respons kembali ke Google.

Cukup satu BRIDGE_SECRET yang sama pada kedua aplikasi. Token transport berlaku 10 menit; relay 1 menit dengan audience berbeda. Hub menyimpan JSON Google dan meminta access token melalui gateway. Gateway tidak menyimpan key atau database. Tidak perlu inject cookie.

## Deploy

Buat dua project Vercel dari repository yang sama. Root Directory project pertama: gchat-hub; project kedua: integration-gateway. Konfigurasi Node function tersedia pada vercel.json masing-masing. Isi env lalu redeploy.

Panduan: [setup-vercel.md](docs/setup-vercel.md).

## Halaman

URL hub + /approval-demo untuk mengirim, /users untuk pengguna, /approvals untuk riwayat. Login: username admin dan ADMIN_PASSWORD.

Endpoint Google Chat: URL gateway + /google-chat. Command /regist ID 1. Avatar: URL gateway + /profile-picture-bot.jpeg.

## Lokal dan pengujian

Node 22+. Jalankan npm install --prefix gchat-hub dan npm install --prefix integration-gateway. Jalankan npm run start:hub dan npm run start:gateway di terminal terpisah. npm test menjalankan simulasi Google dan PostgreSQL PGlite tanpa notifikasi nyata.

Port default hub 3001, gateway 3002. Untuk transport lokal gunakan GATEWAY_URL=http://localhost:3002 dan HUB_URL=http://localhost:3001. Kartu nyata memerlukan URL callback HTTPS; gunakan deployment Vercel untuk mencoba Google Chat.

.env lokal tidak masuk Git dan tidak otomatis menjadi env Vercel. Program-cuti belum terhubung; API banyak aplikasi dan ACK ditunda.

Root vercel.json menonaktifkan deployment Git project lama yang menunjuk root repository. Project baru memakai konfigurasi subfolder.
