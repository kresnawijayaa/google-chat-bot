const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../index");

const env = {
  PUBLIC_BASE_URL: "https://training.example.com",
  ADMIN_PASSWORD: "training-password-123",
  GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL: "addon@example.iam.gserviceaccount.com",
};
const admin = "Basic " + Buffer.from("admin:" + env.ADMIN_PASSWORD).toString("base64");
const verifyGoogleToken = async token => {
  if (token !== "test-google-token") throw Error("invalid");
  return { email: env.GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL, email_verified: true };
};
async function start(options = {}) {
  const server = createApp({ env, verifyGoogleToken, ...options }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  return { server, url: "http://127.0.0.1:" + server.address().port };
}
async function googleEvent(url, body, token = "test-google-token") {
  return fetch(url + "/google-chat", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(body),
  });
}
const registerEvent = email => ({ chat: {
  user: { email, displayName: "User <demo>" },
  space: { name: "spaces/DEMO", spaceType: "DIRECT_MESSAGE" },
  messagePayload: { message: { text: "/daftar" } },
} });
const clickEvent = (id, action, email) => ({
  commonEventObject: { parameters: { approvalId: id, action } },
  chat: { user: { email }, buttonClickedPayload: {} },
});
test("Daftar, kirim, approve/reject, cek approver dan keputusan ganda", async () => {
  const sent = [];
  const { server, url } = await start({ sendMessage: async (space, message) => sent.push({ space, message }) });
  try {
    assert.equal((await fetch(url)).status, 401);
    const reply = await (await googleEvent(url, registerEvent("approver@example.com"))).json();
    assert.match(JSON.stringify(reply), /Pendaftaran berhasil/);
    let page = await (await fetch(url, { headers: { Authorization: admin } })).text();
    assert.match(page, /approver@example.com/);
    assert.ok(page.includes("User &lt;demo&gt;"));
    assert.ok(!page.includes("{{options}}"));
    const form = { approverEmail: "approver@example.com", title: "Cuti <demo>", detail: "Alasan & contoh" };
    const send = headers => fetch(url + "/send-approval", {
      method: "POST", redirect: "manual",
      headers: { Authorization: admin, Origin: url, "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(form),
    });
    assert.equal((await send({ Origin: "https://other.example.com" })).status, 403);
    assert.equal((await send({})).status, 303);
    assert.equal(sent[0].space, "spaces/DEMO");
    const card = sent[0].message.cardsV2[0];
    const buttons = card.card.sections[0].widgets[1].buttonList.buttons;
    assert.equal(buttons[0].onClick.action.function, env.PUBLIC_BASE_URL + "/google-chat");
    assert.match(JSON.stringify(card), /&lt;demo&gt;/);
    const id = card.cardId;
    const denied = await (await googleEvent(url, clickEvent(id, "approve", "other@example.com"))).json();
    assert.match(JSON.stringify(denied), /Anda bukan approver/);
    const approved = await (await googleEvent(url, clickEvent(id, "approve", "approver@example.com"))).json();
    assert.ok(approved.hostAppDataAction.chatDataAction.updateMessageAction);
    const duplicate = await (await googleEvent(url, clickEvent(id, "reject", "approver@example.com"))).json();
    assert.match(JSON.stringify(duplicate), /sudah APPROVED/);
    assert.equal((await send({})).status, 303);
    const rejectedId = sent[1].message.cardsV2[0].cardId;
    const rejected = await (await googleEvent(url, clickEvent(rejectedId, "reject", "approver@example.com"))).json();
    assert.match(JSON.stringify(rejected), /REJECTED/);
    page = await (await fetch(url, { headers: { Authorization: admin } })).text();
    assert.match(page, /APPROVED/); assert.match(page, /REJECTED/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test("Request Google invalid ditolak; pendaftaran harus DM", async () => {
  const { server, url } = await start();
  try {
    assert.equal((await googleEvent(url, registerEvent("a@example.com"), "invalid")).status, 401);
    const group = registerEvent("a@example.com");
    group.chat.space.spaceType = "SPACE";
    assert.match(JSON.stringify(await (await googleEvent(url, group)).json()), /melalui DM/);
    const command = registerEvent("a@example.com");
    delete command.chat.messagePayload;
    command.chat.appCommandPayload = { appCommandMetadata: { appCommandId: 1 } };
    assert.match(JSON.stringify(await (await googleEvent(url, command)).json()), /Pendaftaran berhasil/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test("Kegagalan kirim tercatat dan restart mengosongkan data latihan", async () => {
  const first = await start({ sendMessage: async () => { throw Error("Google unavailable"); } });
  try {
    await googleEvent(first.url, registerEvent("a@example.com"));
    const response = await fetch(first.url + "/send-approval", {
      method: "POST", redirect: "manual",
      headers: { Authorization: admin, Origin: first.url, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ approverEmail: "a@example.com", title: "Test", detail: "Detail" }),
    });
    assert.equal(response.headers.get("location"), "/?notice=failed");
    const page = await (await fetch(first.url, { headers: { Authorization: admin } })).text();
    assert.match(page, /FAILED/);
  } finally { await new Promise(resolve => first.server.close(resolve)); }
  const second = await start();
  try {
    const page = await (await fetch(second.url, { headers: { Authorization: admin } })).text();
    assert.match(page, /Belum ada pengguna terdaftar/);
    assert.match(page, /Belum ada pengajuan/);
  } finally { await new Promise(resolve => second.server.close(resolve)); }
});

test("Sapaan menampilkan tombol Daftar; klik menyimpan pengguna dan sapaan berikutnya menampilkan status", async () => {
  const { server, url } = await start();
  try {
    const hello = registerEvent("button@example.com");
    hello.chat.messagePayload.message.text = "halo";
    const welcome = await (await googleEvent(url, hello)).json();
    const message = welcome.hostAppDataAction.chatDataAction.createMessageAction.message;
    const button = message.cardsV2[0].card.sections[0].widgets[1].buttonList.buttons[0];
    assert.equal(button.text, "Daftar");
    assert.equal(button.onClick.action.function, env.PUBLIC_BASE_URL + "/google-chat");
    let page = await (await fetch(url, { headers: { Authorization: admin } })).text();
    assert.match(page, /Belum ada pengguna terdaftar/);
    const clicked = {
      commonEventObject: { parameters: { action: "register", email: "forged@example.com" } },
      chat: { user: hello.chat.user, buttonClickedPayload: { space: hello.chat.space } },
    };
    const response = await (await googleEvent(url, clicked)).json();
    assert.match(JSON.stringify(response), /Pendaftaran berhasil/);
    page = await (await fetch(url, { headers: { Authorization: admin } })).text();
    assert.match(page, /button@example.com/); assert.ok(!page.includes("forged@example.com"));
    const status = await (await googleEvent(url, hello)).json();
    assert.match(JSON.stringify(status), /Anda sudah terdaftar/);
    assert.ok(!JSON.stringify(status).includes("buttonList"));
    clicked.chat.buttonClickedPayload.space.spaceType = "SPACE";
    assert.match(JSON.stringify(await (await googleEvent(url, clicked)).json()), /melalui DM/);
    // Event bot ditambahkan di DM juga memberi kartu sambutan.
    const added = { chat: {
      user: { email: "new@example.com" },
      addedToSpacePayload: { space: { name: "spaces/NEW", spaceType: "DIRECT_MESSAGE" } },
    } };
    assert.match(JSON.stringify(await (await googleEvent(url, added)).json()), /buttonList/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
