# Melihat proses development

Aktifkan pada kedua project Vercel (gchat-hub dan integration-gateway):

DEBUG_FLOW=true

Settings → Environment Variables → pilih Production → Save → Redeploy kedua project. .env lokal sudah diaktifkan; saat dijalankan lokal output ada di terminal.

## Membaca log di Vercel

1. Buka project gchat-hub → Logs dan project integration-gateway → Logs di tab berbeda.
2. Pilih environment Production dan waktu terbaru.
3. Kirim approval dari halaman demo, atau lakukan /regist dan klik Approve/Decline di Google Chat.
4. Buka detail log. Setiap baris debug berupa JSON berisi service, requestId, step, payload/hasil, serta status dan durasi HTTP.
5. Cari nilai requestId yang sama pada kedua project untuk mengikuti satu request. ID ini adalah ID aplikasi, berbeda dari ID request bawaan Vercel. Klik tombol Google merupakan request baru, sehingga gunakan approvalId dalam payload untuk menghubungkannya dengan pengiriman kartu sebelumnya.

## Arti step

| Step | Artinya |
| --- | --- |
| HTTP_IN / PAYLOAD_IN | Request diterima: metode, endpoint, dan payload setelah parsing |
| LOGIN_SUCCESS | Login hub ke gateway berhasil; identitas client dan masa berlaku token |
| SERVICE_TOKEN_VERIFIED | Token hub atau token relay gateway lolos verifikasi |
| GATEWAY_TOKEN_CACHE / GOOGLE_TOKEN_CACHE | Token yang masih berlaku dipakai kembali; tidak login ulang |
| GOOGLE_ASSERTION_CREATE | Hub membuat assertion pengiriman Google memakai service account |
| FETCH_SEND | Request keluar: URL tujuan, metode, header dan payload |
| FETCH_RESULT | Respons tujuan: status HTTP, durasi dan body |
| GOOGLE_ID_TOKEN_VERIFIED / REJECTED | Hasil verifikasi request yang berasal dari Google |
| RELAY_TOKEN_CREATE | Gateway membuat token sementara untuk meneruskan event ke hub |
| STORE_CALL / STORE_RESULT | Operasi data pengguna/approval beserta input dan hasil; bukan dump SQL mentah |
| HTTP_OUT | Respons aplikasi yang dikembalikan ke pemanggil |
| FETCH_ERROR / STORE_ERROR / RELAY_ERROR / REQUEST_ERROR / APPROVAL_ERROR | Kegagalan dan pesan penyebab yang disamarkan |

## Contoh alur kirim

Hub: HTTP_IN → PAYLOAD_IN → STORE_CALL getUser → STORE_RESULT → STORE_CALL setApproval → FETCH_SEND /auth/token → FETCH_RESULT → FETCH_SEND /api/google/token → FETCH_RESULT → FETCH_SEND /api/google/messages → FETCH_RESULT → STORE_CALL updateDelivery → HTTP_OUT.

Gateway: login → LOGIN_SUCCESS, kemudian SERVICE_TOKEN_VERIFIED → FETCH_SEND ke Google → FETCH_RESULT → HTTP_OUT. Token yang masih valid dipakai dari cache, jadi login tidak selalu muncul.

## Data log

Payload kartu, data registrasi, email/NIK, ID approval dan status hasil terlihat saat debug aktif. Secret, password, Authorization/cookie, access token, assertion, private key dan token konfirmasi disamarkan menjadi [REDACTED]. Nilai token sebenarnya tetap diteruskan oleh program; penyamaran hanya pada log.

Preview dibatasi: string 12.000 karakter, respons fetch 20.000 byte, array/objek 100 item dan kedalaman 15. Log besar bisa terpotong. Verifikasi ID token Google melalui library tidak mencatat HTTP internal pengambilan sertifikat; hasil verifikasinya dicatat.

Log tidak disimpan di Neon dan tidak tersedia melalui endpoint publik. Matikan debug dengan DEBUG_FLOW=false lalu redeploy saat selesai mencoba.

Referensi Vercel: https://vercel.com/docs/logs/runtime

API aplikasi juga menghasilkan LOGIN_SUCCESS, SERVICE_TOKEN_VERIFIED, STORE_CALL/RESULT dan FETCH_SEND/RESULT. Kegagalan pengiriman dari API dicatat sebagai APPLICATION_APPROVAL_ERROR dengan id/clientId.
