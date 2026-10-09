# Catatan Alur Google Chat Approval

Catatan ini ditambahkan bertahap sesuai pembahasan dan keputusan yang sudah disepakati.

## 1. Pengguna terdaftar

**Status: Disepakati; diperbarui 9 Oktober 2026.**

Pengguna atau atasan membuka DM bot dan menjalankan /regist. Bot meminta NIK, kemudian memvalidasi NIK serta email Workspace pengirim terhadap tabel allowed_users. Jika cocok dan enabled = TRUE, pendaftaran berhasil dan data disimpan di bot_users. Pesan biasa seperti “halo” tidak mendaftarkan pengguna.

### Sistem teknis

1. /regist memicu POST /google-chat, melalui event appCommandPayload untuk slash command resmi atau messagePayload untuk teks regist.
2. Handler memastikan event berasal dari DM dan memiliki email pengguna serta ID ruang.
3. Bot membuat sesi input NIK di bot_registration_sessions, berlaku 10 menit. Pengguna diminta mengirim NIK sebagai pesan berikutnya.
4. Handler memeriksa sesi dan format NIK berupa angka (maksimal 32 digit). NIK disimpan sebagai teks agar nol di depan tidak hilang.
5. Database mencocokkan NIK, email Workspace, status enabled, ruang DM, dan masa berlaku sesi. NIK yang dimiliki email lain tidak dapat dipakai.
6. Jika valid, bot_users diisi email, NIK, nama tampilan, identitas Google, ID DM, dan waktu registrasi/interaksi. Sesi dihapus dalam operasi SQL yang sama.
7. Bot membalas berhasil. Jika tidak cocok, bot membalas gagal dan pengguna dapat mencoba NIK lagi selama sesi berlaku.

Pendaftaran cukup sekali. Pengguna lama yang belum memiliki NIK harus menjalankan /regist. Penghapusan registrasi dari admin tidak menghapus allowed_users atau riwayat approval; registrasi ulang tetap harus melalui command dan validasi NIK.

Cara ini dipilih karena instalasi massal oleh admin Workspace berada di luar kewenangan developer IT SD 2, sementara pengguna berasal dari berbagai subdivisi IT.

**Batasan saat ini:** endpoint belum memverifikasi token Google. Validasi NIK-email merupakan pemeriksaan daftar izin, belum menggantikan autentikasi request Google.

## 2. Kirim notifikasi approval

**Status: Belum dibahas lebih lanjut.**

## 3. Approver klik tombol

**Status: Belum dibahas lebih lanjut.**
