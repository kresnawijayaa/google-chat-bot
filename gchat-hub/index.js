const express = require("express");
const { createDebug } = require("./debug");
const { createGoogleTransport } = require("./google-transport");
const { createAuth } = require("./auth");
const { registerApplicationApi } = require("./api");
const { randomUUID } = require("node:crypto");

const { registerMonitoringPages, escape: escapeHtml } = require("./pages");

function createApp({env = process.env, store = require("./store"), chat, debugSink} = {}) {
const app = express();
const debug = createDebug({env,service:"gchat-hub",sink:debugSink});
store = debug.wrapStore(store);
chat = chat || createGoogleTransport(env, fetch, debug);
app.use(debug.middleware);
const serviceAuth=createAuth({secret:env.BRIDGE_SECRET,issuer:"integration-gateway",audience:"gchat-hub-events",clients:()=>[{id:"integration-gateway",secret:env.BRIDGE_SECRET,role:"gateway"}],debug});

app.use(express.json({limit:"128kb"}));
app.use(express.urlencoded({ extended: true }));
app.use(debug.payload);

const GATEWAY_URL = env.GATEWAY_URL;

function getCallbackUrl() {
  let url;
  try { url = new URL(GATEWAY_URL); } catch {
    throw new Error("Set GATEWAY_URL ke URL HTTPS deployment sebelum mengirim approval.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("GATEWAY_URL harus berupa origin HTTPS, contoh https://nama-project.vercel.app.");
  }
  return url.origin + "/google-chat";
}

// ==============================
// DUMMY DATABASE
// ==============================

// State disimpan oleh store.js (Neon PostgreSQL pada Vercel).

// ==============================
// GOOGLE CHAT CLIENT
// ==============================

// ==============================
// HEALTH CHECK
// ==============================

app.get("/", (req, res) => {
  res.send("GChat Hub is running");
});

registerApplicationApi(app, {env, store, chat, createApprovalMessage, debug});
registerMonitoringPages(app, store, env);

// ==============================
// DEMO HTML
// ==============================

app.get("/approval-demo", async (req, res) => {
  const users = await store.listUsers();

  const options = users
    .map(
      (user) =>
        `<option value="${escapeHtml(user.email)}">
          ${escapeHtml(user.displayName)} - ${escapeHtml(user.email)}
        </option>`
    )
    .join("");

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Approval Demo</title>

  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f5f5f5;
      padding: 40px;
    }

    .card {
      max-width: 500px;
      margin: auto;
      background: white;
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 3px 15px rgba(0,0,0,.1);
    }

    input, select, textarea {
      width: 100%;
      padding: 10px;
      margin-top: 6px;
      margin-bottom: 16px;
      box-sizing: border-box;
    }

    button {
      width: 100%;
      padding: 12px;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
    }
  </style>
</head>

<body>

<div class="card">

<nav><a href="/users">Pengguna</a> · <a href="/approvals">Riwayat approval</a></nav>
<h2>Approval Simulation</h2>

<form method="POST" action="/send-approval">

<label>Approver</label>

<select name="approverEmail" required>
${options}
</select>

<label>Nama Pemohon</label>
<input
  name="employeeName"
  value="Budi Santoso"
  required
/>

<label>Jenis Pengajuan</label>
<input
  name="type"
  value="Cuti"
  required
/>

<label>Tanggal</label>
<input
  name="date"
  value="12 Oktober 2026"
  required
/>

<label>Alasan</label>

<textarea name="reason">Keperluan keluarga</textarea>

<button type="submit">
Kirim Approval
</button>

</form>

<br>

Registered users: ${users.length}

</div>

</body>
</html>
  `);
});

// ==============================
// SEND APPROVAL
// ==============================

app.post("/send-approval", async (req, res) => {
  try {
    const {
      approverEmail,
      employeeName,
      type,
      date,
      reason,
    } = req.body;

    const approver = await store.getUser(
      approverEmail
    );

    if (!approver?.nik) {
      return res.status(400).send(`
        User belum terdaftar.

        Silakan daftar melalui /regist dan validasi NIK terlebih dahulu.
      `);
    }

    const approvalId =
      "APR-" + randomUUID();

    const message = createApprovalMessage({ approvalId, employeeName, type, date, reason });

    await store.setApproval(approvalId, {
      id: approvalId,

      employeeName,
      type,
      date,
      reason,

      approverEmail,

      status: "PENDING",

      createdAt: new Date().toISOString(),
      deliveryStatus: "SENDING",
    });

    let sent;
    try {
      sent = await chat.spaces.messages.create({
        parent: approver.dmSpace,
        requestBody: message,
        messageId: "client-" + approvalId.toLowerCase(),
      });
    } catch (error) {
      await store.updateDelivery(approvalId, { deliveryStatus: "FAILED", deliveryUpdatedAt: new Date().toISOString() });
      throw error;
    }
    await store.updateDelivery(approvalId, {
      deliveryStatus: "SENT", sentAt: new Date().toISOString(),
      messageName: sent.data?.name || null,
    });

    res.send(`
      <h2>Approval terkirim ✅</h2>

      <p>ID: ${approvalId}</p>
      <p>Approver: ${escapeHtml(approverEmail)}</p>

      <a href="/approval-demo">
        Kembali
      </a>
    `);

  } catch (error) {

    debug.log("APPROVAL_ERROR", {error});
    console.error("Approval delivery failed");

    res.status(500).send(`
      Gagal mengirim approval.

      Cek terminal Node.
    `);
  }
});

// ==============================
// GOOGLE CHAT WEBHOOK
// ==============================

app.post("/internal/google-chat", serviceAuth.requireRole("gateway"), async (req, res) => {
  debug.log("CHAT_EVENT", {eventType:req.body.chat?.appCommandPayload ? "APP_COMMAND" : req.body.chat?.buttonClickedPayload ? "BUTTON_CLICK" : "MESSAGE"});

  const event = req.body;

  const chatEvent = event.chat;

  if (!chatEvent) {
    return res.status(400).json({
      error: "Invalid Chat event",
    });
  }

  const user = chatEvent.user;
  const payload = chatEvent.messagePayload || chatEvent.appCommandPayload;
  const space = chatEvent.space || payload?.space || chatEvent.buttonClickedPayload?.space;

  if (chatEvent.buttonClickedPayload) return handleApprovalClick(event, res);

  if (payload) {
    if (!user?.email || !space?.name || space.spaceType !== "DIRECT_MESSAGE") {
      return res.json(createTextResponse("Pendaftaran hanya melalui DM bot. Buka DM lalu kirim /regist."));
    }
    const email = user.email.trim().toLowerCase();
    const message = String(payload.message?.argumentText || payload.message?.text || "").trim();
    const commandId = chatEvent.appCommandPayload?.appCommandMetadata?.appCommandId;
    const isRegist = ["regist", "/regist"].includes(message.toLowerCase()) || (commandId !== undefined && String(commandId) === String(env.REGISTRATION_COMMAND_ID || "1"));
    const existing = await store.getUser(email);
    if (isRegist) {
      if (existing?.nik) return res.json(createTextResponse("Anda sudah terdaftar untuk menerima approval."));
      await store.beginRegistration(email, space.name);
      return res.json(createTextResponse("Silakan kirim NIK Anda sebagai pesan berikutnya. NIK harus sesuai akun Workspace Anda dan terdaftar dalam daftar yang diizinkan. Sesi berlaku 10 menit."));
    }
    if (chatEvent.appCommandPayload) return res.json(createTextResponse("Command tidak dikenal. Gunakan /regist untuk mendaftar."));
    if (await store.isAwaitingNik(email, space.name)) {
      if (!/^[0-9]{1,32}$/.test(message)) return res.json(createTextResponse("NIK harus berupa angka, maksimal 32 digit. Kirim NIK saja; pertahankan angka nol di depan."));
      const registered = await store.registerByNik(message, { email, displayName: user.displayName || email, googleUser: user.name, dmSpace: space.name });
      return res.json(createTextResponse(registered
        ? "Pendaftaran berhasil. Anda sudah terdaftar untuk menerima approval."
        : "Pendaftaran gagal. NIK dan akun Workspace tidak cocok atau belum diizinkan. Periksa NIK atau hubungi admin."));
    }
    return res.json(createTextResponse(existing?.nik
      ? "Anda sudah terdaftar untuk menerima approval."
      : "Untuk mendaftar, kirim /regist lalu masukkan NIK ketika diminta."));
  }

  // ==============================
  // ADDED TO SPACE
  // ==============================

  if (chatEvent.addedToSpacePayload) {

    return res.json({
      hostAppDataAction: {
        chatDataAction: {
          createMessageAction: {
            message: {
              text:
                "Bot Approval berhasil ditambahkan ✅\n\n" +
                "Kirim /regist melalui DM bot untuk melakukan registrasi.",
            },
          },
        },
      },
    });
  }

  res.json({});
});

// ==============================
// APPROVAL BUTTON HANDLER
// ==============================

async function handleApprovalClick(event, res) {
  const { approvalId, action } = event.commonEventObject?.parameters || {};
  if (!approvalId || !["approve", "decline"].includes(action)) {
    return res.json(createTextResponse("Aksi approval tidak valid."));
  }
  const result = await store.decide(approvalId, event.chat?.user?.email, action);
  const errors = {
    missing: "Approval tidak ditemukan.",
    forbidden: "Anda bukan approver untuk pengajuan ini.",
    decided: "Approval ini sudah " + result.approval?.status + ".",
  };
  if (result.error) return res.json(createTextResponse(errors[result.error]));
  return res.json({
    hostAppDataAction: { chatDataAction: { updateMessageAction: {
      message: createApprovalResultMessage(result.approval),
    } } },
  });
}

// ==============================
// CREATE APPROVAL CARD
// ==============================

function createApprovalMessage(data) {
  const callbackUrl = getCallbackUrl();

  return {

    text:
      `Approval ${data.type} - ${data.employeeName}`,

    cardsV2: [
      {
        cardId:
          `approval-${data.approvalId}`,

        card: {

          header: {
            title:
              "Permohonan Approval",
            subtitle:
              data.approvalId,
          },

          sections: [
            {
              widgets: [

                {
                  decoratedText: {
                    topLabel:
                      "Nama Pemohon",
                    text:
                      data.employeeName,
                  },
                },

                {
                  decoratedText: {
                    topLabel:
                      "Jenis Pengajuan",
                    text:
                      data.type,
                  },
                },

                {
                  decoratedText: {
                    topLabel:
                      "Tanggal",
                    text:
                      data.date,
                  },
                },

                {
                  textParagraph: {
                    text:
                      `<b>Alasan</b><br>` +
                      `${data.reason}`,
                  },
                },

                {
                  buttonList: {

                    buttons: [

                      {
                        text:
                          "Approve",

                        onClick: {
                          action: {

                            function:
                              callbackUrl,

                            parameters: [
                              {
                                key:
                                  "action",
                                value:
                                  "approve",
                              },
                              {
                                key:
                                  "approvalId",
                                value:
                                  data.approvalId,
                              },
                            ],
                          },
                        },
                      },

                      {
                        text:
                          "Decline",

                        onClick: {
                          action: {

                            function:
                              callbackUrl,

                            parameters: [
                              {
                                key:
                                  "action",
                                value:
                                  "decline",
                              },
                              {
                                key:
                                  "approvalId",
                                value:
                                  data.approvalId,
                              },
                            ],
                          },
                        },
                      },

                    ],
                  },
                },

              ],
            },
          ],
        },
      },
    ],
  };
}

// ==============================
// RESULT CARD
// ==============================

function createApprovalResultMessage(
  approval
) {

  const symbol =
    approval.status === "APPROVED"
      ? "✅"
      : "❌";

  return {

    text:
      `${symbol} ${approval.status}`,

    cardsV2: [
      {
        cardId:
          `approval-result-${approval.id}`,

        card: {

          header: {
            title:
              `${symbol} ${approval.status}`,
            subtitle:
              approval.id,
          },

          sections: [
            {
              widgets: [

                {
                  decoratedText: {
                    topLabel:
                      "Pemohon",
                    text: escapeHtml(approval.employeeName),
                  },
                },

                {
                  decoratedText: {
                    topLabel:
                      "Jenis",
                    text: escapeHtml(approval.type),
                  },
                },

                {
                  decoratedText: {
                    topLabel:
                      "Tanggal",
                    text: escapeHtml(approval.date),
                  },
                },

                {
                  decoratedText: {
                    topLabel:
                      "Diproses oleh",
                    text: escapeHtml(approval.approvedBy),
                  },
                },

              ],
            },
          ],
        },
      },
    ],
  };
}

// ==============================

function createTextResponse(text) {

  return {
    hostAppDataAction: {
      chatDataAction: {
        createMessageAction: {
          message: {
            text,
          },
        },
      },
    },
  };
}

// ==============================

app.use((error, req, res, next) => {
  debug.log("REQUEST_ERROR", {error});
  console.error("Request failed");
  res.status(500).json({ error: "Layanan gagal memproses request. Periksa konfigurasi dan log server." });
});

return app;
}
const app = createApp();
if(require.main===module && !process.env.VERCEL) app.listen(Number(process.env.PORT || 3001),()=>console.log("GChat Hub listening"));
module.exports=app;
module.exports.createApp=createApp;
