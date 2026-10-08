// Neon PostgreSQL shares state across Vercel instances. Memory is local-only.
const users = new Map();
const approvals = new Map();
const databaseUrl = process.env.DATABASE_URL;
if (process.env.VERCEL && !databaseUrl) {
  throw new Error("Configure DATABASE_URL with the Neon PostgreSQL connection string for Vercel.");
}
const sql = databaseUrl ? require("@neondatabase/serverless").neon(databaseUrl) : null;

module.exports = {
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
        [id, email || "", status, JSON.stringify({ status, updatedAt: now, approvedBy: email })],
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
    Object.assign(approval, { status, updatedAt: now, approvedBy: email });
    return { approval };
  },
};
