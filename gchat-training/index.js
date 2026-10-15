const express = require("express");
const { createStore } = require("./store");
const { GoogleAuth, OAuth2Client } = require("google-auth-library");
const { randomUUID, createHash, timingSafeEqual } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// Satu aplikasi; Neon di Vercel atau memori untuk latihan lokal.
function createApp({ env = process.env, sendMessage, verifyGoogleToken, store = createStore(env.DATABASE_URL) } = {}) {
  const app = express();
  app.use((req, res, next) => {
    if (env.VERCEL && !env.DATABASE_URL) return res.status(503).send("Isi DATABASE_URL Neon di Vercel lalu redeploy.");
    next();
  });
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

  // Kartu sambutan: pengguna cukup menekan Daftar, tanpa menghafal command.
  function registrationMenu(user, success = false) {
    const text = success ? "Pendaftaran berhasil. Anda sudah bisa menerima approval." :
      user ? "Anda sudah terdaftar untuk menerima approval." : "Klik Daftar untuk menerima approval melalui bot ini.";
    const widgets = [{ textParagraph: { text: escape(text) + (user ? "<br>" + escape(user.email) : "") } }];
    if (!user) widgets.push({ buttonList: { buttons: [{
      text: "Daftar",
      onClick: { action: {
        function: callbackUrl(), parameters: [{ key: "action", value: "register" }],
      } },
    }] } });
    return { hostAppDataAction: { chatDataAction: { createMessageAction: { message: {
      fallbackText: text, cardsV2: [{ cardId: "registration", card: {
        header: { title: user ? "Akun terdaftar" : "Selamat datang" },
        sections: [{ widgets }],
      } }],
    } } } } };
  }

  // 4. Kartu yang dikirim ke approver. Parameter kembali saat tombol diklik.
  function approvalCard(approval) {
    return {
      fallbackText: approval.title,
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
  app.get("/", requireAdmin, async (req, res) => {
    const allowed = new Set(await store.listAllowedEmails());
    const users = (await store.list("user")).filter(user => allowed.has(user.email));
    const approvals = await store.list("approval");
    const options = users.map(user =>
      '<option value="' + escape(user.email) + '">' + escape(user.name + " — " + user.email) + "</option>"
    ).join("");
    const userRows = users.map(user =>
      "<tr><td>" + escape(user.name) + "</td><td>" + escape(user.email) + "</td></tr>"
    ).join("");
    const approvalRows = approvals.sort((a,b) => (b.createdAt || "").localeCompare(a.createdAt || "")).map(item =>
      "<tr><td>" + escape(item.title) + "<small>" + escape(item.id) + "</small></td><td>" +
      escape(item.approverEmail) + "</td><td>" + escape(item.delivery) + '</td><td class="' +
      item.status + '">' + item.status + "</td></tr>"
    ).join("");
    const notices = { sent: "Approval terkirim. Buka DM Google Chat penerima.", failed: "Pengiriman tidak terkonfirmasi. Periksa log server dan DM penerima sebelum mengirim lagi." };
    const html = readFileSync(join(__dirname, "index.html"), "utf8");
    res.type("html").send(html
      .replace("{{storageNote}}", () => env.DATABASE_URL ? "Data latihan disimpan di Neon dan tetap ada setelah restart." : "Data latihan sementara; kosong kembali saat server direstart.")
      .replace("{{notice}}", () => notices[req.query.notice] ? '<p class="notice" role="status">' + notices[req.query.notice] + "</p>" : "")
      .replace("{{options}}", () => options || '<option value="">Belum ada pengguna. Klik Daftar di DM bot.</option>')
      .replace("{{disabled}}", () => users.length ? "" : "disabled")
      .replace("{{allowedRows}}", () => [...allowed].sort().map(email => "<tr><td>" + escape(email) + "</td></tr>").join("") || '<tr><td>Belum ada email yang diizinkan.</td></tr>')
      .replace("{{userRows}}", () => userRows || '<tr><td colspan="2">Belum ada pengguna terdaftar.</td></tr>')
      .replace("{{approvalRows}}", () => approvalRows || '<tr><td colspan="4">Belum ada pengajuan.</td></tr>'));
  });

  // 6. Submit form -> simpan PENDING -> kirim langsung ke Google Chat API.
  app.post("/send-approval", requireAdmin, async (req, res) => {
    let origin;
    try { origin = new URL(req.get("Origin")); } catch {}
    if (!origin || origin.host !== req.get("Host")) return res.status(403).send("Origin form tidak sesuai.");
    const { approverEmail, title, detail } = req.body;
    if (!await store.isAllowed(approverEmail)) return res.status(403).send("Email approver belum diizinkan oleh admin.");
    const user = await store.get("user", approverEmail);
    if (!user || typeof title !== "string" || !title.trim() || title.length > 150 ||
        typeof detail !== "string" || !detail.trim() || detail.length > 2000) {
      return res.status(400).send("Pilih pengguna terdaftar dan isi judul serta detail.");
    }
    callbackUrl(); // Validasi URL sebelum membuat record.
    const approval = { id: randomUUID(), approverEmail, title: title.trim(), detail: detail.trim(), status: "PENDING", delivery: "SENDING", createdAt: new Date().toISOString() };
    await store.set("approval", approval.id, approval);
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
      await store.patch("approval", approval.id, { delivery: "SENT" });
      console.log("KIRIM", approval.id, approverEmail);
      res.redirect(303, "/?notice=sent");
    } catch (error) {
      await store.patch("approval", approval.id, { delivery: "FAILED" }); // Timeout tidak selalu berarti kartu belum diterima.
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
    // Email berasal dari event Google terverifikasi, bukan input/parameter tombol.
    if (!await store.isAllowed(email)) return res.json(textResponse("Akun Google Chat Anda belum diizinkan menggunakan bot ini. Hubungi admin untuk menambahkan email Anda."));

    const payload = chat.appCommandPayload || chat.messagePayload;
    const space = chat.space || payload?.space || chat.buttonClickedPayload?.space ||
      chat.buttonClickedPayload?.message?.space || chat.addedToSpacePayload?.space;
    const action = event.commonEventObject?.parameters?.action;
    const text = String(payload?.message?.argumentText || payload?.message?.text || "").trim().toLowerCase();
    const commandId = chat.appCommandPayload?.appCommandMetadata?.appCommandId;

    // Daftar melalui tombol atau command lama; identitas tetap dari Google.
    if ((chat.buttonClickedPayload && action === "register") ||
        text === "/daftar" || text === "daftar" || String(commandId) === "1") {
      if (!email || space?.spaceType !== "DIRECT_MESSAGE" || !/^spaces\/[A-Za-z0-9_-]+$/.test(space?.name || "")) {
        return res.json(textResponse("Pendaftaran hanya melalui DM bot. Buka DM lalu klik Daftar."));
      }
      const user = { email, name: chat.user.displayName || email, space: space.name };
      await store.set("user", email, user);
      console.log("DAFTAR", email, space.name);
      return res.json(registrationMenu(user, true));
    }

    // A. Klik tombol: cek pengajuan, approver dan status, lalu ubah sekali saja.
    if (chat.buttonClickedPayload) {
      const { approvalId, action } = event.commonEventObject?.parameters || {};
      if (!["approve", "reject"].includes(action) || !approvalId) return res.json(textResponse("Aksi tidak valid."));
      let approval = await store.get("approval", approvalId);
      if (!approval) return res.json(textResponse("Pengajuan tidak ditemukan."));
      if (email !== approval.approverEmail) return res.json(textResponse("Anda bukan approver pengajuan ini."));
      if (approval.status !== "PENDING") return res.json(textResponse("Pengajuan sudah " + approval.status + "."));
      approval = await store.decide(approvalId, email, action === "approve" ? "APPROVED" : "REJECTED");
      if (!approval) return res.json(textResponse("Pengajuan sudah diproses. Muat ulang halaman untuk melihat hasil."));
      console.log("KEPUTUSAN", approval.id, approval.status);
      return res.json({ hostAppDataAction: { chatDataAction: { updateMessageAction: { message: {
        fallbackText: approval.title + " — " + approval.status,
        cardsV2: [{ cardId: approval.id, card: {
          header: { title: approval.status },
          sections: [{ widgets: [{ textParagraph: { text: escape(approval.title) + "<br>Diproses oleh " + escape(email) } }] }],
        } }],
      } } } } });
    }

    // Sapaan atau bot baru ditambahkan: tampilkan tombol/status di DM.
    if (!email || space?.spaceType !== "DIRECT_MESSAGE") {
      return res.json(textResponse("Buka DM bot untuk mendaftar dan menerima approval."));
    }
    return res.json(registrationMenu(await store.get("user", email)));
  });

  app.use((error, req, res, next) => {
    console.error("Request gagal:", error.name);
    res.status(error.status === 400 ? 400 : 500).send("Request gagal. Periksa konfigurasi dan log server.");
  });
  return app;
}

const app = createApp();
if (require.main === module && !process.env.VERCEL) {
  app.listen(Number(process.env.PORT || 3003), "127.0.0.1", () =>
    console.log("Buka http://localhost:" + (process.env.PORT || 3003) + " — username: admin"));
}
module.exports = app; // Vercel memerlukan aplikasi Express sebagai export utama.
module.exports.createApp = createApp; // Tetap tersedia untuk tes.
