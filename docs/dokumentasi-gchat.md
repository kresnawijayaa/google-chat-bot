# Dokumentasi GChat Hub dan Integration Gateway

Versi: 9 Oktober 2026. Dokumen ini mengikuti demo dua layanan dan mode debug yang ada dalam repository. Domain, email, NIK, credential dan ID contoh merupakan data dummy.

Contoh event Google berisi subset field yang digunakan handler, bukan seluruh event Google. Struktur kartu, respons registrasi/keputusan, dan data tersimpan dihasilkan melalui simulasi handler saat ini dengan database in-memory serta pengiriman mock. Respons OAuth/Google messages adalah contoh minimal, bukan respons Google nyata.

## Daftar isi

1. [Arsitektur](#1-arsitektur)
2. [Autentikasi](#2-autentikasi)
3. [Endpoint](#3-endpoint)
4. [Registrasi](#4-registrasi)
5. [Kirim approval](#5-kirim-approval)
6. [Klik tombol](#6-klik-tombol)
7. [Admin](#7-admin)
8. [Database dan status](#8-database-dan-status)
9. [Env dan deployment](#9-env-dan-deployment)
10. [Log dan troubleshooting](#10-log-dan-troubleshooting)
11. [Uji endpoint](#11-uji-endpoint)
12. [Cakupan dan referensi](#12-cakupan-dan-referensi)

## 1. Arsitektur

| Komponen | Tanggung jawab |
| --- | --- |
| gchat-hub | Demo/admin, validasi NIK, registrasi DM, kartu approval, keputusan, akses Neon dan private key Google |
| integration-gateway | Login/token hub, transport Google, verifikasi request Google dan relay ke hub |
| Neon | Daftar izin, sesi registrasi, pengguna dan approval |
| Google Chat | Menampilkan kartu, mengirim event, menerapkan respons pembaruan kartu |
| program-cuti | Program lama, belum dihubungkan ke hub pada tahap ini |

Pengajuan saat ini berasal dari halaman demo hub. Gateway tidak mengatur approver, keputusan atau aturan cuti, dan tidak mempunyai database bisnis.

Notasi contoh: HUB=https://hub.example.com dan GATEWAY=https://gateway.example.com. Ganti dengan domain Production Vercel sebenarnya.

~~~mermaid
sequenceDiagram
  actor Admin
  participant Hub as GChat Hub
  participant DB as Neon
  participant GW as Integration Gateway
  participant Google as Google OAuth / Chat
  Admin->>Hub: POST /send-approval (Basic admin)
  Hub->>DB: Cari approver, simpan PENDING/SENDING
  opt Token gateway belum tersedia
    Hub->>GW: POST /auth/token (client + secret)
    GW-->>Hub: JWT gateway (600 detik)
  end
  opt Access token Google belum tersedia
    Hub->>GW: POST /api/google/token (JWT gateway + assertion)
    GW->>Google: Tukar assertion ke OAuth
    Google-->>Hub: Access token melalui gateway
  end
  Hub->>GW: POST /api/google/messages (JWT gateway)
  GW->>Google: messages.create (Google access token)
  Google-->>Hub: Hasil melalui gateway
  Hub->>DB: Catat SENT dan nama pesan
  Google->>GW: Callback klik (Google ID token)
  GW->>GW: Verifikasi token Google
  GW->>Hub: POST /internal/google-chat (JWT relay)
  Hub->>DB: Keputusan atomik
  Hub-->>Google: updateMessageAction melalui gateway
~~~

Registrasi mengikuti Google → gateway → hub → Neon. Balasan registrasi dan pembaruan kartu dikembalikan melalui respons HTTP callback, tanpa pengiriman pesan API baru.

## 2. Autentikasi

| Credential/token | Dibuat oleh | Dipakai untuk | Masa berlaku |
| --- | --- | --- | --- |
| ADMIN_PASSWORD | Pengelola | Basic login admin hub | Sampai diganti |
| BRIDGE_SECRET | Pengelola, nilai acak | Login hub dan signature JWT kedua layanan | Sampai diganti |
| JWT aplikasi | Hub setelah login client aplikasi | Program sumber → API hub | 600 detik |
| JWT gateway | Gateway setelah login | Hub → transport gateway | 600 detik |
| Assertion Google | Hub, private key JSON | Ditukar dengan Google access token | exp 3.600 detik setelah dibuat |
| Google access token | Google OAuth | Gateway → Google Chat API | expires_in Google |
| Google ID token | Google add-on | Google → callback gateway | exp Google |
| JWT relay | Gateway | Gateway → endpoint internal hub | 60 detik |
| Token konfirmasi hapus | Hub, HMAC ADMIN_PASSWORD | Form hapus pengguna | 15 menit |

BRIDGE_SECRET minimal 32 karakter dan persis sama pada kedua layanan. Secret adalah kunci server; token adalah bukti akses sementara. JWT ditandatangani, bukan dienkripsi: claims dapat dibaca.

Private key Google hanya berada di hub. Gateway menerima assertion yang sudah ditandatangani dan access token. Tidak ada inject cookie atau login browser otomatis.

Demo menggunakan satu secret. Audience/sub/role membedakan pemakaian JWT, tetapi pemegang secret dapat menandatangani kedua jenis token; ini belum pemisahan kewenangan antarpemegang kunci.

### JWT gateway

Decoded claims ilustratif, bukan token yang bisa digunakan:

~~~json
{
  "role": "hub",
  "iss": "integration-gateway",
  "aud": "integration-gateway-api",
  "sub": "gchat-hub",
  "iat": 1791507600,
  "exp": 1791508200
}
~~~

Gateway mengecek algoritma HS256, signature, issuer, audience, expiry, client dan role.

### JWT relay

~~~json
{
  "role": "gateway",
  "iss": "integration-gateway",
  "aud": "gchat-hub-events",
  "sub": "integration-gateway",
  "iat": 1791507600,
  "exp": 1791507660
}
~~~

Gateway membuat token relay langsung setelah request Google lolos, tanpa login ke hub. Hub hanya menerima token sesuai kontrak relay.

### Google ID token

OAuth2Client.verifyIdToken memeriksa signature/issuer, expiry dan audience PUBLIC_URL + /google-chat. Kode juga memeriksa email_verified=true dan email cocok dengan GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL. [Validasi request Google](https://developers.google.com/workspace/add-ons/guides/alternate-runtimes#validate_json_requests).

Email token adalah identitas add-on. Email pengguna yang mengklik adalah chat.user.email pada body Google yang telah terautentikasi. Keduanya berbeda.

### Admin

HTTP Basic menggunakan ADMIN_USERNAME (default admin) dan ADMIN_PASSWORD minimal 12 karakter. Password admin terpisah dari secret/token gateway.

## 3. Endpoint

### Hub

| Method/path | Autentikasi | Hasil |
| --- | --- | --- |
| GET / | Publik | Teks GChat Hub is running |
| GET /approval-demo | Basic admin | Form HTML |
| POST /send-approval | Basic admin + Origin host sama | HTML hasil pengiriman |
| GET /users | Basic admin | HTML daftar pengguna; q opsional |
| GET /users/delete?email=... | Basic admin | HTML konfirmasi |
| POST /users/delete | Basic admin + token konfirmasi | Redirect 303 |
| GET /approvals | Basic admin | HTML riwayat/filter/paginasi |
| POST /internal/google-chat | Bearer JWT relay | JSON respons event |
| POST /auth/token | client_id/client_secret aplikasi | JWT aplikasi |
| POST /api/approvals | Bearer JWT aplikasi | JSON pengajuan baru/duplikat |
| GET /api/approvals/:id | Bearer JWT aplikasi | JSON status milik aplikasi |

### Gateway

| Method/path | Autentikasi | Hasil |
| --- | --- | --- |
| GET / | Publik | JSON service/status |
| GET /profile-picture-bot.jpeg | Publik, route statis Vercel | Gambar |
| POST /auth/token | client_id dan client_secret pada body | JWT gateway |
| POST /api/google/token | Bearer JWT gateway | Hasil OAuth |
| POST /api/google/messages | Bearer JWT gateway | Hasil messages.create |
| POST /google-chat | Bearer Google ID token | Respons event dari hub |

Login tidak membutuhkan Bearer tetapi membutuhkan credential valid. JWT transport gateway tidak diterima pada endpoint internal hub.

API aplikasi kini tersedia: login, kirim dan cek status per ID. Panduan: [integrasi-aplikasi.md](integrasi-aplikasi.md). Program sumber melakukan polling sendiri; belum ada ACK/webhook. Halaman admin tetap HTML.

JSON request dibatasi 128 KB. Error parsing/ukuran memakai handler error saat ini, bukan kontrak response 413 khusus.

## 4. Registrasi

### Daftar NIK yang diizinkan

Schema: [gchat-hub/db/schema.sql](../gchat-hub/db/schema.sql). Database lama yang sudah lengkap tidak perlu dibuat baru.

Contoh Neon SQL Editor:

~~~sql
INSERT INTO allowed_users (nik, email, display_name)
VALUES ('00123456', 'atasan@example.com', 'Atasan Demo')
ON CONFLICT (nik) DO UPDATE
SET email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    enabled = TRUE;
~~~

NIK adalah teks angka 1–32 digit, mempertahankan nol depan. Email lowercase/trim dan unik. allowed_users adalah daftar izin, belum registrasi DM.

### Command /regist

Google mengirim:

~~~http
POST /google-chat HTTP/1.1
Host: gateway.example.com
Authorization: Bearer <GOOGLE_ID_TOKEN>
Content-Type: application/json
~~~

~~~json
{
  "chat": {
    "user": {
      "email": "atasan@example.com",
      "name": "users/123456",
      "displayName": "Atasan Demo"
    },
    "space": {
      "name": "spaces/DMDEMO",
      "spaceType": "DIRECT_MESSAGE"
    },
    "appCommandPayload": {
      "appCommandMetadata": {
        "appCommandId": 1
      },
      "message": {
        "text": "/regist"
      }
    }
  }
}
~~~

Gateway memverifikasi Google lalu meneruskan body sama:

~~~http
POST /internal/google-chat HTTP/1.1
Host: hub.example.com
Authorization: Bearer <RELAY_JWT>
Content-Type: application/json
~~~

Hub memastikan DM, email dan ruang tersedia, membuat sesi input NIK 10 menit. Respons HTTP 200:

~~~json
{
  "hostAppDataAction": {
    "chatDataAction": {
      "createMessageAction": {
        "message": {
          "text": "Silakan kirim NIK Anda sebagai pesan berikutnya. NIK harus sesuai akun Workspace Anda dan terdaftar dalam daftar yang diizinkan. Sesi berlaku 10 menit."
        }
      }
    }
  }
}
~~~

Command ID default 1; dapat diubah dengan REGISTRATION_COMMAND_ID. Teks regist atau /regist pada messagePayload juga dikenali. Pesan halo tidak otomatis mendaftarkan pengguna.

### Input NIK

~~~json
{
  "chat": {
    "user": {
      "email": "atasan@example.com",
      "name": "users/123456",
      "displayName": "Atasan Demo"
    },
    "space": {
      "name": "spaces/DMDEMO",
      "spaceType": "DIRECT_MESSAGE"
    },
    "messagePayload": {
      "message": {
        "text": "00123456"
      }
    }
  }
}
~~~

Hub mengecek format, sesi belum habis, ruang DM sama, kecocokan NIK-email dan enabled=true. Registrasi bot_users dan konsumsi sesi terjadi dalam satu statement SQL.

Respons sukses HTTP 200:

~~~json
{
  "hostAppDataAction": {
    "chatDataAction": {
      "createMessageAction": {
        "message": {
          "text": "Pendaftaran berhasil. Anda sudah terdaftar untuk menerima approval."
        }
      }
    }
  }
}
~~~

Data bot_users.data:

~~~json
{
  "email": "atasan@example.com",
  "displayName": "Atasan Demo",
  "googleUser": "users/123456",
  "dmSpace": "spaces/DMDEMO",
  "nik": "00123456",
  "registeredAt": "2026-10-09T07:35:15.608Z",
  "lastSeenAt": "2026-10-09T07:35:15.608Z"
}
~~~

Nama daftar izin dipakai jika tersedia. registeredAt adalah waktu registrasi awal. lastSeenAt saat ini diperbarui saat registrasi berhasil, bukan setiap interaksi bot.

### Hasil validasi lain

Semua hasil bisnis ini HTTP 200 dengan wrapper createMessageAction.message.text yang sama:

| Kondisi | Pesan |
| --- | --- |
| Sudah punya NIK | Anda sudah terdaftar untuk menerima approval. |
| Bukan DM | Pendaftaran hanya melalui DM bot. Buka DM lalu kirim /regist. |
| Format NIK salah | NIK harus berupa angka, maksimal 32 digit. Kirim NIK saja; pertahankan angka nol di depan. |
| Tidak cocok/tidak diizinkan | Pendaftaran gagal. NIK dan akun Workspace tidak cocok atau belum diizinkan. Periksa NIK atau hubungi admin. |
| Tidak ada sesi, termasuk habis | Untuk mendaftar, kirim /regist lalu masukkan NIK ketika diminta. |
| Command lain | Command tidak dikenal. Gunakan /regist untuk mendaftar. |

Validasi NIK gagal tidak menghabiskan sesi. Autentikasi Google gagal ditolak gateway sebelum proses registrasi.

addedToSpacePayload dibalas petunjuk /regist tanpa mendaftarkan pengguna. Event lain yang tidak ditangani mengembalikan JSON kosong.

## 5. Kirim approval

### Form admin → hub

Form browser menggunakan URL-encoded:

~~~http
POST /send-approval HTTP/1.1
Host: hub.example.com
Authorization: Basic <BASE64_USERNAME_COLON_PASSWORD>
Origin: https://hub.example.com
Content-Type: application/x-www-form-urlencoded

approverEmail=atasan%40example.com&employeeName=Budi+Santoso&type=Cuti&date=12+Oktober+2026&reason=Keperluan+keluarga
~~~

| Field | Fungsi |
| --- | --- |
| approverEmail | Email bot_users yang memiliki NIK |
| employeeName | Nama pemohon |
| type | Jenis pengajuan |
| date | Teks tanggal |
| reason | Alasan |

Browser mewajibkan approver, nama, jenis dan tanggal. Server memeriksa approver mempunyai NIK; belum memvalidasi menyeluruh format/panjang seluruh field bisnis.

Hub membuat APR-<UUID>, kartu dan record PENDING/SENDING sebelum pengiriman.

### Login hub → gateway

POST GATEWAY/auth/token, Content-Type application/json:

~~~json
{
  "client_id": "gchat-hub",
  "client_secret": "<BRIDGE_SECRET>"
}
~~~

Respons HTTP 200:

~~~json
{
  "access_token": "<GATEWAY_JWT>",
  "token_type": "Bearer",
  "expires_in": 600
}
~~~

client_secret adalah BRIDGE_SECRET. Hub mencache JWT di memori instance sampai 30 detik sebelum habis. Cold start/instance lain dapat login lagi. Endpoint transport yang memberi 401 memicu login ulang dan satu kali retry.

### Hub membuat assertion Google

Claims ditandatangani RS256 dengan private key JSON hub:

~~~json
{
  "scope": "https://www.googleapis.com/auth/chat.bot",
  "iss": "sender@example.iam.gserviceaccount.com",
  "aud": "https://oauth2.googleapis.com/token",
  "iat": 1791507600,
  "exp": 1791511200
}
~~~

Header JWT memakai kid jika private_key_id tersedia. POST GATEWAY/api/google/token, Bearer <GATEWAY_JWT>:

~~~json
{
  "assertion": "<SIGNED_GOOGLE_ASSERTION>"
}
~~~

Gateway memanggil URL OAuth tetap:

~~~http
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=<SIGNED_GOOGLE_ASSERTION>
~~~

Respons Google diteruskan HTTP 200; contoh:

~~~json
{
  "access_token": "<GOOGLE_ACCESS_TOKEN>",
  "token_type": "Bearer",
  "expires_in": 3600
}
~~~

expires_in berasal dari Google; 3600 hanya contoh. Cache hub memakai buffer 60 detik. [OAuth service account Google](https://developers.google.com/identity/protocols/oauth2/service-account).

### Hub → gateway: payload kartu

~~~http
POST /api/google/messages HTTP/1.1
Host: gateway.example.com
Authorization: Bearer <GATEWAY_JWT>
Content-Type: application/json
~~~

~~~json
{
  "parent": "spaces/DMDEMO",
  "message": {
    "text": "Approval Cuti - Budi Santoso",
    "cardsV2": [
      {
        "cardId": "approval-APR-00000000-0000-4000-8000-000000000001",
        "card": {
          "header": {
            "title": "Permohonan Approval",
            "subtitle": "APR-00000000-0000-4000-8000-000000000001"
          },
          "sections": [
            {
              "widgets": [
                {
                  "decoratedText": {
                    "topLabel": "Nama Pemohon",
                    "text": "Budi Santoso"
                  }
                },
                {
                  "decoratedText": {
                    "topLabel": "Jenis Pengajuan",
                    "text": "Cuti"
                  }
                },
                {
                  "decoratedText": {
                    "topLabel": "Tanggal",
                    "text": "12 Oktober 2026"
                  }
                },
                {
                  "textParagraph": {
                    "text": "<b>Alasan</b><br>Keperluan keluarga"
                  }
                },
                {
                  "buttonList": {
                    "buttons": [
                      {
                        "text": "Approve",
                        "onClick": {
                          "action": {
                            "function": "https://gateway.example.com/google-chat",
                            "parameters": [
                              {
                                "key": "action",
                                "value": "approve"
                              },
                              {
                                "key": "approvalId",
                                "value": "APR-00000000-0000-4000-8000-000000000001"
                              }
                            ]
                          }
                        }
                      },
                      {
                        "text": "Decline",
                        "onClick": {
                          "action": {
                            "function": "https://gateway.example.com/google-chat",
                            "parameters": [
                              {
                                "key": "action",
                                "value": "decline"
                              },
                              {
                                "key": "approvalId",
                                "value": "APR-00000000-0000-4000-8000-000000000001"
                              }
                            ]
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      }
    ]
  },
  "messageId": "client-apr-00000000-0000-4000-8000-000000000001",
  "googleAccessToken": "<GOOGLE_ACCESS_TOKEN>"
}
~~~

| Field | Keterangan |
| --- | --- |
| parent | bot_users.dmSpace; spaces/[A-Za-z0-9_-]+ |
| message | Objek pesan; Google memvalidasi struktur lanjut |
| messageId | Opsional gateway, diisi demo; client- diikuti 1–56 karakter lowercase angka/hyphen |
| googleAccessToken | Token Google; berbeda dari JWT gateway di header |

### Gateway → Google

~~~http
POST https://chat.googleapis.com/v1/spaces/DMDEMO/messages?messageId=client-apr-00000000-0000-4000-8000-000000000001
Authorization: Bearer <GOOGLE_ACCESS_TOKEN>
Content-Type: application/json
~~~

Body hanya isi field message. Salinan lengkap: [10-google-message-body.json](payloads/10-google-message-body.json).

Tombol memuat onClick.action.function=GATEWAY/google-chat serta approvalId/action. Google mengirim callback, bukan browser atasan melakukan login gateway.

Respons minimal Google diteruskan gateway ke hub sebagai HTTP 200:

~~~json
{
  "name": "spaces/DMDEMO/messages/client-demo"
}
~~~

Nama pesan contoh berasal dari mock, bukan resource nyata. Field Google lainnya dapat tersedia.

Bila Google memberi 409 dan messageId tersedia, gateway mencoba GET pesan dengan ID sama. Ini tidak membuat form idempotent: submit form baru membuat ID approval baru.

### Hub menyimpan hasil

Sukses: deliveryStatus SENT, sentAt dan messageName. Browser menerima HTML HTTP 200:

~~~html
<h2>Approval terkirim ✅</h2>
<p>ID: APR-00000000-0000-4000-8000-000000000001</p>
<p>Approver: atasan@example.com</p>
<a href="/approval-demo">Kembali</a>
~~~

SENT berarti Google menerima pengiriman, bukan pesan sudah dibaca.

Kegagalan request pengiriman memicu upaya mencatat FAILED/deliveryUpdatedAt dan HTML 500. Error sebelum record dibuat bisa tidak meninggalkan record. Error sesudah Google menerima pesan tetapi sebelum update DB dapat meninggalkan SENDING walaupun kartu terkirim.

Neon dan Google tidak berada dalam satu transaksi; belum ada retry otomatis seluruh kegagalan.

## 6. Klik tombol

### Approve

Google → POST GATEWAY/google-chat dengan Bearer <GOOGLE_ID_TOKEN>:

~~~json
{
  "commonEventObject": {
    "parameters": {
      "approvalId": "APR-00000000-0000-4000-8000-000000000001",
      "action": "approve"
    }
  },
  "chat": {
    "user": {
      "email": "atasan@example.com",
      "name": "users/123456",
      "displayName": "Atasan Demo"
    },
    "space": {
      "name": "spaces/DMDEMO",
      "spaceType": "DIRECT_MESSAGE"
    },
    "buttonClickedPayload": {}
  }
}
~~~

Gateway memverifikasi Google, membuat JWT relay 60 detik lalu meneruskan body sama ke hub. Hub mengecek action, approvalId, record, kecocokan email approver dan status PENDING.

~~~sql
UPDATE bot_approvals
SET status = $3, data = data || $4::jsonb
WHERE id = $1
  AND approver_email = $2
  AND status = 'PENDING'
RETURNING data;
~~~

Status kolom dan JSON diperbarui bersama. Pemeriksaan atomik PENDING mencegah dua keputusan berhasil.

Respons HTTP 200 hub → gateway → Google:

~~~json
{
  "hostAppDataAction": {
    "chatDataAction": {
      "updateMessageAction": {
        "message": {
          "text": "✅ APPROVED",
          "cardsV2": [
            {
              "cardId": "approval-result-APR-00000000-0000-4000-8000-000000000001",
              "card": {
                "header": {
                  "title": "✅ APPROVED",
                  "subtitle": "APR-00000000-0000-4000-8000-000000000001"
                },
                "sections": [
                  {
                    "widgets": [
                      {
                        "decoratedText": {
                          "topLabel": "Pemohon",
                          "text": "Budi Santoso"
                        }
                      },
                      {
                        "decoratedText": {
                          "topLabel": "Jenis",
                          "text": "Cuti"
                        }
                      },
                      {
                        "decoratedText": {
                          "topLabel": "Tanggal",
                          "text": "12 Oktober 2026"
                        }
                      },
                      {
                        "decoratedText": {
                          "topLabel": "Diproses oleh",
                          "text": "atasan@example.com"
                        }
                      }
                    ]
                  }
                ]
              }
            }
          ]
        }
      }
    }
  }
}
~~~

Google menerapkan updateMessageAction. Kartu hasil tidak menampilkan tombol. Handler tidak perlu meminta access token atau memanggil API pengiriman pesan lagi.

### Decline

~~~json
{
  "commonEventObject": {
    "parameters": {
      "approvalId": "APR-00000000-0000-4000-8000-000000000001",
      "action": "decline"
    }
  },
  "chat": {
    "user": {
      "email": "atasan@example.com",
      "name": "users/123456",
      "displayName": "Atasan Demo"
    },
    "space": {
      "name": "spaces/DMDEMO",
      "spaceType": "DIRECT_MESSAGE"
    },
    "buttonClickedPayload": {}
  }
}
~~~

Respons lengkap: [15-decline-response.json](payloads/15-decline-response.json). Status database DECLINED, label admin Rejected.

Contoh approve/decline adalah skenario alternatif; bukan mengubah approval sama dari APPROVED menjadi DECLINED.

### Klik ulang/validasi gagal

~~~json
{
  "hostAppDataAction": {
    "chatDataAction": {
      "createMessageAction": {
        "message": {
          "text": "Approval ini sudah APPROVED."
        }
      }
    }
  }
}
~~~

HTTP tetap 200 dengan pesan penjelasan, tanpa mengubah keputusan.

| Kondisi | Pesan |
| --- | --- |
| Aksi/ID tidak valid | Aksi approval tidak valid. |
| Record tidak ada | Approval tidak ditemukan. |
| Email bukan approver | Anda bukan approver untuk pengajuan ini. |
| Sudah diputuskan | Approval ini sudah APPROVED. atau DECLINED. |

Jika DB berhasil tetapi respons Google gagal, keputusan tetap tersimpan walaupun kartu belum diperbarui. Belum ada sinkronisasi ulang kartu otomatis.

## 7. Admin

GET /users?q=Atasan mencari nama/email dan menampilkan NIK, DM serta waktu. Hasil HTML. Daftar izin allowed_users belum memiliki halaman CRUD; kelola melalui database.

Riwayat:

~~~http
GET /approvals?q=Budi&status=APPROVED&approver=atasan%40example.com&page=1
Authorization: Basic <ADMIN_BASIC>
~~~

| Query | Fungsi |
| --- | --- |
| q | Cari ID, email, nama pemohon atau jenis |
| status | PENDING, APPROVED, DECLINED; nilai lain tanpa filter |
| approver | Email approver cocok persis |
| page | Halaman, disesuaikan rentang hasil |

Hasil HTML, 25 pengajuan per halaman, terbaru dahulu, waktu WIB. Pengiriman dan keputusan ditampilkan terpisah.

Hapus pengguna:

1. GET /users/delete?email=... menampilkan konfirmasi.
2. Hub membuat expires (milidetik epoch) dan HMAC 15 menit.
3. Form mengirim:

~~~http
POST /users/delete
Authorization: Basic <ADMIN_BASIC>
Content-Type: application/x-www-form-urlencoded

email=atasan%40example.com&expires=<EPOCH_MILLISECONDS>&token=<HMAC_HEX_FROM_CONFIRMATION_FORM>
~~~

Token berasal dari form konfirmasi, bukan JWT gateway. Sukses HTTP 303, Location /users?notice=deleted; record sudah hilang memberi notice=missing. Token invalid memberi HTML 403; GET pengguna tidak ada memberi HTML 404.

Penghapusan hanya bot_users. allowed_users dan bot_approvals tetap ada. Pengguna dapat registrasi ulang; approval lama tetap tersedia.

| HTTP admin | Kondisi |
| --- | --- |
| 401 | Basic salah/hilang; Login admin diperlukan. |
| 503 | ADMIN_PASSWORD belum ada/kurang dari 12 karakter |
| 403 | Origin kirim hilang/host berbeda; Invalid form origin |
| 400 | Approver belum terdaftar dengan NIK |
| 500 | Pengiriman/operasi server gagal |

Origin form kirim diperiksa terhadap host termasuk port dan protokol http/https valid. Form hapus memakai HMAC konfirmasi.

## 8. Database dan status

| Tabel | Kolom | Fungsi |
| --- | --- | --- |
| allowed_users | nik PK, email UNIQUE, display_name, enabled | Daftar izin |
| bot_registration_sessions | email PK, dm_space, expires_at | Sesi NIK |
| bot_users | email PK, data JSONB | Registrasi |
| bot_approvals | id PK, approver_email, status, data JSONB | Pengajuan/keputusan |

Index unik NIK pada bot_users.data->>'nik'. CHECK approval menjaga id, approverEmail dan status JSON sesuai kolom.

### Pending setelah terkirim

~~~json
{
  "id": "APR-00000000-0000-4000-8000-000000000001",
  "employeeName": "Budi Santoso",
  "type": "Cuti",
  "date": "12 Oktober 2026",
  "reason": "Keperluan keluarga",
  "approverEmail": "atasan@example.com",
  "status": "DECLINED",
  "createdAt": "2026-10-09T07:35:15.613Z",
  "deliveryStatus": "SENT",
  "sentAt": "2026-10-09T07:35:15.613Z",
  "messageName": "spaces/DMDEMO/messages/client-demo",
  "updatedAt": "2026-10-09T07:35:15.620Z",
  "approvedBy": "atasan@example.com"
}
~~~

### Setelah approve

~~~json
{
  "id": "APR-00000000-0000-4000-8000-000000000001",
  "employeeName": "Budi Santoso",
  "type": "Cuti",
  "date": "12 Oktober 2026",
  "reason": "Keperluan keluarga",
  "approverEmail": "atasan@example.com",
  "status": "APPROVED",
  "createdAt": "2026-10-09T07:35:15.613Z",
  "deliveryStatus": "SENT",
  "sentAt": "2026-10-09T07:35:15.613Z",
  "messageName": "spaces/DMDEMO/messages/client-demo",
  "updatedAt": "2026-10-09T07:35:15.615Z",
  "approvedBy": "atasan@example.com"
}
~~~

Setelah decline: [20-approval-declined-data.json](payloads/20-approval-declined-data.json). Field approvedBy dipakai untuk pengambil keputusan approve maupun decline.

Timestamp disimpan ISO UTC, ditampilkan WIB. Timestamp fixture berasal dari waktu simulasi dokumentasi.

| Kelompok | Nilai | Makna |
| --- | --- | --- |
| Keputusan | PENDING | Belum diputuskan |
| Keputusan | APPROVED | Disetujui |
| Keputusan | DECLINED | Ditolak |
| Pengiriman | SENDING | Belum terkonfirmasi |
| Pengiriman | SENT | Diterima Google |
| Pengiriman | FAILED | Upaya pengiriman gagal |

FAILED bukan DECLINED. Record lama bisa belum mempunyai metadata pengiriman.

Lokal tanpa DATABASE_URL memakai Map dan hilang saat restart. Vercel wajib DATABASE_URL; Neon berbagi state antar-instance. Gateway tidak mempunyai database.

## 9. Env dan deployment

| Hub env | Isi |
| --- | --- |
| GATEWAY_URL | Origin HTTPS gateway tanpa path |
| BRIDGE_SECRET | Secret bersama minimal 32 karakter |
| DATABASE_URL | Connection string Neon |
| GOOGLE_SERVICE_ACCOUNT_JSON | Satu JSON lengkap pengirim bot |
| ADMIN_PASSWORD | Password admin minimal 12 karakter |
| APP_CLIENTS_JSON | Opsional, registry credential aplikasi lain; [] menonaktifkan API |
| DEBUG_FLOW | true untuk debug; default nonaktif |
| ADMIN_USERNAME | Opsional, default admin |
| REGISTRATION_COMMAND_ID | Opsional, default 1 |
| PORT | Lokal, default 3001 |

| Gateway env | Isi |
| --- | --- |
| HUB_URL | Origin hub tanpa path |
| PUBLIC_URL | Origin HTTPS gateway |
| BRIDGE_SECRET | Sama dengan hub |
| GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL | Identitas service account add-on |
| DEBUG_FLOW | true untuk debug |
| PORT | Lokal, default 3002 |

PUBLIC_URL dan GATEWAY_URL menunjuk gateway sama. Callback audience/action menjadi domain + /google-chat. Identitas add-on berbeda fungsi dari client_email JSON pengirim. [Konfigurasi identitas Google](https://developers.google.com/workspace/add-ons/chat/convert).

Vercel:

1. Import repo sama menjadi dua project.
2. Root Directory masing-masing gchat-hub dan integration-gateway.
3. Isi env serta domain Production.
4. Redeploy keduanya.
5. Endpoint dan trigger Google Chat: GATEWAY/google-chat, /regist ID 1.
6. Avatar GATEWAY/profile-picture-bot.jpeg.
7. Coba registrasi → HUB/approval-demo → klik → HUB/approvals.

Panduan: [setup-vercel.md](setup-vercel.md). .env lokal tidak ikut Git/tidak otomatis menjadi env Vercel. Jangan salin tanda petik pembungkus .env ke Value Vercel.

Production domain perlu dapat diakses Google/antarlayanan tanpa login Vercel; autentikasi aplikasi tetap berlaku. Root vercel.json menonaktifkan Git deployment project lama yang menunjuk root; project baru memakai config subfolder.

## 10. Log dan troubleshooting

DEBUG_FLOW=true pada kedua project, redeploy, buka Logs hub/gateway. Log JSON berisi time, service, requestId, step dan data.

requestId dibawa lewat X-Request-ID antarservice dan muncul pada response debug. Klik Google adalah request baru; gunakan approvalId untuk menghubungkannya dengan pengiriman. requestId aplikasi berbeda dari request ID Vercel.

Contoh ilustratif:

~~~json
{
  "time": "2026-10-09T07:00:00.000Z",
  "service": "gchat-hub",
  "requestId": "trace-example-0001",
  "step": "FETCH_SEND",
  "method": "POST",
  "url": "https://gateway.example.com/auth/token",
  "body": { "client_id": "gchat-hub", "client_secret": "[REDACTED]" }
}
~~~

| Step | Makna |
| --- | --- |
| HTTP_IN / PAYLOAD_IN | Request/payload masuk |
| LOGIN_SUCCESS / SERVICE_TOKEN_VERIFIED | Login/verifikasi JWT berhasil |
| GATEWAY_TOKEN_CACHE / GOOGLE_TOKEN_CACHE | Cache token |
| GATEWAY_LOGIN_RETRY | 401 memicu login ulang |
| GOOGLE_ASSERTION_CREATE | Membuat assertion |
| FETCH_SEND / FETCH_RESULT | Endpoint, payload, output, status/durasi |
| GOOGLE_ID_TOKEN_VERIFIED / REJECTED | Verifikasi asal Google |
| RELAY_TOKEN_CREATE / CHAT_EVENT | Penerusan dan tipe event |
| STORE_CALL / STORE_RESULT | Operasi data dan input/output |
| HTTP_OUT / HTTP_ABORTED | Respons/koneksi putus |
| FETCH_ERROR / STORE_ERROR / RELAY_ERROR / REQUEST_ERROR / APPROVAL_ERROR / APPLICATION_APPROVAL_ERROR | Kegagalan |

Store log bukan dump SQL/traffic Neon. HTTP internal library verifikasi Google tidak dilog; hasil verifikasinya dicatat.

Secret, password, auth/cookie, token, assertion, private key dan URL DB disamarkan. Email/NIK/pengajuan terlihat. Nilai asli tetap diteruskan program.

Batas preview: string 12.000 karakter, respons fetch 20.000 byte, objek/array 100 item, kedalaman 15. Log besar bisa terpotong. Log di terminal/Vercel, bukan Neon atau halaman publik.

### Error gateway

Body JSON {"error":"pesan"}.

| HTTP | Pesan |
| --- | --- |
| 503 | Google request verification is not configured |
| 401 | Google ID token required / Invalid Google ID token |
| 403 | Unexpected Google add-on identity |
| 502 | Notification hub unavailable |
| 401 | Invalid client credentials |
| 503 | Service authentication is not configured |
| 401 | Invalid or expired access token |
| 403 | Client does not have access to this endpoint |
| 400 | JWT assertion required (bukan string atau >16.000 karakter) |
| 400 | Invalid message transport request / Invalid message ID |
| 502 | Google token exchange failed / Google token exchange unavailable |
| 502 | Google Chat rejected the message / Google Chat unavailable |

Hub internal tanpa chat memberi 400 {"error":"Invalid Chat event"}. Respons hub non-2xx diubah gateway menjadi 502 Notification hub unavailable.

| Gejala | Periksa |
| --- | --- |
| Login 401 | BRIDGE_SECRET sama, client_id gchat-hub |
| Callback 401 | Google ID token, audience PUBLIC_URL/google-chat, expiry/signature |
| Callback 403 | Identitas add-on, bukan otomatis email JSON pengirim |
| Callback 502 | HUB_URL, log hub, akses Production |
| OAuth/message 502 | Body/status upstream Google pada FETCH_RESULT |
| Registrasi gagal | NIK-email, enabled, sesi 10 menit, ruang DM |
| Keputusan tidak berubah | Email approver dan status PENDING |
| Env tidak berpengaruh | Redeploy environment yang benar |

Timeout login 8 detik; hub→gateway 15 detik; gateway→Google 10 detik; gateway→hub 15 detik. Redirect upstream tidak diikuti. Cache token per instance, bukan Redis/Neon.

Panduan: [debug-flow.md](debug-flow.md). Matikan DEBUG_FLOW=false lalu redeploy saat log rinci tidak diperlukan.

## 11. Uji endpoint

Health PowerShell:

~~~powershell
$hubUrl = "https://DOMAIN-HUB.vercel.app"
$gatewayUrl = "https://DOMAIN-GATEWAY.vercel.app"
Invoke-RestMethod -Uri "$hubUrl/"
Invoke-RestMethod -Uri "$gatewayUrl/"
~~~

Health hanya menunjukkan aplikasi merespons, bukan verifikasi DB/Google lengkap.

Login tanpa mencetak token:

~~~powershell
$secretInput = Read-Host "BRIDGE_SECRET" -AsSecureString
$bridgeValue = [System.Net.NetworkCredential]::new("", $secretInput).Password
$loginBody = @{ client_id = "gchat-hub"; client_secret = $bridgeValue } | ConvertTo-Json
$loginResult = Invoke-RestMethod -Method Post -Uri "$gatewayUrl/auth/token" -ContentType "application/json" -Body $loginBody
$loginResult.token_type
$loginResult.expires_in
~~~

Output Bearer dan 600; token berada pada $loginResult.access_token.

Validasi transport menggunakan JWT benar tetapi body kosong:

~~~powershell
$headers = @{ Authorization = "Bearer $($loginResult.access_token)" }
Invoke-RestMethod -Method Post -Uri "$gatewayUrl/api/google/token" -Headers $headers -ContentType "application/json" -Body "{}"
~~~

HTTP 400 JWT assertion required berarti autentikasi lolos, validasi body menolak. HTTP 401 berarti token bermasalah. PowerShell mengeluarkan exception untuk HTTP error.

Template callback JSON tidak bisa dipanggil memakai JWT gateway pada /google-chat; callback publik memerlukan Google ID token. Uji nyata melalui Google Chat, simulasi melalui npm test. Form approval paling mudah diuji melalui browser agar Basic/Origin sesuai.

## 12. Cakupan dan referensi

Fitur: registrasi NIK, kirim melalui gateway/token, keputusan atomik, admin pengguna/hapus, riwayat dan debug.

Belum: pemasangan client pada program-cuti/sistem kantor, scheduler polling terpusat/ACK/webhook, antrian, pencabutan JWT per sesi, rate limiting terdistribusi, retry dan sinkronisasi ulang seluruh kegagalan. Ini cakupan kode, bukan hasil audit production/pentest.

~~~powershell
npm install --prefix gchat-hub
npm install --prefix integration-gateway
npm test
~~~

Sepuluh tes mencakup penyamaran credential, debug nonaktif, PostgreSQL PGlite, registrasi, alur gateway/Google mock, API aplikasi, kepemilikan record, retry idempotent, kegagalan pengiriman dan keputusan. Tidak ada pengiriman Google nyata dalam tes.

Kode:

- [Hub](../gchat-hub/index.js), [admin](../gchat-hub/pages.js), [store](../gchat-hub/store.js).
- [Transport Google](../gchat-hub/google-transport.js), [client gateway](../gchat-hub/service-client.js), [JWT](../gchat-hub/auth.js).
- [Gateway](../integration-gateway/index.js), [logger](../gchat-hub/debug.js), [schema](../gchat-hub/db/schema.sql).

Referensi resmi:

- [Event Google add-on](https://developers.google.com/workspace/add-ons/concepts/event-objects).
- [Antarmuka Google Chat add-on](https://developers.google.com/workspace/add-ons/chat/build).
- [Verifikasi callback](https://developers.google.com/workspace/add-ons/guides/alternate-runtimes#validate_json_requests).
- [OAuth service account](https://developers.google.com/identity/protocols/oauth2/service-account).
- [Identitas add-on](https://developers.google.com/workspace/add-ons/chat/convert).

Dokumentasi mengikuti kode repository; tidak seluruh kemampuan Google pada referensi diimplementasikan.

## API aplikasi sumber

[Kontrak lengkap, payload, error dan contoh kode](integrasi-aplikasi.md). Endpoint API menggunakan JWT aplikasi terpisah dari token transport gateway/relay. Metadata clientId, sourceRequestId, requestFingerprint dan approverNik disimpan pada JSON approval tanpa perubahan schema SQL. requestId stabil membuat retry tidak mengirim kartu ganda. ID API dibentuk dari client + requestId; ID demo form tetap UUID.
