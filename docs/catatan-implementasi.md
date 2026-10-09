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


## 4. Pemisahan layanan — 9 Oktober 2026

Arsitektur baru memakai gchat-hub sebagai layanan pusat dan integration-gateway sebagai gateway. Program-cuti sebelumnya dipertahankan tanpa modifikasi dan belum memanggil API hub. Kedua layanan baru akan berjalan sebagai project Vercel terpisah.

Gchat-hub mengelola registrasi, database, pengajuan, keputusan dan key Google. Integration-gateway mengelola transport serta verifikasi token Google; tidak menyimpan data bisnis. Penempatan key pada hub menggantikan rencana awal key berada pada bridge di bagian 2.

Program sumber login ke hub dengan credentials aplikasi. Hub login ke gateway untuk transport keluar. Gateway memverifikasi Google ID token, lalu login ke hub untuk meneruskan callback. Setiap arah memiliki credentials yang berbeda. Keputusan tetap disampaikan kepada program sumber melalui API hub dan perlu ACK setelah diterapkan.

Bagian 1–3 di atas mencatat implementasi demo sebelumnya. Pada layanan baru, endpoint Google berada di gateway dan hub hanya menerima event dengan token relay terautentikasi. Verifikasi Google sudah tersedia dalam kode baru; callback Google nyata belum diuji sampai konfigurasi identitas add-on dan domain tersedia.
