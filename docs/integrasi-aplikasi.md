# Panduan Integrasi Aplikasi ke GChat Hub

Untuk developer program cuti, pengadaan, lembur atau aplikasi lain. API ini sudah tersedia dalam kode; aktif setelah pengelola hub mengisi APP_CLIENTS_JSON dan deploy.

Developer cukup menghubungi gchat-hub. Developer tidak memerlukan URL gateway, BRIDGE_SECRET, credential Google atau password admin.

## 1. Informasi yang diberikan pengelola hub

| Informasi | Contoh |
| --- | --- |
| Base URL hub | https://DOMAIN-HUB.vercel.app |
| client_id | program-cuti |
| client_secret | Nilai acak khusus program tersebut |
| NIK approver | Pegawai sudah /regist dan lolos validasi NIK |

Credential disimpan di server program sumber. Setiap program memakai client_id/secret berbeda. Browser pengguna tidak memanggil API menggunakan secret.

## 2. Mengaktifkan API di hub

Bagian ini untuk pengelola hub, bukan developer program pemanggil.

Tambahkan satu env pada project Vercel gchat-hub:

~~~text
APP_CLIENTS_JSON=[{"id":"program-cuti","secret":"SECRET_ACAK_MINIMAL_32_KARAKTER"},{"id":"program-lembur","secret":"SECRET_LAIN_MINIMAL_32_KARAKTER"}]
~~~

Ganti semua placeholder. Secret setiap program dibuat terpisah:

~~~powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
~~~

Salin JSON tanpa tanda petik pembungkus ke Value Vercel lalu redeploy hub. Tidak perlu env baru pada gateway atau schema SQL baru. Semua env hub lama tetap dipakai.

Untuk percobaan pertama, client program-cuti sudah disiapkan pada .env lokal hub yang tidak masuk Git. Salin nilai APP_CLIENTS_JSON dari sana ke Vercel. Pengelola memberikan secret client tersebut hanya kepada pemilik program-cuti.

Client ID: lowercase huruf/angka, underscore/hyphen, diawali huruf/angka, maksimal 80 karakter, tidak boleh duplikat. Secret minimal 32 karakter. Registry kosong/tidak valid membuat API merespons 503; demo/admin tetap tersedia.

Menghapus client dari registry lalu redeploy menolak token client itu. Mengganti secret login saja tidak mencabut JWT yang sudah terbit; token tersebut dapat tetap berlaku sampai 10 menit. JWT aplikasi ditandatangani dengan key turunan BRIDGE_SECRET hub dan audience tersendiri, bukan client_secret. Developer pemanggil tidak mendapatkan signing key.

## 3. Alur program sumber

~~~mermaid
sequenceDiagram
  participant Program as Program sumber
  participant Hub as GChat Hub
  participant Gateway
  participant Google as Google Chat
  Program->>Hub: POST /auth/token (credential aplikasi)
  Hub-->>Program: JWT aplikasi, 600 detik
  Program->>Hub: POST /api/approvals (NIK dan data pengajuan)
  Hub->>Gateway: Kirim lewat JWT gateway
  Gateway->>Google: Kartu approval
  Hub-->>Program: ID approval dan status pengiriman
  Google->>Gateway: Klik Approve/Decline
  Gateway->>Hub: Event terverifikasi dengan JWT relay
  loop Selama belum diputuskan
    Program->>Hub: GET /api/approvals/{id}
    Hub-->>Program: PENDING / APPROVED / DECLINED
  end
  Program->>Program: Terapkan hasil pada database program sendiri
~~~

Hub mencatat keputusan; aturan bisnis dan update database cuti tetap tugas program sumber. API versi ini menggunakan cek status, tanpa webhook atau ACK.

## 4. Login aplikasi

~~~http
POST /auth/token HTTP/1.1
Host: DOMAIN-HUB.vercel.app
Content-Type: application/json

{
  "client_id": "program-cuti",
  "client_secret": "<APP_SECRET>"
}
~~~

Respons HTTP 200:

~~~json
{
  "access_token": "<APP_JWT>",
  "token_type": "Bearer",
  "expires_in": 600
}
~~~

Token berlaku 10 menit. Cache di memori server dan login ulang menjelang habis. Bila API memberi 401, login ulang dan coba satu kali.

JWT ini hanya untuk API hub. Ia tidak dapat dipakai pada transport gateway atau endpoint relay /internal/google-chat. Tidak perlu Origin atau login Basic untuk API aplikasi.

## 5. Kirim approval berdasarkan NIK

~~~http
POST /api/approvals HTTP/1.1
Host: DOMAIN-HUB.vercel.app
Authorization: Bearer <APP_JWT>
Content-Type: application/json

{
  "requestId": "CUTI-2026-001",
  "approverNik": "00123456",
  "employeeName": "Budi Santoso",
  "type": "Cuti",
  "date": "12 Oktober 2026",
  "reason": "Keperluan keluarga"
}
~~~

| Field | Wajib | Batas dan arti |
| --- | --- | --- |
| requestId | Ya | String tidak kosong, maksimal 128 karakter; ID stabil dari program sumber |
| approverNik | Ya | String angka 1–32 digit; pertahankan nol depan |
| employeeName | Ya | String tidak kosong, maksimal 200 karakter |
| type | Ya | String tidak kosong, maksimal 100 karakter; judul/jenis pengajuan |
| date | Ya | String tidak kosong, maksimal 200 karakter; teks periode/tanggal |
| reason | Tidak | String maksimal 2.000 karakter, default kosong; detail/alasan |

Semua field adalah string. approverNik berupa angka JSON akan ditolak. Teks selain NIK ditrim; input yang melewati batas sebelum trim ditolak. Field ekstra diabaikan, tidak dapat memaksakan clientId, status atau approverEmail.

Approver dicari dari bot_users berdasarkan NIK, lalu DM/email diambil hub. NIK pada allowed_users saja belum cukup; atasan harus sudah registrasi bot.

Respone HTTP 201 untuk pengajuan baru:

~~~json
{
  "id": "APR-0123456789abcdef0123456789abcdef",
  "requestId": "CUTI-2026-001",
  "approverNik": "00123456",
  "approverEmail": "atasan@example.com",
  "status": "PENDING",
  "deliveryStatus": "SENT",
  "createdAt": "2026-10-09T07:00:00.000Z",
  "sentAt": "2026-10-09T07:00:01.000Z",
  "decidedAt": null,
  "decidedBy": null,
  "duplicate": false
}
~~~

ID/timestamp/email di contoh bersifat ilustratif. Simpan id dari respons, jangan menghitung ID sendiri.

SENT artinya Google menerima pengiriman; belum berarti pengguna membaca/menyetujui.

### Retry tanpa kartu ganda

Gunakan requestId yang sama untuk pengajuan dan payload yang sama ketika retry. Kunci unik berasal dari client_id + requestId; program lain boleh menggunakan requestId sama untuk pengajuannya sendiri.

- Payload sama: HTTP 200, ID lama, duplicate=true. Tidak mengirim kartu lagi.
- requestId sama tetapi data berubah: HTTP 409 dengan error dan id lama.
- Dua request bersamaan: hanya satu berhasil membuat record/mengirim; request lain membaca record itu.
- Saat request pertama masih berjalan, duplicate dapat menampilkan deliveryStatus SENDING.

Simpan ID pengajuan lokal sebelum request jaringan, sehingga requestId tetap dapat dipakai ulang jika respons hilang. Gunakan ruang penamaan seperti CUTI-2026-001 atau LEMBUR-2026-001; jangan ID acak baru untuk setiap retry.

Submit pada halaman demo admin tetap memiliki UUID baru tiap submit; aturan retry stabil di atas berlaku API.

### Pengiriman gagal/tidak terkonfirmasi

HTTP 502 contoh:

~~~json
{
  "error": "Approval delivery could not be confirmed",
  "id": "APR-0123456789abcdef0123456789abcdef",
  "requestId": "CUTI-2026-001",
  "approverNik": "00123456",
  "approverEmail": "atasan@example.com",
  "status": "PENDING",
  "deliveryStatus": "FAILED",
  "createdAt": "2026-10-09T07:00:00.000Z",
  "sentAt": null,
  "decidedAt": null,
  "decidedBy": null
}
~~~

Simpan id pada error jika tersedia dan cek status. Timeout dapat terjadi setelah Google menerima kartu. FAILED berarti pengiriman tidak terkonfirmasi, bukan bukti pasti tidak terkirim. Record SENDING dapat tersisa bila proses terhenti sebelum memperbarui DB.

Retry requestId sama tidak otomatis mengirim ulang FAILED/SENDING. Pengelola perlu memeriksa log/kartu terlebih dahulu. Jangan langsung mengganti requestId untuk mengatasi timeout karena dapat membuat kartu kedua.

## 6. Cek status approval

~~~http
GET /api/approvals/APR-0123456789abcdef0123456789abcdef HTTP/1.1
Host: DOMAIN-HUB.vercel.app
Authorization: Bearer <APP_JWT>
~~~

Respons HTTP 200 setelah disetujui:

~~~json
{
  "id": "APR-0123456789abcdef0123456789abcdef",
  "requestId": "CUTI-2026-001",
  "approverNik": "00123456",
  "approverEmail": "atasan@example.com",
  "status": "APPROVED",
  "deliveryStatus": "SENT",
  "createdAt": "2026-10-09T07:00:00.000Z",
  "sentAt": "2026-10-09T07:00:01.000Z",
  "decidedAt": "2026-10-09T07:05:00.000Z",
  "decidedBy": "atasan@example.com"
}
~~~

| status | Tindakan program sumber |
| --- | --- |
| PENDING | Tunggu, cek lagi melalui scheduler/server |
| APPROVED | Terapkan persetujuan sesuai aturan bisnis |
| DECLINED | Terapkan penolakan; label UI boleh Rejected |

deliveryStatus terpisah: SENDING, SENT atau FAILED. Jangan menjadikan FAILED sebagai keputusan ditolak.

Contoh polling sederhana: tiap 30–60 detik dari scheduler program sumber, berhenti setelah status final. Interval ini pilihan demo, bukan batas yang dipaksakan API. Pastikan update database program sumber idempotent karena hasil final dapat dibaca berkali-kali.

Aplikasi hanya bisa membaca record dengan clientId miliknya. ID tidak ada, approval demo admin, atau milik program lain menghasilkan HTTP 404 yang sama.

## 7. Contoh Node.js

Node 22+, kode server. Client siap disalin: [examples/hub-client.cjs](../examples/hub-client.cjs). Client mencache token, login ulang satu kali pada 401, dan membawa error.status/error.response untuk pemeriksaan.

Env program sumber, berbeda dari env hub:

~~~text
HUB_URL=https://DOMAIN-HUB.vercel.app
HUB_CLIENT_ID=program-cuti
HUB_CLIENT_SECRET=SECRET_KHUSUS_PROGRAM_CUTI
~~~

Pengiriman:

~~~javascript
const { createHubClient } = require("./hub-client.cjs");
const hub = createHubClient({
  baseUrl: process.env.HUB_URL,
  clientId: process.env.HUB_CLIENT_ID,
  clientSecret: process.env.HUB_CLIENT_SECRET,
});

async function sendLeaveApproval(leave) {
  const approval = await hub.sendApproval({
    requestId: leave.requestId,
    approverNik: leave.approverNik,
    employeeName: leave.employeeName,
    type: "Cuti",
    date: leave.dateText,
    reason: leave.reason,
  });
  // Simpan approval.id bersama pengajuan lokal.
  // duplicate=true bukan persetujuan; tetap baca status dan deliveryStatus.
  return approval;
}

async function readLeaveDecision(approvalId) {
  const approval = await hub.getApproval(approvalId);
  if (approval.status === "APPROVED") {
    // Update database cuti secara idempotent.
  } else if (approval.status === "DECLINED") {
    // Update database cuti sebagai ditolak.
  }
  return approval;
}
~~~

Penanganan gagal:

~~~javascript
try {
  const approval = await sendLeaveApproval(leave);
} catch (error) {
  if (error.status === 502 && error.response?.id) {
    // Simpan ID dan periksa status/log; jangan otomatis kirim ID baru.
  }
  // Catat metadata error seperlunya; jangan log credential/token.
}
~~~

Kode contoh tidak memperbarui database program-cuti secara otomatis; developer harus menambahkan penyimpanan lokal dan aturan bisnis sendiri.

## 8. Contoh PowerShell

~~~powershell
$hubUrl = "https://DOMAIN-HUB.vercel.app"
$secretInput = Read-Host "Secret aplikasi" -AsSecureString
$appSecret = [System.Net.NetworkCredential]::new("", $secretInput).Password
$loginBody = @{client_id="program-cuti"; client_secret=$appSecret} | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$hubUrl/auth/token" -ContentType "application/json" -Body $loginBody
$headers = @{Authorization="Bearer $($login.access_token)"}
$body = @{
  requestId="CUTI-2026-001"
  approverNik="00123456"
  employeeName="Budi Santoso"
  type="Cuti"
  date="12 Oktober 2026"
  reason="Keperluan keluarga"
} | ConvertTo-Json
$approval = Invoke-RestMethod -Method Post -Uri "$hubUrl/api/approvals" -Headers $headers -ContentType "application/json" -Body $body
Invoke-RestMethod -Uri "$hubUrl/api/approvals/$($approval.id)" -Headers $headers
~~~

Pengiriman ini membuat kartu nyata pada deployment yang sudah dikonfigurasi. Jalankan hanya untuk pengajuan uji yang diinginkan. NIK/email contoh harus diganti dengan pengguna yang sudah terdaftar.

## 9. Error API

| HTTP | Body/error | Penanganan |
| --- | --- | --- |
| 400 | Invalid approval payload + required | Perbaiki string, field wajib dan batas |
| 401 | Invalid client credentials | Cek credential aplikasi |
| 401 | Invalid or expired access token | Login ulang |
| 403 | Client does not have access to this endpoint | Client tidak lagi diizinkan |
| 404 | Approval not found | Cek ID dan aplikasi pemilik |
| 409 | Request ID already used for different data + id | Gunakan data awal atau ID pengajuan berbeda yang memang baru |
| 422 | Approver has not completed bot registration | Atasan /regist dengan NIK yang diizinkan |
| 502 | Approval delivery could not be confirmed + status/id | Simpan ID, cek status/log |
| 503 | Application API is not configured | Pengelola isi APP_CLIENTS_JSON dan BRIDGE_SECRET lalu redeploy |
| 500 | Error generik hub | Periksa log, gunakan requestId sama saat rekonsiliasi |

Error DB/config dapat terjadi sebelum id sempat dikembalikan. Coba ulang menggunakan requestId sama agar record yang sudah ada dapat ditemukan.

## 10. Checklist integrasi developer

1. Dapatkan base URL dan credential aplikasi dari pengelola hub.
2. Pastikan atasan sudah terdaftar, dengan NIK berupa string.
3. Simpan requestId stabil di database program.
4. Login dan kirim approval.
5. Simpan id hub, status dan deliveryStatus.
6. Cek status sampai APPROVED/DECLINED.
7. Terapkan hasil ke database program dengan operasi idempotent.
8. Tangani 401, 409, 422 serta pengiriman tidak pasti.

Untuk memahami jalur gateway/Google, baca [dokumentasi teknis](dokumentasi-gchat.md). Untuk debug, baca [debug-flow.md](debug-flow.md).
