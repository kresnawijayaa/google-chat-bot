# Bekal Training Google Chat — IT SD 2 / Time Management

15 Oktober 2026, 14.00–17.00 WIB.

Cakupan pengguna: absensi/shift/lembur/cuti/payroll serta timesheet/alokasi proyek. Dokumen memisahkan fakta PDF EDTS, kemampuan Google yang diverifikasi, dan gagasan pengembangan yang masih perlu backend/data/izin perusahaan.

## 1. Kesimpulan penilaian

Google Chat cocok menjadi kanal tindakan cepat dan antarmuka kerja dalam percakapan. Untuk kasus Time Management, nilai besarnya datang dari deteksi masalah, konteks keputusan, pengisian/koreksi singkat dan tindak lanjut. Sistem transaksi, aturan dan audit bisnis tetap milik backend.

Skor berikut penilaian subjektif atas kecocokan, bukan rating resmi atau hasil benchmark:

| Kebutuhan | Skor | Syarat |
| --- | --- | --- |
| Notifikasi tertarget + tindakan singkat | 9/10 | Identitas penerima, izin, antarmuka ringkas |
| Koreksi absensi/timesheet dan approval berkonteks | 8/10 | Backend validasi, otorisasi dan integrasi |
| Portal mini pribadi di Chat | 8/10 | App Home, data personal dan kontrol akses |
| Pemantauan exception operasional | 8/10 | Deteksi/backend, deduplikasi, eskalasi |
| Pengganti aplikasi payroll/roster kompleks | 3/10 | Form/tabel besar lebih cocok tetap pada web khusus |

Skor rendah pengganti ERP tidak berarti Chat tidak bisa memanggil ERP; artinya antarmuka Chat kurang cocok untuk seluruh proses besar.

## 2. Tiga lapisan yang jangan dicampur

| Lapisan | Contoh | Pemilik keputusan |
| --- | --- | --- |
| Google Chat | Kartu, dialog, command, App Home, event, pesan/thread | Platform Google |
| Implementasi EDTS | /create_msg, msg_type, base64 envelope, mapping employee_id | EDTS; perlu konfirmasi cakupan layanan |
| Aplikasi Time Management | Aturan shift, cut-off, delegasi, validasi lembur, sumber data, audit | IT SD 2/pemilik proses terkait |

Batas layanan EDTS bukan otomatis batas Google. Sebaliknya fitur Google yang ada di dokumentasi belum tentu dibuka melalui API EDTS atau diizinkan admin Workspace perusahaan.

### Istilah webhook

Incoming webhook Google adalah kanal kirim notifikasi satu arah. Endpoint HTTP aplikasi yang menerima event command/klik adalah mekanisme berbeda. Keduanya sering sama-sama disebut webhook.

Sumber: [Incoming webhook](https://developers.google.com/workspace/chat/quickstart/webhooks).

## 3. Peta kemampuan platform

| Fitur | Manfaat Time Management | Bagian tambahan |
| --- | --- | --- |
| Kartu dan tombol | Ringkasan kasus, buka detail, setujui/tolak | Backend otorisasi/transaksi |
| Input teks/dropdown/tanggal | Koreksi jam, pilih alasan atau proyek | Validasi bisnis server |
| Dialog bertahap | Minta koreksi → isi alasan → konfirmasi | Penyimpanan draft/state |
| App Home | Daftar pekerjaan pribadi, timesheet tertunda | API data/dashboard pribadi |
| Link preview native | Tautan pengajuan berubah menjadi kartu konteks | URL pattern dan handler preview |
| Pesan proaktif/thread | Pengingat tertarget, riwayat satu kasus | Scheduler/queue dan mapping kasus |
| Integrasi layanan lain | Data issue/calendar/HR sebagai konteks | API/scope/izin masing-masing |
| AI | Draft/ringkasan penjelasan berbasis data | Model, data grounding dan kontrol akses |

Google menyediakan widget input, dialog dan App Home. App Home berada pada tab Home DM aplikasi, bukan website arbitrary yang ditanam sebagai iframe. Link preview native dipicu pola URL terdaftar, berbeda dari sekadar mengirim kartu berisi link.

Sumber: [Widget](https://developers.google.com/workspace/chat/design-interactive-card-dialog), [dialog](https://developers.google.com/workspace/chat/dialogs), [App Home](https://developers.google.com/workspace/chat/send-app-home-card-message), [link preview](https://developers.google.com/workspace/chat/preview-links).

AI bukan kemampuan otomatis dari setiap bot. Akses data Calendar/issue/HR juga tidak otomatis didapat karena bot ada di Chat.

## 4. Ide yang memberi nilai khusus untuk IT SD 2

Semua contoh angka di bawah adalah ilustrasi. Kebijakan aktual perlu ditentukan pemilik proses; tidak diasumsikan sebagai kebijakan Indomaret.

### A. Penyelesaian exception absensi

Contoh: jadwal shift tersedia, ada jam masuk, tetapi jam pulang belum diterima.

Alih-alih hanya menulis “data tidak lengkap”, bot menampilkan tanggal, shift, sumber data dan waktu sinkronisasi. Tombol: lihat bukti, ajukan koreksi, laporkan mesin bermasalah. Dialog meminta alasan/data minimum. Backend memeriksa apakah ini benar missing punch atau data perangkat terlambat.

Keunikan: mengurangi kasus salah tindak karena keterlambatan sumber data. Hindari membuat 100 tiket personal bila akar masalahnya satu mesin offline.

Data: roster, raw punch, status perangkat/sinkronisasi, hierarki atasan, aturan koreksi. Metrik: waktu penutupan exception, false positive, jumlah koreksi manual.

### B. Kesiapan cut-off Time Management

Contoh: satu unit masih memiliki koreksi, lembur atau persetujuan yang menahan proses cut-off.

Bot mengirim ringkasan kepada penanggung jawab sesuai scope unit, mengurutkan kasus berisiko dan membuka daftar tindakan. Snapshot menyertakan waktu/data version. Perubahan setelah kartu dikirim harus diperiksa ulang sebelum dieksekusi.

Keunikan: membantu menyelesaikan hambatan sebelum cut-off, bukan sekadar mengirim laporan. Status “sudah klik” harus dibedakan dari “sudah terposting di sistem sumber”.

Metrik: unit siap tepat waktu, umur kasus, kasus yang terbuka kembali, selisih Chat vs sistem sumber.

### C. Rekonsiliasi absensi, timesheet dan proyek

Contoh: pegawai hadir pada suatu hari, tetapi alokasi proyek belum lengkap atau ada alokasi pada tanggal cuti.

Bot menunjukkan perbedaan dan meminta konfirmasi/alokasi. Tidak langsung menyimpulkan salah atau curang. Jam hadir, jam kerja yang diakui dan jam chargeable bisa berbeda secara sah.

Keunikan: Anda mencakup kedua domain, sehingga dapat menjelaskan sumber selisih dan proses koreksinya. Aturan rekonsiliasi lebih bernilai daripada sekadar form timesheet.

Data: attendance, cuti, timesheet, kalender kerja, daftar proyek dan aturan alokasi.

### D. Draft timesheet untuk dikonfirmasi

Backend mengusulkan aktivitas berdasarkan sumber resmi yang diizinkan, misalnya issue/tiket atau agenda. Pegawai mengedit dan mengonfirmasi sebelum submit.

Setiap usulan menyebut sumbernya. Jangan otomatis menganggap durasi meeting/aktivitas Chat sebagai jam kerja yang sah.

Keunikan: mengurangi beban input, tetap menjaga akuntabilitas. AI opsional; prefill berbasis aturan sederhana bisa menjadi tahap pertama.

### E. Persetujuan perubahan shift dengan konteks coverage

Sebelum atasan menyetujui cuti/tukar shift, backend menampilkan dampak pada jumlah personel, benturan jadwal dan kompetensi yang perlu tersedia. Aturan disesuaikan kebijakan perusahaan.

Google menyediakan antarmuka; perhitungan coverage dan validasi tetap backend Time Management. Persetujuan final harus memeriksa data terbaru, bukan hanya percaya ringkasan lama.

### F. Koordinasi incident pipeline absensi

Jika banyak cabang/perangkat berhenti mengirim data, buat satu kasus insiden dengan unit terdampak, pemilik, ETA dan langkah pemulihan. Gunakan thread agar update tidak menjadi spam pesan baru.

Hubungkan insiden ke exception pegawai agar pengguna memahami status. Aksi retry/reprocess harus dibatasi role, memiliki ID operasi dan audit; jangan menjalankan perintah bebas dari input Chat.

### G. Pelacakan hambatan pekerjaan/proyek

Tindak lanjut timesheet terlambat, approval backlog atau pekerjaan tertahan dengan pilihan alasan terstruktur: menunggu requirement, akses, vendor, review atau kendala teknis.

Hasilnya dipakai mencari hambatan proses dan alokasi kapasitas, bukan memberi skor produktivitas dari banyaknya chat.

### H. Penjelasan hasil perhitungan dengan jejak data

Pengguna bertanya mengapa data hari tertentu dianggap tidak lengkap atau berpengaruh pada perhitungan. Backend menampilkan data sumber, aturan/version, waktu proses dan tindakan koreksi yang tersedia.

Jika memakai AI, model merangkum data yang sudah diotorisasi; keputusan dan angka harus berasal dari aturan/data terverifikasi.

## 5. Prioritas yang disarankan

Penilaian desain, belum estimasi berdasarkan data volume perusahaan:

| Urutan | Pilot | Alasan |
| --- | --- | --- |
| 1 | Exception absensi sampai selesai | Kasus terukur dan cocok aksi singkat |
| 2 | Daftar prioritas kesiapan cut-off | Dampak operasional, memerlukan ownership jelas |
| 3 | Rekonsiliasi attendance–timesheet | Paling sesuai cakupan dua domain Anda |
| 4 | Draft timesheet berbasis data resmi | Potensi tinggi, butuh persetujuan akses sumber |

Mulai dari satu jenis exception, satu unit dan satu pemilik proses. Tetapkan baseline/KPI sebelum membuat banyak command atau menambah AI.

## 6. Batas teknis dan operasional

- Respons sinkron interaksi harus dalam 30 detik. Proses berat perlu respons cepat lalu eksekusi/asynchronous update. Sumber: [interaksi](https://developers.google.com/workspace/chat/receive-respond-interactions).
- Batas create message adalah 32.000 byte. API memiliki kuota per project dan per-space. Dokumentasi saat diperiksa mencantumkan 3.000 message writes/menit per project dan 1 write/detik per-space; kuota deployment perlu dicek di console. Queue, digest dan backoff relevan saat massal. Sumber: [create message](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/create), [kuota](https://developers.google.com/workspace/chat/limits).
- Dialog dibuka sebagai respons interaksi pengguna, bukan dipaksa muncul tiba-tiba sebagai pop-up oleh server. Sumber: [dialog](https://developers.google.com/workspace/chat/dialogs).
- Service account bot tidak otomatis berhak melakukan semua operasi Workspace. Scope, app/user authentication dan admin approval bergantung operasi. Sumber: [autentikasi](https://developers.google.com/workspace/chat/authenticate-authorize).
- Jangan menjanjikan bot bisa membaca semua chat pegawai atau semua read receipt. API read state biasa hanya untuk calling user dengan user auth. Akses organisasi luas pada API tertentu dapat membutuhkan admin approval dan/atau Developer Preview. Sumber: [read state](https://developers.google.com/workspace/chat/api/reference/rest/v1/users.spaces/getSpaceReadState), [scope Events API](https://developers.google.com/workspace/events/guides/auth).
- Link file tidak memberi izin membaca file. ACL Drive/layanan sumber tetap harus diuji untuk penerima dan pengguna lain.
- Chat aktif, status online atau pesan malam hari bukan bukti sah absensi, lokasi atau lembur.
- Chat adalah kanal UI; database transaksi dan audit bisnis tetap sumber kebenaran. History Chat tidak menggantikan catatan before/after, actor, requestId dan outcome sistem sumber.

## 7. Hasil membaca PDF EDTS

Sumber lokal: [PDF EDTS](%5BEDTS%5D%20Google%20Chat%20API%20Usage%20Standard.pdf), 22 halaman. Ini telaah dokumen, bukan audit kode/layanan EDTS.

### Yang jelas ditunjukkan

- Hal. 1–3: POST /create_msg, envelope message.data base64, payload leave_approval dan screenshot tombol Approve/Reject.
- Hal. 4–7: kartu teks/link/image dan URL gambar.
- Hal. 8–10: pengiriman tautan Drive dan tombol Download, bukan dokumentasi upload biner file ke Chat.
- Hal. 11: diagram EDTS bot, pemrosesan di Cloud Run, BigQuery dan Drive.
- Hal. 11–18: event message, added/removed space, command, identitas pengguna/ruang/thread.
- Hal. 19–22: daftar/report/start/help dan interaksi thread.

### Hal yang belum cukup jelas untuk integrasi production

| Temuan | Pertanyaan yang tepat |
| --- | --- |
| Payload leave_approval berisi employee_id/tanggal tetapi ID transaksi tidak ditunjukkan | Bagaimana satu klik dipetakan ke pengajuan yang tepat? employee_id milik penerima atau pemohon? |
| Screenshot tombol ada, kontrak callback approve/reject belum dirinci | Mohon contoh request/response callback, actor dan ID pengajuan |
| Contoh /create_msg hanya menunjukkan Content-Type | Autentikasi pemanggil dan pembatasan project_id/employee_id diatur di mana? |
| Base64 envelope | Mengapa base64? Apakah ini format ingress Pub/Sub atau kontrak transport internal? Base64 sendiri bukan autentikasi/enkripsi |
| Respons sukses/error /create_msg tidak dijabarkan lengkap | “Sukses” berarti queued, diterima Google atau terposting? Apa message ID/correlation ID? |
| Retry dan klik ulang belum dijelaskan | Bagaimana deduplikasi, timeout dan keputusan bersamaan ditangani? |
| File dikirim sebagai Drive link | Bagaimana ACL, pencabutan akses dan pengguna yang tidak berhak diuji? |
| Nama msg_type berbeda antara ringkasan/contoh | Mana nilai resmi upload_image/upload_img dan varian send_attachment/send_attachments? Ada schema/version/changelog? |
| Istilah link_preview | Apakah hanya template kartu berisi link atau native preview saat orang paste URL? |
| “Bot merespons thread” | Apakah bot menerima semua reply atau hanya event yang memang dideliver? Bagaimana membership/scope/config-nya? |

Kalimat “belum dijelaskan dalam PDF” tidak berarti fitur/kontrol tidak ada pada implementasi. Gunakan untuk meminta kontrak atau demo, bukan menuduh.

Hal. 19 memuat screenshot “not responding” sekaligus hasil registrasi. Tanyakan kontrak respons sinkron/asinkron dan penanganan timeout, bukan menganggap produksi pasti bermasalah.

PDF juga memuat ejaan arguzmentText pada objek pesan; referensi Google menggunakan argumentText. Perlakukan cuplikan sebagai ilustrasi dan mintalah schema/sample valid yang dapat diuji.

## 8. Pertanyaan prioritas untuk trainer

1. Mana fitur Google native, mana yang tersedia melalui API EDTS, mana yang bisa dibangun sendiri oleh subdivisi?
2. Apakah tim kami boleh memiliki aplikasi/bot sendiri, atau semua wajib melalui layanan EDTS? Siapa pemilik project, akses konfigurasi dan proses approval scope/admin?
3. Bagaimana provisioning NIK–email–DM, mutasi atasan/unit, pegawai nonaktif dan skala pengguna ditangani?
4. Mohon demo approval end-to-end: ID transaksi, actor dari Google terverifikasi, validasi otorisasi, update sistem sumber, lalu pembaruan kartu.
5. Bila klik dua kali, request di-retry atau transaksi diedit setelah kartu dikirim, bagaimana mencegah keputusan ganda/keputusan atas versi lama?
6. Jika Google menerima kartu tetapi respons terputus, bagaimana rekonsiliasi, retry dan pencarian correlation ID?
7. Saat menjelang cut-off ribuan notifikasi, di mana queue, rate limit, digest dan alarm kegagalan berada?
8. Bisakah form/dialog, dynamic selection, App Home dan native link preview digunakan melalui standar EDTS? Minta contoh yang bisa dijalankan.
9. Siapa yang boleh membaca data pegawai/file, dan bagaimana akses ditinjau ulang saat jabatan berubah?
10. Apa batas kepemilikan data dan SLA antara EDTS, tim aplikasi, gateway dan Google? Log mana yang bisa dilihat IT SD 2?

## 9. Tiga skenario demo yang lebih bermakna

### Kartu lama

Pengajuan v1 dikirim; pemohon mengubah tanggal menjadi v2 sebelum atasan klik. Harapan: server mendeteksi versi lama dan meminta konfirmasi data terbaru, bukan memproses diam-diam.

### Commit berhasil, respons gagal

Atasan klik, DB sudah berubah, response timeout. Harapan: retry tidak membuat transaksi baru; status dapat ditelusuri dan kartu direkonsiliasi.

### Hak atasan berubah

Atasan pindah unit setelah kartu dikirim. Harapan: otorisasi dievaluasi kembali saat aksi, bukan hanya saat kartu dibuat.

Ketiganya menguji sistem transaksi/otorisasi, bukan sekadar UI tombol.

## 10. Cara memakai sesi 14.00–17.00

Bukan jadwal resmi penyelenggara; ini strategi pribadi:

- Awal: petakan layer Google/EDTS/aplikasi dan model permission.
- Tengah: minta jalur lengkap satu kasus dan payload callback.
- Saat praktik: uji timeout/duplikasi/otorisasi dengan skenario yang disepakati trainer.
- Sebelum selesai: dapatkan endpoint sandbox, sample valid, schema/version, pemilik support dan batas scope tim Anda.

Jika waktu bertanya sedikit, dahulukan nomor 1, 4, 5, 6 dan 8.

## 11. Kaitannya dengan repo kita

Fondasi hub/gateway sudah menunjukkan registrasi NIK, pengiriman dan klik approval, credential per program, ownership, requestId dan log. Itu bekal untuk memahami integrasi.

Fitur App Home/dialog, cutoff workflow, delegasi dinamis, queue/digest skala besar, integrasi sumber attendance/timesheet serta rekonsiliasi sistem kantor belum dianggap tersedia hanya karena demo approval berhasil. Pelatihan dapat dipakai menentukan kapabilitas dan izin mana yang dibuka perusahaan.

Tidak ada perubahan aplikasi/deployment dalam kegiatan telaah materi ini.
