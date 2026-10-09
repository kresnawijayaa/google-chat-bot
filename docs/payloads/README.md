# Contoh Payload GChat

Semua JSON memakai data dummy dan placeholder credential. Payload request Google berisi subset field yang dipakai handler, bukan event lengkap. Kartu, respons handler dan data DB dibuat dari simulasi kode; response OAuth/message Google merupakan contoh minimal.

Lihat [dokumentasi lengkap](../dokumentasi-gchat.md) untuk endpoint, header, status dan alur. Timestamp berasal dari waktu fixture dibuat. Contoh approve/decline merupakan skenario alternatif.

| File | Keterangan |
| --- | --- |
| [01-command-request.json](01-command-request.json) | Google → gateway: command /regist |
| [02-command-response.json](02-command-response.json) | Respons bot meminta NIK |
| [03-nik-request.json](03-nik-request.json) | Google → gateway: input NIK |
| [04-registration-response.json](04-registration-response.json) | Respons pendaftaran berhasil |
| [05-login-request.json](05-login-request.json) | Hub → gateway: login |
| [06-login-response.json](06-login-response.json) | Gateway → hub: JWT login |
| [07-google-token-request.json](07-google-token-request.json) | Hub → gateway: assertion Google |
| [08-google-token-response.json](08-google-token-response.json) | Google → gateway → hub: contoh access token |
| [09-message-transport-request.json](09-message-transport-request.json) | Hub → gateway: envelope pengiriman + kartu lengkap |
| [10-google-message-body.json](10-google-message-body.json) | Gateway → Google: body pesan/kartu saja |
| [11-google-message-response.json](11-google-message-response.json) | Google → gateway → hub: respons pesan mock minimal |
| [12-approve-request.json](12-approve-request.json) | Google → gateway → hub: approve |
| [13-approve-response.json](13-approve-response.json) | Hub → gateway → Google: update kartu APPROVED |
| [14-decline-request.json](14-decline-request.json) | Google → gateway → hub: decline |
| [15-decline-response.json](15-decline-response.json) | Hub → gateway → Google: update kartu DECLINED |
| [16-already-decided-response.json](16-already-decided-response.json) | Respons klik ulang pada record diputuskan |
| [17-bot-user-data.json](17-bot-user-data.json) | Contoh bot_users.data |
| [18-approval-pending-data.json](18-approval-pending-data.json) | Contoh bot_approvals.data PENDING dengan SENT |
| [19-approval-approved-data.json](19-approval-approved-data.json) | Contoh bot_approvals.data APPROVED |
| [20-approval-declined-data.json](20-approval-declined-data.json) | Contoh bot_approvals.data DECLINED |
