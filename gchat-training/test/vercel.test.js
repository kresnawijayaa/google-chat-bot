const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PGlite } = require("@electric-sql/pglite");
const appExport = require("../index");
const { createStore } = require("../store");

test("Vercel export adalah function dan tanpa DATABASE_URL ditolak dengan petunjuk", async () => {
  assert.equal(typeof appExport, "function");
  const server = appExport.createApp({ env: { VERCEL: "1" } }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port);
    assert.equal(response.status, 503);
    assert.match(await response.text(), /DATABASE_URL/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("PostgreSQL mempertahankan registrasi lintas-instance dan hanya menerima satu keputusan", async () => {
  const db = new PGlite();
  const sql = { query: async (text, values) => (await db.query(text, values)).rows };
  const env = {
    VERCEL: "1", DATABASE_URL: "postgresql://test:test@localhost/test",
    PUBLIC_BASE_URL: "https://training.example.com", ADMIN_PASSWORD: "training-password-123",
    GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL: "addon@example.com",
  };
  const sent = [];
  const servers = [];
  async function instance() {
    const app = appExport.createApp({
      env, store: createStore(env.DATABASE_URL, sql),
      sendMessage: async (space, message) => sent.push({ space, message }),
      verifyGoogleToken: async () => ({ email: env.GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL, email_verified: true }),
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    servers.push(server);
    return "http://127.0.0.1:" + server.address().port;
  }
  async function event(url, body) {
    return fetch(url + "/google-chat", {
      method: "POST", headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const admin = "Basic " + Buffer.from("admin:" + env.ADMIN_PASSWORD).toString("base64");
  try {
    const first = await instance();
    await event(first, { chat: {
      user: { email: "approver@example.com", displayName: "Atasan" },
      space: { name: "spaces/DEMO", spaceType: "DIRECT_MESSAGE" },
      messagePayload: { message: { text: "/daftar" } },
    } });
    const second = await instance();
    const response = await fetch(second + "/send-approval", {
      method: "POST", redirect: "manual",
      headers: { Authorization: admin, Origin: second, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ approverEmail: "approver@example.com", title: "Training", detail: "Detail" }),
    });
    assert.equal(response.status, 303);
    assert.equal(sent[0].space, "spaces/DEMO");
    const id = sent[0].message.cardsV2[0].cardId;
    const click = action => ({ commonEventObject: { parameters: { approvalId: id, action } }, chat: {
      user: { email: "approver@example.com" }, buttonClickedPayload: {},
    } });
    const replies = await Promise.all([event(first, click("approve")), event(second, click("reject"))]);
    const bodies = await Promise.all(replies.map(reply => reply.json()));
    assert.equal(bodies.filter(body => body.hostAppDataAction.chatDataAction.updateMessageAction).length, 1);
    // Simulasi instance baru sesudah deploy, tetap membaca tabel yang sama.
    const third = await instance();
    const page = await (await fetch(third, { headers: { Authorization: admin } })).text();
    assert.match(page, /approver@example.com/);
    assert.match(page, /SENT/);
    const stored = (await db.query("SELECT data FROM gchat_training_data WHERE kind='approval' AND id=$1", [id])).rows[0].data;
    assert.ok(["APPROVED", "REJECTED"].includes(stored.status));
    // Metadata pengiriman tidak boleh menimpa keputusan.
    await createStore(env.DATABASE_URL, sql).patch("approval", id, { delivery: "SENT" });
    assert.equal((await createStore(env.DATABASE_URL, sql).get("approval", id)).status, stored.status);
    const brokenStore = createStore("postgresql://test:test@localhost/test", { query: async () => { throw Error("DB unavailable"); } });
    await assert.rejects(brokenStore.list("user"), /DB unavailable/);
  } finally {
    for (const server of servers) await new Promise(resolve => server.close(resolve));
    await db.close();
  }
});
