// Neon PostgreSQL shares state across Vercel instances. Memory is local-only.
const users = new Map();
const approvals = new Map();
const allowedUsers = new Map();
const registrationSessions = new Map();
const databaseUrl = process.env.DATABASE_URL;
if (process.env.VERCEL && !databaseUrl) {
  throw new Error("Configure DATABASE_URL with the Neon PostgreSQL connection string for Vercel.");
}
const sql = databaseUrl ? require("@neondatabase/serverless").neon(databaseUrl) : null;

module.exports = {
  async getUserByNik(nik) {
    if(!sql) return [...users.values()].find(user=>user.nik===nik);
    return (await sql.query("SELECT data FROM bot_users WHERE data->>'nik' = $1",[nik]))[0]?.data;
  },
  async createApproval(id, approval) {
    if(!sql) {if(approvals.has(id)) return false;approvals.set(id,approval);return true;}
    return (await sql.query("INSERT INTO bot_approvals (id, approver_email, status, data) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id",[id,approval.approverEmail,approval.status,JSON.stringify(approval)])).length>0;
  },
  async getApproval(id) {
    if(!sql) return approvals.get(id);
    return (await sql.query("SELECT data FROM bot_approvals WHERE id = $1",[id]))[0]?.data;
  },
  async listPendingDecisions(clientId) {
    if(!sql) return [...approvals.values()].filter(a=>a.clientId===clientId && a.status!=="PENDING" && a.syncStatus!=="ACKNOWLEDGED").slice(0,100);
    return (await sql.query("SELECT data FROM bot_approvals WHERE data->>'clientId' = $1 AND status <> 'PENDING' AND data->>'syncStatus' IS DISTINCT FROM 'ACKNOWLEDGED' ORDER BY data->>'updatedAt', id LIMIT 100",[clientId])).map(row=>row.data);
  },
  async ackDecision(id,clientId) {
    const metadata={syncStatus:"ACKNOWLEDGED",acknowledgedAt:new Date().toISOString()};
    if(!sql) {const approval=approvals.get(id);if(!approval || approval.clientId!==clientId || approval.status==="PENDING") return false; if(approval.syncStatus!=="ACKNOWLEDGED") Object.assign(approval,metadata);return true;}
    const rows=await sql.query("UPDATE bot_approvals SET data = data || $3::jsonb WHERE id = $1 AND data->>'clientId' = $2 AND status <> 'PENDING' AND data->>'syncStatus' IS DISTINCT FROM 'ACKNOWLEDGED' RETURNING id",[id,clientId,JSON.stringify(metadata)]);
    if(rows.length) return true;
    const previous=(await sql.query("SELECT data FROM bot_approvals WHERE id = $1",[id]))[0]?.data;
    return !!previous && previous.clientId===clientId && previous.status!=="PENDING" && previous.syncStatus==="ACKNOWLEDGED";
  },
  async setAllowedUser(nik, email, displayName = "") {
    email = email.trim().toLowerCase();
    if (!sql) { allowedUsers.set(nik, { email, displayName, enabled: true }); return; }
    await sql.query("INSERT INTO allowed_users (nik, email, display_name) VALUES ($1, $2, $3) ON CONFLICT (nik) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, enabled = TRUE", [nik, email, displayName]);
  },
  async beginRegistration(email, space) {
    if (!sql) { registrationSessions.set(email, { space, expires: Date.now() + 10 * 60 * 1000 }); return; }
    await sql.query("INSERT INTO bot_registration_sessions (email, dm_space, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes') ON CONFLICT (email) DO UPDATE SET dm_space = EXCLUDED.dm_space, expires_at = EXCLUDED.expires_at", [email, space]);
  },
  async isAwaitingNik(email, space) {
    if (!sql) { const pending = registrationSessions.get(email); return !!pending && pending.space === space && pending.expires > Date.now(); }
    return (await sql.query("SELECT email FROM bot_registration_sessions WHERE email = $1 AND dm_space = $2 AND expires_at > NOW()", [email, space])).length > 0;
  },
  async registerByNik(nik, user) {
    const now = new Date().toISOString();
    if (!sql) {
      const allowed = allowedUsers.get(nik);
      const pending = registrationSessions.get(user.email);
      if (!allowed?.enabled || allowed.email !== user.email || !pending || pending.space !== user.dmSpace || pending.expires <= Date.now()) return false;
      if ([...users.values()].some(existing => existing.nik === nik && existing.email !== user.email)) return false;
      users.set(user.email, { ...user, nik, displayName: allowed.displayName || user.displayName, registeredAt: users.get(user.email)?.registeredAt || now, lastSeenAt: now });
      registrationSessions.delete(user.email);
      return true;
    }
    const data = JSON.stringify({ ...user, nik, registeredAt: now, lastSeenAt: now });
    try {
      const rows = await sql.query(`WITH registered AS (
        INSERT INTO bot_users (email, data)
        SELECT a.email, $4::jsonb || jsonb_build_object('displayName', COALESCE(NULLIF(a.display_name, ''), $4::jsonb->>'displayName'))
        FROM allowed_users a JOIN bot_registration_sessions s ON s.email = a.email
        WHERE a.nik = $1 AND a.email = $2 AND a.enabled AND s.dm_space = $3 AND s.expires_at > NOW()
        ON CONFLICT (email) DO UPDATE SET data = EXCLUDED.data || jsonb_build_object('registeredAt', COALESCE(bot_users.data->>'registeredAt', EXCLUDED.data->>'registeredAt'))
        RETURNING email
      ), cleared AS (
        DELETE FROM bot_registration_sessions WHERE email IN (SELECT email FROM registered)
      ) SELECT email FROM registered`, [nik, user.email, user.dmSpace, data]);
      return rows.length > 0;
    } catch (error) { if (error.code === "23505") return false; throw error; }
  },
  async listUsers() {
    if (!sql) return [...users.values()];
    return (await sql.query("SELECT data FROM bot_users ORDER BY email")).map(row => row.data);
  },
  async getUser(email) {
    if (!sql) return users.get(email);
    return (await sql.query("SELECT data FROM bot_users WHERE email = $1", [email]))[0]?.data;
  },
  async deleteUser(email) {
    if (!sql) return users.delete(email);
    return (await sql.query("DELETE FROM bot_users WHERE email = $1 RETURNING email", [email])).length > 0;
  },
  async setUser(email, user) {
    if (!sql) { users.set(email, user); return; }
    await sql.query(
      "INSERT INTO bot_users (email, data) VALUES ($1, $2::jsonb) ON CONFLICT (email) DO UPDATE SET data = EXCLUDED.data",
      [email, JSON.stringify(user)],
    );
  },
  async setApproval(id, approval) {
    if (!sql) { approvals.set(id, approval); return; }
    await sql.query(
      "INSERT INTO bot_approvals (id, approver_email, status, data) VALUES ($1, $2, $3, $4::jsonb)",
      [id, approval.approverEmail, approval.status, JSON.stringify(approval)],
    );
  },
  async updateDelivery(id, metadata) {
    if (!sql) { const approval = approvals.get(id); if (approval) Object.assign(approval, metadata); return; }
    await sql.query("UPDATE bot_approvals SET data = data || $2::jsonb WHERE id = $1", [id, JSON.stringify(metadata)]);
  },
  async listApprovals({ status = "", approver = "", q = "", page = 1 } = {}) {
    const pageSize = 25;
    const params = [status, approver, q.toLowerCase()];
    const where = `WHERE ($1 = '' OR status = $1)
      AND ($2 = '' OR approver_email = $2)
      AND ($3 = '' OR strpos(lower(concat_ws(' ', id, approver_email, data->>'employeeName', data->>'type')), $3) > 0)`;
    let total, items;
    if (sql) {
      total = Number((await sql.query("SELECT COUNT(*) AS total FROM bot_approvals " + where, params))[0].total);
    } else {
      items = [...approvals.values()].filter(a => (!status || a.status === status) && (!approver || a.approverEmail === approver)
        && (!q || [a.id, a.approverEmail, a.employeeName, a.type].join(' ').toLowerCase().includes(q.toLowerCase())))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || b.id.localeCompare(a.id));
      total = items.length;
    }
    const pages = Math.max(1, Math.ceil(total / pageSize));
    page = Math.min(pages, Math.max(1, Math.floor(Number(page) || 1)));
    if (sql) items = (await sql.query("SELECT data FROM bot_approvals " + where + " ORDER BY data->>'createdAt' DESC NULLS LAST, id DESC LIMIT $4 OFFSET $5", [...params, pageSize, (page - 1) * pageSize])).map(row => row.data);
    else items = items.slice((page - 1) * pageSize, page * pageSize);
    return { items, total, page, pages };
  },
  async decide(id, email, action) {
    if (!["approve", "decline"].includes(action)) return { error: "invalid" };
    const status = action === "approve" ? "APPROVED" : "DECLINED";
    const now = new Date().toISOString();
    if (sql) {
      // PostgreSQL rechecks the PENDING predicate after waiting on a concurrent update.
      const rows = await sql.query(
        `UPDATE bot_approvals
         SET status = $3, data = data || $4::jsonb
         WHERE id = $1 AND approver_email = $2 AND status = 'PENDING'
         RETURNING data`,
        [id, email || "", status, JSON.stringify({ status, updatedAt: now, approvedBy: email, syncStatus: "AWAITING_ACK" })],
      );
      if (rows.length) return { approval: rows[0].data };
      // A separate query sees a concurrent decision committed by another instance.
      const current = (await sql.query("SELECT approver_email, data FROM bot_approvals WHERE id = $1", [id]))[0];
      if (!current) return { error: "missing" };
      if (current.approver_email !== email) return { error: "forbidden" };
      return { error: "decided", approval: current.data };
    }
    const approval = approvals.get(id);
    if (!approval) return { error: "missing" };
    if (email !== approval.approverEmail) return { error: "forbidden" };
    if (approval.status !== "PENDING") return { error: "decided", approval };
    Object.assign(approval, { status, updatedAt: now, approvedBy: email, syncStatus: "AWAITING_ACK" });
    return { approval };
  },
};
