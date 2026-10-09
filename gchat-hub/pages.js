const { createHash, createHmac, timingSafeEqual } = require("node:crypto");
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const time = value => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "—";
  return escape(new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value))) + " WIB";
};
const statuses = { PENDING: "Pending", APPROVED: "Approved", DECLINED: "Rejected" };
function badge(status) { return '<span class="badge ' + escape(status) + '">' + escape(statuses[status] || status || "—") + '</span>'; }
function layout(title, active, body) {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · Approval Bot</title>
  <style>
  :root{color-scheme:light;--ink:#19332e;--muted:#536b65;--line:#d9e3df;--paper:#f5f8f6;--accent:#185b43}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 "Trebuchet MS",Verdana,sans-serif}a{color:var(--accent);text-underline-offset:4px}header{background:#edf3ef;border-bottom:1px solid var(--line)}.top,main{max-width:1280px;margin:auto;padding:24px clamp(18px,4vw,48px)}.top{display:flex;gap:30px;align-items:center;justify-content:space-between}.brand{font-weight:700;letter-spacing:-.5px;font-size:20px}nav{display:flex;gap:24px;flex-wrap:wrap}nav a{color:var(--muted);text-decoration:none;padding:6px 0}nav a[aria-current]{color:var(--accent);border-bottom:2px solid var(--accent);font-weight:700}main{padding-top:42px;padding-bottom:70px}.eyebrow{text-transform:uppercase;letter-spacing:2px;font-size:11px;color:var(--muted);font-weight:700}h1{font-size:clamp(28px,4vw,40px);letter-spacing:-1.4px;margin:8px 0 12px;line-height:1.2}p{margin:0 0 22px}.muted,small{color:var(--muted)}.filters{display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;padding:24px 0;border-top:1px solid var(--line)}label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:700}.search{flex:1;min-width:220px}input,select,button{font:inherit;border:1px solid #b6c9c0;border-radius:5px;padding:10px 12px;background:#fcfdfb;color:var(--ink);min-height:44px}select{max-width:320px}button{background:var(--accent);color:#f6faf7;border-color:var(--accent);cursor:pointer}button:hover{background:#10432f}a:focus-visible,input:focus-visible,select:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #b76b13;outline-offset:3px}.toolbar{display:flex;justify-content:space-between;gap:16px;align-items:center;margin:8px 0 12px}.table-wrap{overflow-x:auto;background:#fcfdfb;border:1px solid var(--line)}table{border-collapse:collapse;width:100%;text-align:left}th{background:#edf3ef;color:var(--muted);font-size:12px;letter-spacing:.4px;padding:14px 18px;white-space:nowrap}td{padding:18px;border-top:1px solid var(--line);vertical-align:top;font-size:14px;overflow-wrap:anywhere}tbody tr:hover{background:#f3f7f3}td small{display:block;font-size:12px;margin-top:5px}.badge{display:inline-block;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:700;white-space:nowrap}.PENDING{background:#faf0d7;color:#76520a}.APPROVED{background:#e1f2e7;color:#23613d}.DECLINED{background:#fbe8e3;color:#9b3827}details{margin-top:9px}summary{cursor:pointer;color:var(--accent);font-size:12px}details p{margin:8px 0;white-space:pre-wrap;max-width:320px}.empty{padding:42px 24px;text-align:center}.pager{display:flex;align-items:center;gap:18px;margin:24px 0}.note{font-size:12px;color:var(--muted);margin-top:20px}.id{font-size:11px;max-width:260px}.nowrap{white-space:nowrap}.danger{background:#9b3827;border-color:#9b3827}.danger:hover{background:#762719}.delete-link{color:#9b3827}
  @media(max-width:700px){.top{align-items:flex-start;flex-direction:column;gap:12px}nav{gap:18px}main{padding-top:28px}label,select{width:100%;max-width:none}.filters button{flex:1}th,td{padding:12px}table{min-width:760px}.toolbar{align-items:flex-start;flex-direction:column}.search{min-width:0;width:100%}}
  </style></head><body><header><div class="top"><div class="brand">Approval Bot<span class="muted"> / Admin</span></div><nav aria-label="Navigasi utama">${[['/approval-demo','Kirim approval'],['/users','Pengguna'],['/approvals','Riwayat approval']].map(([url,label]) => '<a href="'+url+'"'+(url===active?' aria-current="page"':'')+'>'+label+'</a>').join('')}</nav></div></header><main><div class="eyebrow">Monitoring internal</div><h1>${escape(title)}</h1>${body}</main></body></html>`;
}
function text(query, key) { return typeof query[key] === "string" ? query[key].trim().slice(0, 200) : ""; }
function registerMonitoringPages(app, store, env = process.env) {
  const password = env.ADMIN_PASSWORD;
  const username = env.ADMIN_USERNAME || "admin";
  const digest = value => createHash("sha256").update(value).digest();
  const expected = password ? digest(username + ":" + password) : null;
  function requireAdmin(req, res, next) {
    res.set("Cache-Control", "no-store");
    if (!password || password.length < 12) {
      return res.status(503).type("html").send(layout("Login admin belum dikonfigurasi", "", '<p>Atur ADMIN_PASSWORD minimal 12 karakter di Vercel, lalu redeploy. ADMIN_USERNAME opsional; default: admin.</p>'));
    }
    const header = req.get("Authorization") || "";
    let supplied = "";
    if (header.startsWith("Basic ")) supplied = Buffer.from(header.slice(6), "base64").toString("utf8");
    if (!timingSafeEqual(expected, digest(supplied))) {
      res.set("WWW-Authenticate", 'Basic realm="Approval Bot Admin", charset="UTF-8"');
      return res.status(401).send("Login admin diperlukan.");
    }
    next();
  }
  app.use(["/users", "/approvals", "/approval-demo", "/send-approval"], requireAdmin);
  app.post("/send-approval",(req,res,next)=>{
    const origin=req.get("Origin");
    let sameHost = false;
    try { const url = new URL(origin); sameHost = url.host === req.get("Host") && ["http:", "https:"].includes(url.protocol); } catch {}
    if(!sameHost) return res.status(403).send("Invalid form origin");
    next();
  });
  function deleteToken(email, expires) {
    return createHmac("sha256", password).update(JSON.stringify(["delete-user", email, expires])).digest("hex");
  }
  app.get("/users/delete", async (req, res) => {
    const email = text(req.query, "email");
    const user = await store.getUser(email);
    if (!user) return res.status(404).send(layout("Pengguna tidak ditemukan", "/users", '<p>Pengguna sudah dihapus atau tidak terdaftar.</p><a href="/users">Kembali ke pengguna</a>'));
    const expires = String(Date.now() + 15 * 60 * 1000);
    res.send(layout("Hapus pengguna?", "/users", `<p><strong>${escape(user.displayName || email)}</strong><br>${escape(email)}</p><p>Pengguna akan dihapus dari daftar terdaftar dan tidak bisa dipilih untuk pengajuan baru. Riwayat serta approval yang sudah dikirim tetap tersimpan. Pengguna dapat terdaftar kembali melalui /regist dan validasi NIK di DM bot.</p><form method="post" action="/users/delete"><input type="hidden" name="email" value="${escape(email)}"><input type="hidden" name="expires" value="${expires}"><input type="hidden" name="token" value="${deleteToken(email, expires)}"><button class="danger">Ya, hapus pengguna</button> <a href="/users">Batal</a></form>`));
  });
  app.post("/users/delete", async (req, res) => {
    const email = text(req.body || {}, "email");
    const expires = text(req.body || {}, "expires");
    const token = text(req.body || {}, "token");
    const expiry = Number(expires);
    if (!email || !Number.isFinite(expiry) || expiry < Date.now() || expiry > Date.now() + 15 * 60 * 1000
      || !/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(deleteToken(email, expires), "hex"))) {
      return res.status(403).send(layout("Konfirmasi tidak valid", "/users", '<p>Buka kembali halaman konfirmasi untuk menghapus pengguna.</p><a href="/users">Kembali ke pengguna</a>'));
    }
    const deleted = await store.deleteUser(email);
    return res.redirect(303, "/users?notice=" + (deleted ? "deleted" : "missing"));
  });
  app.get("/users", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const q = text(req.query, "q");
    const all = await store.listUsers();
    const users = all.filter(user => [user.email, user.displayName].join(' ').toLowerCase().includes(q.toLowerCase())).sort((a,b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));
    const rows = users.map(user => `<tr><td><strong>${escape(user.displayName || user.email)}</strong><small>${escape(user.email)}</small><small>NIK: ${escape(user.nik || "Belum divalidasi")}</small></td><td>${escape(user.dmSpace || '—')}</td><td class="nowrap">${time(user.registeredAt)}</td><td class="nowrap">${time(user.lastSeenAt)}</td><td><a href="/approvals?approver=${encodeURIComponent(user.email)}">Lihat approval</a><small><a class="delete-link" href="/users/delete?email=${encodeURIComponent(user.email)}">Hapus pengguna</a></small></td></tr>`).join('');
    res.send(layout("Pengguna terdaftar", "/users", `${req.query.notice === "deleted" ? '<p role="status">Pengguna berhasil dihapus. Riwayat approval tetap tersimpan.</p>' : req.query.notice === "missing" ? '<p role="status">Pengguna sudah tidak ada dalam daftar.</p>' : ""}<p class="muted">Pengguna yang telah berinteraksi dengan bot melalui pesan langsung.</p><form class="filters" method="get"><label class="search">Cari nama atau email<input type="search" name="q" value="${escape(q)}" placeholder="Nama atau email pengguna"></label><button>Cari pengguna</button><a href="/users">Reset</a></form><div class="toolbar"><span>${users.length} pengguna ditampilkan · ${all.length} total</span><a href="${escape(req.originalUrl)}">Muat ulang</a></div><div class="table-wrap"><table><thead><tr><th scope="col">Pengguna</th><th scope="col">Ruang DM</th><th scope="col">Terdaftar</th><th scope="col">Interaksi terakhir</th><th scope="col">Tindakan</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">'+(q?'Tidak ada pengguna yang cocok. Coba nama atau email lain.':'Belum ada pengguna. Kirim /regist melalui DM bot dan masukkan NIK untuk registrasi.')+'</td></tr>'}</tbody></table></div><p class="note">Tanggal pengguna lama yang belum tercatat ditampilkan sebagai —. Waktu menggunakan WIB.</p>`));
  });
  app.get("/approvals", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const q = text(req.query, "q");
    const approver = text(req.query, "approver");
    const inputStatus = text(req.query, "status");
    const status = Object.hasOwn(statuses, inputStatus) ? inputStatus : "";
    const result = await store.listApprovals({ q, approver, status, page: text(req.query, "page") });
    const users = await store.listUsers();
    const emails = [...new Set([...users.map(user => user.email), ...(approver ? [approver] : [])])].sort();
    const options = emails.map(email => '<option value="'+escape(email)+'"'+(approver===email?' selected':'')+'>'+escape(email)+'</option>').join('');
    const delivery = approval => ({SENT:'Terkirim ke Google Chat',FAILED:'Pengiriman gagal',SENDING:'Pengiriman belum terkonfirmasi'}[approval.deliveryStatus] || 'Data pengiriman belum tercatat');
    const rows = result.items.map(approval => `<tr><td><strong>${escape(approval.employeeName)}</strong><small>${escape(approval.type)} · ${escape(approval.date)}</small><small class="id">${escape(approval.id)}</small><details><summary>Alasan pengajuan</summary><p>${escape(approval.reason || '—')}</p></details></td><td>${escape(approval.approverEmail)}<small>${escape(delivery(approval))}</small>${approval.sentAt ? '<small>'+time(approval.sentAt)+'</small>' : ''}</td><td>${badge(approval.status)}<small>${approval.status === 'PENDING' ? (approval.deliveryStatus === 'FAILED' ? 'Belum diputuskan; pengiriman gagal' : 'Belum ada keputusan') : 'Diproses oleh '+escape(approval.approvedBy || '—')}</small></td><td class="nowrap">${time(approval.createdAt)}</td><td class="nowrap">${time(approval.updatedAt)}</td></tr>`).join('');
    const pageUrl = page => '/approvals?'+new URLSearchParams({q,approver,status,page:String(page)}).toString();
    res.send(layout("Riwayat approval", "/approvals", `<p class="muted">Pantau pengajuan ke setiap approver dan keputusan terakhirnya.</p><form class="filters" method="get"><label class="search">Cari pengajuan<input type="search" name="q" value="${escape(q)}" placeholder="Pemohon, jenis, ID, atau email"></label><label>Status keputusan<select name="status"><option value="">Semua status</option>${Object.entries(statuses).map(([key,label])=>'<option value="'+key+'"'+(status===key?' selected':'')+'>'+label+'</option>').join('')}</select></label><label>Approver<select name="approver"><option value="">Semua approver</option>${options}</select></label><button>Terapkan</button><a href="/approvals">Reset</a></form><div class="toolbar"><span>${result.total} pengajuan · terbaru terlebih dahulu</span><a href="${escape(req.originalUrl)}">Muat ulang</a></div><div class="table-wrap"><table><thead><tr><th scope="col">Pengajuan</th><th scope="col">Approver &amp; pengiriman</th><th scope="col">Keputusan</th><th scope="col">Dibuat</th><th scope="col">Diputuskan</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">'+(q||status||approver?'Tidak ada pengajuan yang cocok dengan filter.':'Belum ada pengajuan. <a href="/approval-demo">Kirim approval pertama</a>.')+'</td></tr>'}</tbody></table></div><div class="pager" aria-label="Navigasi halaman">${result.page>1?'<a href="'+escape(pageUrl(result.page-1))+'">← Sebelumnya</a>':''}<span>Halaman ${result.page} dari ${result.pages}</span>${result.page<result.pages?'<a href="'+escape(pageUrl(result.page+1))+'">Berikutnya →</a>':''}</div><p class="note">Rejected adalah keputusan Decline. Terkirim berarti permintaan pengiriman diterima Google Chat, bukan tanda pesan sudah dibaca. Pengajuan lama belum memiliki catatan pengiriman. Semua waktu menggunakan WIB.</p>`));
  });
}
module.exports = { registerMonitoringPages, escape };
