const express = require("express");
const { GoogleAuth, OAuth2Client } = require("google-auth-library");
const { randomUUID, createHash, timingSafeEqual } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// Satu aplikasi, satu proses. Dua Map ini adalah "database" latihan.
function createApp({ env = process.env, sendMessage, verifyGoogleToken } = {}) {
  const app = express();
  const users = new Map();
  const approvals = new Map();
  const verifier = new OAuth2Client();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: "128kb" }));

  // 1. URL publik yang menerima event/klik dari Google Chat.
  function callbackUrl() {
    const url = new URL(env.PUBLIC_BASE_URL);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      throw Error("PUBLIC_BASE_URL harus origin HTTPS, tanpa path.");
    }
    return url.origin + "/google-chat";
  }

  // 2. Hanya halaman demo yang memakai login admin. Google memakai ID token.
  function requireAdmin(req, res, next) {
    res.set("Cache-Control", "no-store");
    if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12) return res.status(503).send("Isi ADMIN_PASSWORD minimal 12 karakter.");
    const digest = value => createHash("sha256").update(value).digest();
    const header = req.get("Authorization") || "";
    const supplied = header.startsWith("Basic ") ? header.slice(6) : "";
    const expected = Buffer.from("admin:" + env.ADMIN_PASSWORD).toString("base64");
    if (!timingSafeEqual(digest(supplied), digest(expected))) {
      res.set("WWW-Authenticate", 'Basic realm="Google Chat Training"');
      return res.status(401).send("Login dengan username admin.");
    }
    next();
  }

  // 3. Satu helper untuk membalas pesan melalui respons event Google.
  function textResponse(text) {
    return { hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text } } } } };
  }
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));

  // 4. Kartu yang dikirim ke approver. Parameter kembali saat tombol diklik.
  function approvalCard(approval) {
    return {
      text: approval.title,
      cardsV2: [{
        cardId: approval.id,
        card: {
          header: { title: "Permintaan approval" },
          sections: [{ widgets: [
            { textParagraph: { text: "<b>" + escape(approval.title) + "</b><br>" + escape(approval.detail) } },
            { buttonList: { buttons: ["approve", "reject"].map(action => ({
              text: action === "approve" ? "Approve" : "Reject",
              onClick: { action: {
                function: callbackUrl(),
                parameters: [{ key: "approvalId", value: approval.id }, { key: "action", value: action }],
              } },
            })) } },
          ] }],
        },
      }],
    };
  }

  // 5. Halaman HTML biasa. Tidak ada React, build frontend atau API tambahan.
  app.get("/", requireAdmin, (req, res) => {
    const options = [...users.values()].map(user =>
      '<option value="' + escape(user.email) + '">' + escape(user.name + " — " + user.email) + "</option>"
    ).join("");
    const userRows = [...users.values()].map(user =>
      "<tr><td>" + escape(user.name) + "</td><td>" + escape(user.email) + "</td></tr>"
    ).join("");
    const approvalRows = [...approvals.values()].reverse().map(item =>
      "<tr><td>" + escape(item.title) + "<small>" + escape(item.id) + "</small></td><td>" +
      escape(item.approverEmail) + "</td><td>" + escape(item.delivery) + '</td><td class="' +
      item.status + '">' + item.status + "</td></tr>"
    ).join("");
    const notices = { sent: "Approval terkirim. Buka DM Google Chat penerima.", failed: "Pengiriman tidak terkonfirmasi. Periksa log server dan DM penerima sebelum mengirim lagi." };
    const html = readFileSync(join(__dirname, "index.html"), "utf8");
    res.type("html").send(html
      .replace("{{notice}}", () => notices[req.query.notice] ? '<p class="notice" role="status">' + notices[req.query.notice] + "</p>" : "")
      .replace("{{options}}", () => options || '<option value="">Belum ada pengguna. Kirim /daftar ke bot.</option>')
      .replace("{{disabled}}", () => users.size ? "" : "disabled")
      .replace("{{userRows}}", () => userRows || '<tr><td colspan="2">Belum ada pengguna terdaftar.</td></tr>')
      .replace("{{approvalRows}}", () => approvalRows || '<tr><td colspan="4">Belum ada pengajuan.</td></tr>'));
  });

  // 6. Submit form -> simpan PENDING -> kirim langsung ke Google Chat API.
  app.post("/send-approval", requireAdmin, async (req, res) => {
    let origin;
    try { origin = new URL(req.get("Origin")); } catch {}
    if (!origin || origin.host !== req.get("Host")) return res.status(403).send("Origin form tidak sesuai.");
    const { approverEmail, title, detail } = req.body;
    const user = users.get(approverEmail);
    if (!user || typeof title !== "string" || !title.trim() || title.length > 150 ||
        typeof detail !== "string" || !detail.trim() || detail.length > 2000) {
      return res.status(400).send("Pilih pengguna terdaftar dan isi judul serta detail.");
    }
    callbackUrl(); // Validasi URL sebelum membuat record.
    const approval = { id: randomUUID(), approverEmail, title: title.trim(), detail: detail.trim(), status: "PENDING", delivery: "SENDING" };
    approvals.set(approval.id, approval);
    try {
      const message = approvalCard(approval);
      if (sendMessage) await sendMessage(user.space, message);
      else {
        const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}");
        if (!credentials.private_key || !credentials.client_email) throw Error("Isi JSON service account Google.");
        const auth = new GoogleAuth({
          credentials,
          scopes: ["https://www.googleapis.com/auth/chat.bot"],
        });
        const client = await auth.getClient(); // Library mengurus access token Google.
        await client.request({
          method: "POST", url: "https://chat.googleapis.com/v1/" + user.space + "/messages",
          data: message, timeout: 10000,
        });
      }
      approval.delivery = "SENT";
      console.log("KIRIM", approval.id, approverEmail);
      res.redirect(303, "/?notice=sent");
    } catch (error) {
      approval.delivery = "FAILED"; // Timeout tidak selalu berarti kartu belum diterima.
      console.error("Gagal kirim approval:", error.code || error.name);
      res.redirect(303, "/?notice=failed");
    }
  });

  // 7. Endpoint tunggal untuk /daftar dan klik Approve/Reject.
  app.post("/google-chat", async (req, res) => {
    if (!env.GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL || !env.PUBLIC_BASE_URL) return res.status(503).json({ error: "Isi URL publik dan email add-on." });
    try {
      const header = req.get("Authorization") || "";
      if (!header.startsWith("Bearer ")) return res.sendStatus(401);
      const token = header.slice(7);
      const claims = verifyGoogleToken ? await verifyGoogleToken(token) :
        (await verifier.verifyIdToken({ idToken: token, audience: callbackUrl() })).getPayload();
      if (claims.email_verified !== true || claims.email !== env.GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL) return res.sendStatus(403);
    } catch { return res.sendStatus(401); }

    const event = req.body;
    const chat = event.chat;
    if (!chat) return res.status(400).json({ error: "Gunakan event Google Workspace add-on." });
    const email = String(chat.user?.email || "").trim().toLowerCase();

    // A. Klik tombol: cek pengajuan, approver dan status, lalu ubah sekali saja.
    if (chat.buttonClickedPayload) {
      const { approvalId, action } = event.commonEventObject?.parameters || {};
      const approval = approvals.get(approvalId);
      if (!["approve", "reject"].includes(action)) return res.json(textResponse("Aksi tidak valid."));
      if (!approval) return res.json(textResponse("Pengajuan tidak ditemukan. Mungkin server sudah direstart."));
      if (email !== approval.approverEmail) return res.json(textResponse("Anda bukan approver pengajuan ini."));
      if (approval.status !== "PENDING") return res.json(textResponse("Pengajuan sudah " + approval.status + "."));
      approval.status = action === "approve" ? "APPROVED" : "REJECTED";
      console.log("KEPUTUSAN", approval.id, approval.status);
      return res.json({ hostAppDataAction: { chatDataAction: { updateMessageAction: { message: {
        text: approval.title + " — " + approval.status,
        cardsV2: [{ cardId: approval.id, card: {
          header: { title: approval.status },
          sections: [{ widgets: [{ textParagraph: { text: escape(approval.title) + "<br>Diproses oleh " + escape(email) } }] }],
        } }],
      } } } } });
    }

    // B. /daftar: ambil email dan ruang DM dari identitas Google, tanpa input NIK.
    const payload = chat.appCommandPayload || chat.messagePayload;
    const space = chat.space || payload?.space;
    const text = String(payload?.message?.argumentText || payload?.message?.text || "").trim().toLowerCase();
    const commandId = chat.appCommandPayload?.appCommandMetadata?.appCommandId;
    if (text === "/daftar" || text === "daftar" || String(commandId) === "1") {
      if (!email || space?.spaceType !== "DIRECT_MESSAGE" || !/^spaces\/[A-Za-z0-9_-]+$/.test(space?.name || "")) {
        return res.json(textResponse("Kirim /daftar melalui DM bot."));
      }
      users.set(email, { email, name: chat.user.displayName || email, space: space.name });
      console.log("DAFTAR", email, space.name);
      return res.json(textResponse("Pendaftaran berhasil. Anda sudah bisa menerima approval."));
    }
    return res.json(textResponse("Kirim /daftar melalui DM bot untuk menerima approval."));
  });

  app.use((error, req, res, next) => {
    console.error("Request gagal:", error.name);
    res.status(error.status === 400 ? 400 : 500).send("Request gagal. Periksa konfigurasi dan log server.");
  });
  return app;
}

if (require.main === module) {
  createApp().listen(Number(process.env.PORT || 3003), "127.0.0.1", () =>
    console.log("Buka http://localhost:" + (process.env.PORT || 3003) + " — username: admin"));
}
module.exports = { createApp };
