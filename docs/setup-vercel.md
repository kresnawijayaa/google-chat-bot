# Setup demo di Vercel

Buat **dua project** dari repo yang sama. Root Directory: gchat-hub pada project pertama dan integration-gateway pada project kedua.

## Env gchat-hub

| Nama | Isi dari mana |
| --- | --- |
| GATEWAY_URL | URL production integration-gateway |
| BRIDGE_SECRET | Satu nilai acak minimal 32 karakter; sama dengan gateway |
| DATABASE_URL | Connection string Neon yang sudah digunakan |
| GOOGLE_SERVICE_ACCOUNT_JSON | Seluruh satu JSON service account pengirim bot yang sudah digunakan |
| ADMIN_PASSWORD | Password halaman admin minimal 12 karakter |

## Env integration-gateway

| Nama | Isi dari mana |
| --- | --- |
| HUB_URL | URL production gchat-hub |
| PUBLIC_URL | URL production gateway ini sendiri |
| BRIDGE_SECRET | Salin BRIDGE_SECRET hub persis sama |
| GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL | Email Service account identitas add-on di Google Chat API Configuration; berbeda fungsi dari JSON pengirim |

Semua URL cukup domain HTTPS tanpa path, misalnya https://nama-gateway.vercel.app. PUBLIC_URL dan GATEWAY_URL berisi domain yang sama.

.env lokal sudah disiapkan dengan satu secret bersama dan credential lama. Lengkapi URL serta email add-on, lalu salin nilai ke Environment Variables masing-masing project Vercel. .env lokal tidak otomatis dibaca Vercel.

## Coba

1. Redeploy kedua project sesudah env diisi.
2. Google Chat API Configuration: arahkan endpoint dan trigger command ke **URL gateway + /google-chat**.
3. DM bot: /regist lalu NIK yang diizinkan. Registrasi lama di Neon yang sama tetap tersimpan.
4. Buka **URL hub + /approval-demo**, login username admin dan ADMIN_PASSWORD.
5. Kirim approval, klik Approve/Decline, cek **URL hub + /approvals**.

Login gateway berjalan otomatis di server; tidak perlu inject cookie. Request Google memakai token Google yang diverifikasi gateway.

Schema: gchat-hub/db/schema.sql. Database lama yang sudah lengkap tidak perlu dibuat ulang.

Tes memakai Google mock. Uji callback Google nyata dilakukan setelah domain dan identitas add-on diisi.
