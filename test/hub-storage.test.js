const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {createRequire}=require("node:module");
const root=path.resolve(__dirname,"../gchat-hub");
const localRequire=createRequire(path.join(root,"package.json"));
const storeSource=fs.readFileSync(path.join(root,"store.js"),"utf8");
function loadStore(env={},sqlClient) {
 const module={exports:{}};
 vm.runInNewContext(storeSource,{module,process:{env},Map,Date,require:name=>name==="@neondatabase/serverless"&&sqlClient?{neon:()=>sqlClient}:localRequire(name)});
 return module.exports;
}
test("PostgreSQL schema and cross-instance decisions execute against PGlite", async () => {
  const { PGlite } = localRequire("@electric-sql/pglite");
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
    assert.equal(await first.deleteUser(email), true);
    assert.equal(await second.getUser(email), undefined);
    assert.equal(await second.deleteUser(email), false);
    assert.equal((await second.listApprovals({ approver: email })).total, 2);
    const failing = loadStore(env, { query: async () => { throw new Error("database unavailable"); } });
    await assert.rejects(failing.listUsers(), /database unavailable/);
  } finally { await db.close(); }
});

test("NIK registration survives instances, rejects unauthorized users and consumes the session", async () => {
  const { PGlite } = localRequire("@electric-sql/pglite");
  const db = new PGlite();
  const adapter = { query: async (query, params) => (await db.query(query, params)).rows };
  const env = { DATABASE_URL: "postgresql://test:test@localhost/test" };
  const first = loadStore(env, adapter), second = loadStore(env, adapter);
  try {
    await db.exec(fs.readFileSync(path.join(root, "db/schema.sql"), "utf8"));
    await first.setAllowedUser("001234", "employee@example.com", "Employee");
    const user = { email: "employee@example.com", dmSpace: "spaces/employee", displayName: "From Google" };
    assert.equal(await first.registerByNik("001234", user), false);
    await first.beginRegistration(user.email, user.dmSpace);
    assert.equal(await second.isAwaitingNik(user.email, user.dmSpace), true);
    assert.equal(await second.registerByNik("999999", user), false);
    assert.equal(await second.registerByNik("001234", {...user, dmSpace: "spaces/other"}), false);
    await first.beginRegistration("impostor@example.com", "spaces/impostor");
    assert.equal(await second.registerByNik("001234", {email:"impostor@example.com",dmSpace:"spaces/impostor"}), false);
    assert.equal(await second.getUser("impostor@example.com"), undefined);
    assert.equal(await second.registerByNik("001234", user), true);
    assert.equal((await first.getUser(user.email)).nik, "001234");
    assert.equal((await first.getUser(user.email)).displayName, "Employee");
    assert.equal(await first.isAwaitingNik(user.email, user.dmSpace), false);
    assert.equal(await first.registerByNik("001234", user), false);
    await first.deleteUser(user.email);
    await first.beginRegistration(user.email, user.dmSpace);
    await db.query("UPDATE bot_registration_sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE email = $1", [user.email]);
    assert.equal(await second.isAwaitingNik(user.email, user.dmSpace), false);
    assert.equal(await second.registerByNik("001234", user), false);
    await first.beginRegistration(user.email, user.dmSpace);
    await db.query("UPDATE allowed_users SET enabled = FALSE WHERE nik = $1", ["001234"]);
    assert.equal(await second.registerByNik("001234", user), false);
  } finally { await db.close(); }
});
