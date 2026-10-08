const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const localRequire = createRequire(path.join(root, "package.json"));
const source = fs.readFileSync(path.join(root, "index.js"), "utf8");
const storeSource = fs.readFileSync(path.join(root, "store.js"), "utf8");
function loadStore(env = {}, sqlClient) {
  const module = { exports: {} };
  vm.runInNewContext(storeSource, { module, process: { env }, Map, Date,
    require: name => name === "@neondatabase/serverless" && sqlClient
      ? { neon: () => sqlClient } : localRequire(name),
  });
  return module.exports;
}
function loadApp(store, env = { PUBLIC_BASE_URL: "https://bot.vercel.app" }) {
  const module = { exports: {} };
  vm.runInNewContext(source, { module, process: { env }, URL, console: { log() {}, error() {} },
    require: name => name === "./store" ? store : localRequire(name),
  });
  return module.exports;
}
test("HTTP registration, sending and concurrent approval decisions", async () => {
  const store = loadStore();
  const app = loadApp(store);
  let sent;
  app.chat.spaces.messages.create = async request => { sent = request; return { data: {} }; };
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (route, body) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const click = (id, action, email = "approver@example.com") => post("/google-chat", {
    commonEventObject: { parameters: { approvalId: id, action } }, chat: { user: { email }, buttonClickedPayload: {} },
  });
  try {
    assert.equal(typeof app, "function");
    const registration = await post("/google-chat", { chat: { user: { email: "approver@example.com" }, space: { name: "spaces/test", spaceType: "DIRECT_MESSAGE" }, messagePayload: {} } });
    assert.equal(registration.status, 200);
    assert.match(await (await fetch(base + "/approval-demo")).text(), /approver@example.com/);
    assert.equal((await post("/send-approval", { approverEmail: "approver@example.com", employeeName: "Budi", type: "Cuti", date: "12 Oktober", reason: "Keluarga" })).status, 200);
    assert.equal(sent.parent, "spaces/test");
    assert.equal((await store.listApprovals()).items[0].deliveryStatus, "SENT");
    const buttons = sent.requestBody.cardsV2[0].card.sections[0].widgets.at(-1).buttonList.buttons;
    assert.equal(buttons[0].onClick.action.function, "https://bot.vercel.app/google-chat");
    const id = buttons[0].onClick.action.parameters.find(p => p.key === "approvalId").value;
    assert.match(JSON.stringify(await (await click(id, "approve", "other@example.com")).json()), /bukan approver/);
    assert.match(JSON.stringify(await (await click(id, "invalid")).json()), /tidak valid/);
    const outcomes = await Promise.all([click(id, "approve"), click(id, "decline")]);
    const bodies = await Promise.all(outcomes.map(r => r.json()));
    assert.equal(bodies.filter(b => b.hostAppDataAction.chatDataAction.updateMessageAction).length, 1);
    assert.equal(bodies.filter(b => b.hostAppDataAction.chatDataAction.createMessageAction).length, 1);
    await store.setApproval("decline", { id: "decline", status: "PENDING", approverEmail: "approver@example.com" });
    assert.match(JSON.stringify(await (await click("decline", "decline")).json()), /DECLINED/);
    assert.match(JSON.stringify(await (await click("missing", "approve")).json()), /tidak ditemukan/);
    app.chat.spaces.messages.create = async () => { throw new Error("Google API unavailable"); };
    assert.equal((await post("/send-approval", { approverEmail: "approver@example.com", employeeName: "Failed delivery", type: "Cuti" })).status, 500);
    const failed = (await store.listApprovals({ q: "Failed delivery" })).items[0];
    assert.equal(failed.deliveryStatus, "FAILED");
    assert.equal(failed.status, "PENDING");
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test("Vercel requires persistent storage and callback origin is validated", () => {
  assert.throws(() => loadStore({ VERCEL: "1" }), /DATABASE_URL/);
  for (const url of [undefined, "http://localhost:3001", "https://bot.vercel.app/path"]) {
    assert.throws(() => loadApp(loadStore(), { PUBLIC_BASE_URL: url }).getCallbackUrl());
  }
});
test("PostgreSQL schema and cross-instance decisions execute against PGlite", async () => {
  const { PGlite } = require("@electric-sql/pglite");
  const db = new PGlite();
  const adapter = { query: async (query, params) => (await db.query(query, params)).rows };
  const env = { VERCEL: "1", DATABASE_URL: "postgresql://test:test@localhost/test" };
  const first = loadStore(env, adapter);
  const second = loadStore(env, adapter);
  try {
    const schema = fs.readFileSync(path.join(root, "db/schema.sql"), "utf8");
    await db.exec(schema);
    const email = "approver'@example.com";
    await first.setUser(email, { email, displayName: "Original" });
    await second.setUser(email, { email, displayName: "Updated" });
    assert.equal((await first.getUser(email)).displayName, "Updated");
    assert.equal((await second.listUsers()).length, 1);
    assert.equal(await second.getUser("missing"), undefined);
    const pending = id => ({ id, approverEmail: email, status: "PENDING", employeeName: "Budi" });
    await first.setApproval("race", pending("race"));
    assert.equal((await second.decide("race", "other", "approve")).error, "forbidden");
    assert.equal((await second.decide("race", email, "invalid")).error, "invalid");
    const outcomes = await Promise.all([first.decide("race", email, "approve"), second.decide("race", email, "decline")]);
    assert.equal(outcomes.filter(result => !result.error).length, 1);
    assert.equal(outcomes.filter(result => result.error === "decided").length, 1);
    const row = (await db.query("SELECT status, data FROM bot_approvals WHERE id = 'race'")).rows[0];
    assert.equal(row.status, row.data.status);
    assert.equal(row.data.approvedBy, email);
    assert.equal(row.data.employeeName, "Budi");
    await second.setApproval("decline", pending("decline"));
    assert.equal((await first.decide("decline", email, "decline")).approval.status, "DECLINED");
    assert.equal((await first.decide("missing", email, "approve")).error, "missing");
    await db.exec(schema);
    assert.equal((await first.listUsers()).length, 1);
    await first.updateDelivery("race", { deliveryStatus: "SENT", sentAt: new Date().toISOString() });
    const history = await second.listApprovals({ approver: email, status: row.status, q: "Budi" });
    assert.equal(history.total, row.status === "DECLINED" ? 2 : 1);
    const race = history.items.find(item => item.id === "race");
    assert.equal(race.deliveryStatus, "SENT");
    assert.equal(race.status, row.status);
    assert.equal((await second.listApprovals({ q: "unmatched" })).total, 0);
    await assert.rejects(db.query("UPDATE bot_approvals SET status = $1 WHERE id = 'race'", [row.status === "APPROVED" ? "DECLINED" : "APPROVED"]));
    const failing = loadStore(env, { query: async () => { throw new Error("database unavailable"); } });
    await assert.rejects(failing.listUsers(), /database unavailable/);
  } finally { await db.close(); }
});

test("Monitoring pages filter and escape user data and show delivery independently of decisions", async () => {
  const store = loadStore();
  await store.setUser("admin@example.com", { email: "admin@example.com", displayName: '<script>alert("x")</script>', dmSpace: "spaces/demo" });
  for (let i = 0; i < 27; i++) await store.setApproval("HISTORY-" + i, {
    id: "HISTORY-" + i, employeeName: i === 0 ? '<img src=x onerror=alert(1)>' : "Pemohon " + i,
    approverEmail: "admin@example.com", type: "Cuti", status: i === 0 ? "DECLINED" : "PENDING",
    createdAt: new Date(2026, 0, i + 1).toISOString(), deliveryStatus: i === 0 ? "FAILED" : "SENT",
    updatedAt: i === 0 ? "2026-01-02T01:00:00Z" : undefined,
  });
  const app = loadApp(store, { PUBLIC_BASE_URL: "https://bot.vercel.app", ADMIN_PASSWORD: "test-admin-password" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const adminFetch = url => fetch(url, { headers: { Authorization: "Basic " + Buffer.from("admin:test-admin-password").toString("base64") } });
  try {
    assert.equal((await fetch(base + "/users")).status, 401);
    assert.equal((await fetch(base + "/approvals")).status, 401);
    let response = await adminFetch(base + "/users?q=admin");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const users = await response.text();
    assert.ok(users.includes("&lt;script&gt;"));
    assert.ok(!users.includes('<script>alert'));
    assert.ok(users.includes("Lihat approval"));
    const rejected = await (await adminFetch(base + "/approvals?status=DECLINED&approver=admin%40example.com")).text();
    assert.ok(rejected.includes("Rejected"));
    assert.ok(rejected.includes("Pengiriman gagal"));
    assert.ok(rejected.includes("&lt;img"));
    assert.ok(!rejected.includes("<img"));
    const page2 = await (await adminFetch(base + "/approvals?page=2")).text();
    assert.ok(page2.includes("Halaman 2 dari 2"));
    assert.ok(page2.includes("HISTORY-0"));
    const empty = await (await adminFetch(base + "/approvals?q=not-found")).text();
    assert.ok(empty.includes("Tidak ada pengajuan yang cocok"));
    const result = await store.listApprovals({ page: -1, status: "PENDING" });
    assert.equal(result.page, 1);
    assert.equal(result.items.length, 25);
    assert.equal(result.total, 26);
    await store.updateDelivery("HISTORY-1", { deliveryStatus: "FAILED" });
    assert.equal((await store.listApprovals({ q: "HISTORY-1" })).items.find(a => a.id === "HISTORY-1").deliveryStatus, "FAILED");
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("Monitoring access stays closed until an admin password is configured", async () => {
  const app = loadApp(loadStore());
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    for (const route of ["/users", "/approvals"]) {
      const response = await fetch(base + route);
      assert.equal(response.status, 503);
      assert.ok((await response.text()).includes("ADMIN_PASSWORD"));
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
