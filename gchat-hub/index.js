const express = require("express");
const { createGoogleTransport } = require("./google-transport");
const { createAuth } = require("./auth");
const { randomUUID, createHash } = require("node:crypto");

const { registerMonitoringPages, escape: escapeHtml } = require("./pages");

function createApp({env = process.env, store = require("./store"), chat = createGoogleTransport(env)} = {}) {
const app = express();
function clients() {
  let list=[];
  try { list=JSON.parse(env.INTEGRATION_CLIENTS_JSON || "[]"); } catch { throw Error("Invalid integration client configuration"); }
  if(!Array.isArray(list)) throw Error("Integration clients must be an array");
  return [...list.filter(c=>c.id!=="integration-gateway").map(c=>({...c,role:"application"})), {id:"integration-gateway",secret:env.GATEWAY_RELAY_SECRET,role:"gateway"}];
}
const serviceAuth=createAuth({secret:env.TOKEN_SECRET,issuer:"gchat-hub",audience:"gchat-hub-api",clients});
app.post("/auth/token", express.json({limit:"16kb"}), serviceAuth.login);

app.use(express.json({limit:"128kb"}));
app.use(express.urlencoded({ extended: true }));

const GATEWAY_PUBLIC_URL = env.GATEWAY_PUBLIC_URL;

function getCallbackUrl() {
  let url;
  try { url = new URL(GATEWAY_PUBLIC_URL); } catch {
    throw new Error("Set GATEWAY_PUBLIC_URL ke URL HTTPS deployment sebelum mengirim approval.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("GATEWAY_PUBLIC_URL harus berupa origin HTTPS, contoh https://nama-project.vercel.app.");
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

async function sendApproval(req, res) {
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
      if(req.serviceClient) return res.status(422).json({error:"Approver has not completed registration"});
      return res.status(400).send(`
        User belum terdaftar.

        Silakan daftar melalui /regist dan validasi NIK terlebih dahulu.
      `);
    }

    const approvalId = req.serviceClient
      ? "APR-" + createHash("sha256").update(JSON.stringify([req.serviceClient, req.body.requestId])).digest("hex").slice(0,32)
      : "APR-" + randomUUID();

    const message = createApprovalMessage({ approvalId, employeeName, type, date, reason });

    const approvalData = {
      id: approvalId,

      employeeName,
      type,
      date,
      reason,

      approverEmail,

      status: "PENDING",

      createdAt: new Date().toISOString(),
      deliveryStatus: "SENDING",
      clientId: req.serviceClient || "admin-demo",
      sourceRequestId: req.body.requestId || null,
      requestFingerprint: createHash("sha256").update(JSON.stringify([approverEmail, employeeName, type, date, reason || ""])).digest("hex"),
      syncStatus: "NOT_READY",
    };
    if (!await store.createApproval(approvalId, approvalData)) {
      const existing = await store.getApproval(approvalId);
      if (existing.requestFingerprint !== approvalData.requestFingerprint) return res.status(409).json({error:"Request ID already used for different data"});
      return res.json({id:existing.id,status:existing.status,deliveryStatus:existing.deliveryStatus,duplicate:true});
    }

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

    if (req.serviceClient) return res.status(201).json({id:approvalId,status:"PENDING",deliveryStatus:"SENT"});
    res.send(`
      <h2>Approval terkirim ✅</h2>

      <p>ID: ${approvalId}</p>
      <p>Approver: ${escapeHtml(approverEmail)}</p>

      <a href="/approval-demo">
        Kembali
      </a>
    `);

  } catch (error) {

    console.error("Approval delivery failed");

    if (req.serviceClient) return res.status(502).json({error:"Message delivery failed"});
    res.status(500).send(`
      Gagal mengirim approval.

      Cek terminal Node.
    `);
  }
}
app.post("/send-approval", sendApproval);

app.post("/api/approvals", serviceAuth.requireRole("application"), async(req,res)=>{
  const body=req.body || {};
  if (!["requestId","employeeName","type","date"].every(key=>typeof body[key]==="string" && body[key].trim() && body[key].length<=200) || (body.reason!==undefined && (typeof body.reason!=="string" || body.reason.length>2000)) || typeof body.approverNik!=="string" || !/^[0-9]{1,32}$/.test(body.approverNik)) return res.status(400).json({error:"requestId, approverNik, employeeName, type and date are required"});
  const approver=await store.getUserByNik(body.approverNik);
  if(!approver) return res.status(422).json({error:"Approver has not completed registration"});
  req.body={...body,approverEmail:approver.email};
  return sendApproval(req,res);
});
app.get("/api/approvals/:id",serviceAuth.requireRole("application"),async(req,res)=>{
  const approval=await store.getApproval(req.params.id);
  if(!approval || approval.clientId!==req.serviceClient) return res.status(404).json({error:"Approval not found"});
  res.json(approval);
});
app.get("/api/decisions",serviceAuth.requireRole("application"),async(req,res)=>{
  res.json({items:await store.listPendingDecisions(req.serviceClient)});
});
app.post("/api/decisions/:id/ack",serviceAuth.requireRole("application"),async(req,res)=>{
  const ok=await store.ackDecision(req.params.id,req.serviceClient);
  return ok?res.json({acknowledged:true}):res.status(404).json({error:"Decision not found"});
});

// ==============================
// GOOGLE CHAT WEBHOOK
// ==============================

app.post("/internal/google-chat", serviceAuth.requireRole("gateway"), async (req, res) => {
  console.log("\n========== GOOGLE CHAT ==========");
  console.log("Event:", req.body.chat?.appCommandPayload ? "APP_COMMAND" : req.body.chat?.buttonClickedPayload ? "BUTTON_CLICK" : "MESSAGE");
  console.log("=================================\n");

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
                    text:
                      approval.employeeName,
                  },
                },

                {
                  decoratedText: {
                    topLabel:
                      "Jenis",
                    text:
                      approval.type,
                  },
                },

                {
                  decoratedText: {
                    topLabel:
                      "Tanggal",
                    text:
                      approval.date,
                  },
                },

                {
                  decoratedText: {
                    topLabel:
                      "Diproses oleh",
                    text:
                      approval.approvedBy,
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
  console.error("Request failed");
  res.status(500).json({ error: "Layanan gagal memproses request. Periksa konfigurasi dan log server." });
});

return app;
}
const app = createApp();
if(require.main===module && !process.env.VERCEL) app.listen(Number(process.env.PORT || 3001),()=>console.log("GChat Hub listening"));
module.exports=app;
module.exports.createApp=createApp;
