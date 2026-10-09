# Setup dua project Vercel

File lokal gchat-hub/.env dan integration-gateway/.env telah disiapkan. Secrets acak dan pasangan login antar-service sudah diisi. Database dan JSON service account lama berada hanya pada env hub. File .env tidak ikut Git.

## 1. Buat dua project

Import repository google-chat-bot dua kali lewat Add New > Project:

| Project | Root Directory |
| --- | --- |
| gchat-hub | gchat-hub |
| integration-gateway | integration-gateway |

Gunakan Node.js 22+. Biarkan Build Command dan Output Directory mengikuti konfigurasi source. Tidak perlu memindahkan project ke dua repository. Untuk deployment awal hub, masukkan DATABASE_URL dari file lokal hub. Gateway bisa deploy awal tanpa konfigurasi, tetapi endpoint bisnisnya akan tertutup.

## 2. Isi alamat deployment di file lokal

Sesudah mendapatkan domain Production kedua project, isi:

Hub:
- HUB_PUBLIC_URL = origin URL hub.
- GATEWAY_URL = origin URL gateway.
- GATEWAY_PUBLIC_URL = origin URL gateway yang sama.

Gateway:
- HUB_URL = origin URL hub.
- GOOGLE_CALLBACK_AUDIENCE = origin URL gateway ditambah /google-chat.
- GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL = email identitas add-on dari Google Chat API Configuration, bagian Convert to Google Workspace add-on; bukan otomatis client_email JSON key pengirim.

Contoh origin: https://nama-project.vercel.app (tanpa slash tambahan atau path).

## 3. Masukkan env pada Vercel

Di setiap project, buka Settings > Environment Variables. Masukkan isi .env milik project tersebut, dengan Import .env jika tersedia atau tambah key/value secara manual. Untuk manual, jangan ikut menyalin tanda kutip pembungkus .env. Pilih environment Production untuk simulasi. Jangan memasukkan env hub ke gateway atau sebaliknya.

PORT hanya untuk lokal dan tidak perlu diisi pada Vercel. Secrets server tidak memakai prefix NEXT_PUBLIC_ atau VITE_. ADMIN_PASSWORD di file hub adalah password login halaman admin yang telah dibuat acak; ADMIN_USERNAME adalah admin. Jika diubah, tetap minimal 12 karakter.

Redeploy kedua project setelah perubahan environment variables.

## 4. Hubungkan Google

Set common HTTP endpoint dan App command trigger ke URL gateway /google-chat. Gunakan /regist dengan Command ID 1. Avatar dapat memakai URL gateway /profile-picture-bot.jpeg. Uji /regist, pengiriman dari hub /approval-demo, dan klik kartu baru. Pantau Logs di kedua project.

## Asal nilai env

- DATABASE_URL: Neon; sudah memakai koneksi lama untuk simulasi.
- GOOGLE_SERVICE_ACCOUNT_JSON: file JSON Google yang sudah ada; sudah diisi di hub.
- URL: domain Production Vercel masing-masing project.
- GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL: konfigurasi Google add-on.
- TOKEN_SECRET: acak, berbeda untuk masing-masing layanan; sudah dibuat.
- GATEWAY_CLIENT_SECRET hub = HUB_CLIENT_SECRET gateway: pasangan secret yang sudah dibuat.
- GATEWAY_RELAY_SECRET hub = HUB_RELAY_CLIENT_SECRET gateway: pasangan berbeda yang sudah dibuat.
- INTEGRATION_CLIENTS_JSON: credentials program sumber untuk login hub; secret program-cuti sudah dibuat, integrasi programnya belum dilakukan.
- Identitas client, command ID, dan username admin: nilai tetap sesuai .env.example.

Private key, database URL, dan semua secrets tidak perlu dikirim ke chat. File .env lokal tidak otomatis masuk ke environment deployment melalui Git.
