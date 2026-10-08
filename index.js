const express = require("express");
const { google } = require("googleapis");
const { randomUUID } = require("node:crypto");
const store = require("./store");

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

function getCallbackUrl() {
  let url;
  try { url = new URL(PUBLIC_BASE_URL); } catch {
    throw new Error("Set PUBLIC_BASE_URL ke URL HTTPS deployment sebelum mengirim approval.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("PUBLIC_BASE_URL harus berupa origin HTTPS, contoh https://nama-project.vercel.app.");
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

const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/chat.bot"],
  ...(process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? { credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) }
    : {}),
});

const chat = google.chat({
  version: "v1",
  auth,
});

// ==============================
// HEALTH CHECK
// ==============================

app.get("/", (req, res) => {
  res.send("Google Chat Approval Bot is running");
});

// ==============================
// DEMO HTML
// ==============================

app.get("/approval-demo", async (req, res) => {
  const users = await store.listUsers();

  const options = users
    .map(
      (user) =>
        `<option value="${user.email}">
          ${user.displayName} - ${user.email}
        </option>`
    )
    .join("");

  res.send(`
<!DOCTYPE html>
<html>
<head>
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

    if (!approver) {
      return res.status(400).send(`
        User belum terdaftar.

        Silakan chat bot terlebih dahulu.
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

      createdAt: new Date(),
    });

    await chat.spaces.messages.create({
      parent: approver.dmSpace,

      requestBody: message,
    });

    res.send(`
      <h2>Approval terkirim ✅</h2>

      <p>ID: ${approvalId}</p>
      <p>Approver: ${approverEmail}</p>

      <a href="/approval-demo">
        Kembali
      </a>
    `);

  } catch (error) {

    console.error(error.response?.data || error);

    res.status(500).send(`
      Gagal mengirim approval.

      Cek terminal Node.
    `);
  }
});

// ==============================
// GOOGLE CHAT WEBHOOK
// ==============================

app.post("/google-chat", async (req, res) => {
  console.log("\n========== GOOGLE CHAT ==========");
  console.log(JSON.stringify(req.body, null, 2));
  console.log("=================================\n");

  const event = req.body;

  const chatEvent = event.chat;

  if (!chatEvent) {
    return res.status(400).json({
      error: "Invalid Chat event",
    });
  }

  // ==============================
  // AUTO REGISTER USER
  // ==============================

  const user = chatEvent.user;

  const space =
    chatEvent.space ||
    chatEvent.messagePayload?.space ||
    chatEvent.buttonClickedPayload?.space;

  if (
    user?.email &&
    space?.name &&
    space?.spaceType === "DIRECT_MESSAGE"
  ) {

    await store.setUser(user.email, {
      email: user.email,

      displayName:
        user.displayName || user.email,

      googleUser:
        user.name,

      dmSpace:
        space.name,
    });

    console.log(
      "REGISTERED:",
      user.email,
      space.name
    );
  }

  // ==============================
  // BUTTON CLICK
  // ==============================

  if (chatEvent.buttonClickedPayload) {
    return handleApprovalClick(event, res);
  }

  // ==============================
  // NORMAL MESSAGE
  // ==============================

  if (chatEvent.messagePayload) {

    const displayName =
      user?.displayName || "User";

    return res.json({
      hostAppDataAction: {
        chatDataAction: {
          createMessageAction: {
            message: {
              text:
                `Halo ${displayName} 👋\n\n` +
                `User Anda sudah terdaftar untuk menerima approval.`,
            },
          },
        },
      },
    });
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
                "Kirim pesan apa saja untuk melakukan registrasi.",
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
  console.error("Request failed:", error.message);
  res.status(500).json({ error: "Layanan gagal memproses request. Periksa konfigurasi dan log server." });
});

if (require.main === module && !process.env.VERCEL) app.listen(PORT, () => {

  console.log(
    `Server running: http://localhost:${PORT}`
  );

  console.log(
    `Approval demo: http://localhost:${PORT}/approval-demo`
  );

  console.log("PUBLIC_BASE_URL =", PUBLIC_BASE_URL);
});
module.exports = app;
module.exports.app = app;
module.exports.chat = chat;
module.exports.createApprovalMessage = createApprovalMessage;
module.exports.getCallbackUrl = getCallbackUrl;
