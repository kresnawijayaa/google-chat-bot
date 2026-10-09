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

**Status: Mekanisme autentikasi pengiriman disepakati pada 9 Oktober 2026; integrasi program kantor belum diterapkan.**

### Keputusan autentikasi

Bridge kantor akan menggunakan service account key JSON untuk autentikasi sebagai bot saat memanggil Google Chat API.

Credentials Google dikelola hanya oleh bridge. Program cuti dan program subdivisi IT lainnya mengirim permintaan approval ke bridge, tanpa menyimpan atau menerima salinan key JSON Google. Autentikasi masing-masing program ke bridge masih perlu dibahas.

### Gambaran teknis

1. Program sumber mengirim data pengajuan dan tujuan approver ke bridge.
2. Bridge menggunakan registrasi pengguna untuk menentukan ID ruang DM approver.
3. Library Google pada bridge menggunakan key JSON untuk memperoleh access token sementara.
4. Bridge memakai access token tersebut untuk memanggil Google Chat API dan mengirim kartu approval.

Private key JSON tidak dikirim sebagai isi kartu atau dibagikan kepada pengguna. Autentikasi ini digunakan untuk pengiriman ke Google; verifikasi request masuk dari Google saat tombol diklik merupakan bagian terpisah yang dibahas pada nomor 3.

### Ketentuan pengelolaan production

- Simpan key dalam pengelola secrets atau lokasi server terlindungi sesuai kebijakan perusahaan; jangan masukkan ke repository, folder publik, atau log.
- Batasi akses key ke service bridge dan pengelola yang berwenang, dengan izin service account sesuai kebutuhan.
- Pisahkan credentials production dari pengujian.
- Siapkan rotasi serta pencabutan key jika terjadi kebocoran.

Pemilihan JSON merupakan keputusan implementasi, bukan pernyataan bahwa keamanan production atau kelulusan pentest sudah diverifikasi. Pengendaliannya tetap mengikuti ketentuan tim security perusahaan.

### Hal yang masih akan dibahas

- Autentikasi program sumber ke bridge.
- Format permintaan pengajuan dan penentuan approver.
- Penanganan kegagalan pengiriman serta status yang dikembalikan ke program sumber.

## 3. Approver klik tombol

**Status: Alur implementasi saat ini sudah dibahas dan dicatat pada 9 Oktober 2026. Integrasi ke program kantor belum diterapkan.**

### Sistem teknis saat ini

1. Approver menekan Approve atau Decline pada kartu di Google Chat.
2. Tombol memuat URL endpoint /google-chat, ID pengajuan, dan parameter aksi approve atau decline. Server Google mengirim HTTP POST ke aplikasi bot di Vercel, termasuk identitas pengguna yang mengklik.
3. Handler memeriksa bahwa aksi valid, pengajuan ditemukan di Neon, email pengklik sesuai email approver, dan status masih PENDING.
4. Jika valid, database menyimpan status APPROVED atau DECLINED, email pengambil keputusan, dan waktu keputusan. UPDATE dilakukan secara atomik dengan syarat approver cocok dan status PENDING, sehingga hanya satu keputusan berhasil jika dua klik datang bersamaan.
5. Handler mengembalikan respons updateMessageAction kepada Google untuk mengganti kartu dengan hasil keputusan. Kartu hasil tidak lagi menampilkan tombol Approve/Decline.
6. Halaman /approvals membaca status terbaru dari Neon. DECLINED ditampilkan sebagai Rejected pada halaman admin.

**Alur ringkas:** klik tombol → server Google → POST /google-chat → validasi → simpan keputusan di Neon → respons untuk memperbarui kartu.

### Jika pemeriksaan gagal

- Aksi tidak valid, pengajuan tidak ditemukan, atau email pengklik tidak sesuai: keputusan tidak diubah dan bot mengembalikan pesan penjelasan.
- Pengajuan sudah diputuskan: keputusan lama dipertahankan dan bot menginformasikan statusnya.

### Autentikasi dan batasan

- Pada alur ini, pembaruan kartu dilakukan melalui respons langsung terhadap request Google. Handler tidak perlu memakai key JSON untuk memanggil API pengiriman pesan lagi.
- Endpoint saat ini belum memverifikasi token Google. Pemeriksaan email masih bergantung pada payload request; verifikasi asal request tetap perlu ditambahkan untuk production.
- Keputusan baru memperbarui database bot di Neon, belum memperbarui program cuti atau program kantor lainnya.
- Penyimpanan keputusan dan pembaruan kartu bukan satu transaksi. Jika respons ke Google gagal setelah keputusan tersimpan, keputusan tetap ada di database walaupun kartu mungkin belum diperbarui.

Pencatatan alur ini bukan verifikasi keamanan production atau kelulusan pentest.

### Hal yang masih akan dibahas

- Verifikasi token request Google pada endpoint bridge.
- Cara meneruskan keputusan ke program kantor, termasuk autentikasinya.
- Penanganan kegagalan sinkronisasi ke program sumber atau pembaruan kartu.


## 4. Simulasi sederhana dengan gateway — 9 Oktober 2026

Dua layanan Vercel: gchat-hub menjalankan demo lama, integration-gateway menjadi penerus komunikasi Google Chat. Program-cuti dibiarkan dan belum dihubungkan.

Fitur hub tetap: /regist + NIK, kirim dari halaman demo, Approve/Decline, daftar/hapus pengguna, riwayat. Neon dan key Google berada di hub, menggantikan rencana key pada bridge di bagian 2.

Hub login otomatis ke POST /auth/token gateway memakai client_id gchat-hub dan BRIDGE_SECRET. Token Bearer berlaku 10 menit untuk transport Google. Tidak perlu cookie.

Google mengirim registrasi/klik ke /google-chat gateway. Gateway memverifikasi signature, audience, expiry dan identitas add-on pada Google ID token, kemudian meneruskan ke /internal/google-chat hub dengan token relay 1 menit. Hub memverifikasi relay dan memproses event; gateway mengembalikan respons ke Google.

Demo memakai satu BRIDGE_SECRET yang sama di dua layanan; audience token transport dan relay berbeda. Konfigurasi banyak client/secret, API aplikasi sumber, polling keputusan dan ACK tidak digunakan pada tahap ini.

Bagian 1–3 mencatat demo lama. Verifikasi Google kini tersedia pada gateway baru. Tes simulasi lulus; callback nyata perlu dicoba setelah URL dan identitas add-on dikonfigurasi.

Panduan: [setup-vercel.md](setup-vercel.md).

## 5. API integrasi aplikasi — 9 Oktober 2026

Hub menyediakan POST /auth/token, POST /api/approvals dan GET /api/approvals/:id. Setiap aplikasi mendapat client_id/secret sendiri melalui APP_CLIENTS_JSON. Program sumber tidak menerima key Google atau BRIDGE_SECRET.

Pengajuan dikirim dengan requestId stabil, NIK approver, nama pemohon, jenis, tanggal dan alasan. Hub mencari registrasi DM berdasarkan NIK, menyimpan kepemilikan aplikasi dan mengirim lewat gateway yang sama. Retry data sama memakai record lama; payload berbeda dengan requestId sama ditolak 409.

Program sumber mengambil status per ID menggunakan tokennya dan hanya dapat membaca record miliknya. Program sumber menerapkan keputusan ke database sendiri; tidak ada webhook atau ACK pada tahap ini. Program-cuti lama belum dimodifikasi untuk memanggil API.

Panduan developer: [integrasi-aplikasi.md](integrasi-aplikasi.md).
