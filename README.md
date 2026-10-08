# Google Chat Approval Bot — Vercel + Neon PostgreSQL

Aplikasi Express menerima event Google Workspace add-on (event.chat). index.js mengekspor aplikasi untuk Vercel dan tetap bisa dijalankan lokal dengan npm start.

## Mengapa perlu database

Registrasi pengguna dan approval harus tersedia untuk setiap instance Vercel serta tetap tersimpan sesudah redeploy. Aplikasi menggunakan Neon PostgreSQL. Tidak membutuhkan Upstash atau Redis.

## Setup Neon

1. Buat project Neon di https://console.neon.tech.
2. Buka SQL Editor pada branch/database yang akan dipakai dan jalankan seluruh db/schema.sql. Script membuat bot_users dan bot_approvals serta aman dijalankan ulang tanpa menghapus data.
3. Klik Connect dan salin connection string PostgreSQL. Simpan sebagai DATABASE_URL di Vercel, dengan parameter TLS (sslmode=require) dari Neon tetap utuh. Jangan masukkan connection string ke repository atau chat.
4. Pisahkan database/branch Neon untuk Production dan Preview agar data pengujian tidak tercampur.

## Setup deployment lewat push

1. Buat repository Git dan push project ke GitHub. File credentials bot-chat-511003-80064b86bc1b.json sudah diabaikan oleh Git dan Vercel; jangan upload file tersebut.
2. Di Vercel, pilih Add New > Project dan import repository. Vercel mendeteksi Express; tidak perlu build command atau output directory khusus.
3. Isi environment variables pada Settings > Environment Variables:
   - DATABASE_URL: connection string Neon.
   - PUBLIC_BASE_URL: https://nama-project.vercel.app, domain Production stabil tanpa /google-chat.
   - GOOGLE_SERVICE_ACCOUNT_JSON: seluruh isi JSON service account dari kurung { sampai }, tanpa tambahan tanda kutip. Pertahankan escape backslash-n dalam private_key sebagaimana pada file asli.
4. Hapus UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, dan STORAGE_PREFIX dari Vercel jika sempat ditambahkan; kode tidak memakainya lagi.
5. Deploy atau redeploy setelah environment variables diubah. Vercel wajib memiliki DATABASE_URL. Tabel harus sudah dibuat pada database yang ditunjuk connection string.
6. Ubah endpoint HTTP konfigurasi/deployment Google Workspace add-on ke https://nama-project.vercel.app/google-chat. Pastikan Google bisa mengakses endpoint tanpa halaman login Vercel Deployment Protection.
7. Kirim DM baru ke bot untuk registrasi. Buka https://nama-project.vercel.app/approval-demo, kirim kartu baru, lalu klik Approve/Decline. Pantau Vercel Runtime Logs.

Setelah repository terhubung ke Vercel, push ke branch Production memicu deployment otomatis. Kartu lama menyimpan callback lama; kirim kartu baru setelah pindah domain. Data memory lokal atau Redis sebelumnya tidak otomatis dimigrasikan.

## Penyimpanan dan verifikasi

bot_users menyimpan registrasi. bot_approvals menyimpan data pengajuan, approver, dan status. Semua query memakai parameter. Keputusan menggunakan UPDATE bersyarat status PENDING dan approver yang cocok, sehingga hanya satu keputusan berhasil meskipun dua request datang bersamaan. Data tidak dihapus otomatis.

Lokal tanpa DATABASE_URL masih menggunakan memory yang hilang saat restart. Untuk menggunakan Neon secara lokal, set DATABASE_URL sebagai environment variable PowerShell sebelum npm start. File .env.example hanya contoh; aplikasi tidak memuat .env otomatis. GOOGLE_APPLICATION_CREDENTIALS dengan path file masih tersedia untuk credentials lokal.

Jalankan npm test. Tes mencakup alur HTTP, pengiriman kartu dengan Chat API mock, approver salah, keputusan bersamaan, serta schema dan query SQL yang dieksekusi pada PostgreSQL lokal PGlite. Koneksi Neon, deployment Vercel, dan klik nyata Google Chat perlu diuji setelah konfigurasi tersedia.

## Batasan demo publik

/google-chat belum memverifikasi token Google; email dalam payload saja bukan autentikasi. /approval-demo dan /send-approval belum memiliki login. Tambahkan autentikasi sebelum memakai data nyata.

## Referensi

- https://vercel.com/docs/frameworks/backend/express
- https://neon.com/docs/connect/connect-from-any-app
- https://github.com/neondatabase/serverless
- https://developers.google.com/workspace/add-ons/chat/convert
