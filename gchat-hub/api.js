const { createHash, createHmac } = require("node:crypto");
const { createAuth } = require("./auth");
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function registerApplicationApi(app, { env, store, chat, createApprovalMessage, debug }) {
  const signingSecret = typeof env.BRIDGE_SECRET === "string" && env.BRIDGE_SECRET.length >= 32
    ? createHmac("sha256", env.BRIDGE_SECRET).update("gchat-hub-application-api-v1").digest("hex") : "";
  function clients() {
    try {
      const values = JSON.parse(env.APP_CLIENTS_JSON || "[]");
      if (!Array.isArray(values) || !values.length) return [];
      const ids = new Set();
      for (const value of values) {
        if (!value || typeof value.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(value.id) || typeof value.secret !== "string" || value.secret.length < 32 || ids.has(value.id)) return [];
        ids.add(value.id);
      }
      return values.map(value => ({ id: value.id, secret: value.secret, role: "application" }));
    } catch { return []; }
  }
  const auth = createAuth({ secret: signingSecret, issuer: "gchat-hub", audience: "gchat-hub-application-api", clients, debug });
  app.use(["/auth/token", "/api/approvals"], (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!signingSecret || !clients().length) return res.status(503).json({ error: "Application API is not configured" });
    next();
  });
  app.post("/auth/token", auth.login);
  function view(approval) {
    return {
      id: approval.id, requestId: approval.sourceRequestId,
      approverNik: approval.approverNik, approverEmail: approval.approverEmail,
      status: approval.status, deliveryStatus: approval.deliveryStatus,
      createdAt: approval.createdAt, sentAt: approval.sentAt || null,
      decidedAt: approval.updatedAt || null, decidedBy: approval.approvedBy || null,
    };
  }
  const duplicate = (res, existing, fingerprint) => {
    if (existing.requestFingerprint !== fingerprint) return res.status(409).json({ error: "Request ID already used for different data", id: existing.id });
    return res.status(200).json({ ...view(existing), duplicate: true });
  };
  app.post("/api/approvals", auth.requireRole("application"), async (req, res) => {
    const input = req.body;
    const limits = { requestId: 128, employeeName: 200, type: 100, date: 200 };
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      !Object.entries(limits).every(([key,limit]) => typeof input[key] === "string" && input[key].trim().length > 0 && input[key].length <= limit) ||
      typeof input.approverNik !== "string" || !/^[0-9]{1,32}$/.test(input.approverNik) ||
      (input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 2000))) {
      return res.status(400).json({ error: "Invalid approval payload", required: ["requestId", "approverNik", "employeeName", "type", "date"] });
    }
    const data = {
      requestId: input.requestId.trim(), approverNik: input.approverNik,
      employeeName: input.employeeName.trim(), type: input.type.trim(),
      date: input.date.trim(), reason: (input.reason || "").trim(),
    };
    const id = "APR-" + digest([req.serviceClient, data.requestId]).slice(0, 32);
    const fingerprint = digest(data);
    const existing = await store.getApproval(id);
    if (existing) return duplicate(res, existing, fingerprint);
    const approver = await store.getUserByNik(data.approverNik);
    if (!approver?.email || !approver.dmSpace) return res.status(422).json({ error: "Approver has not completed bot registration" });
    // Escape application text because Google cards support HTML in text fields.
    const text = value => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    const message = createApprovalMessage({ approvalId: id, employeeName: text(data.employeeName), type: text(data.type), date: text(data.date), reason: text(data.reason) });
    const approval = {
      id, clientId: req.serviceClient, sourceRequestId: data.requestId,
      requestFingerprint: fingerprint, approverNik: data.approverNik,
      approverEmail: approver.email, employeeName: data.employeeName,
      type: data.type, date: data.date, reason: data.reason,
      status: "PENDING", deliveryStatus: "SENDING", createdAt: new Date().toISOString(),
    };
    if (!await store.createApproval(id, approval)) return duplicate(res, await store.getApproval(id), fingerprint);
    try {
      const sent = await chat.spaces.messages.create({ parent: approver.dmSpace, requestBody: message, messageId: "client-" + id.toLowerCase() });
      await store.updateDelivery(id, { deliveryStatus: "SENT", sentAt: new Date().toISOString(), messageName: sent.data?.name || null });
    } catch (error) {
      debug.log("APPLICATION_APPROVAL_ERROR", { id, clientId: req.serviceClient, error });
      // Google may have received the request even when its response did not reach us.
      await store.updateDelivery(id, { deliveryStatus: "FAILED", deliveryUpdatedAt: new Date().toISOString() });
      return res.status(502).json({ error: "Approval delivery could not be confirmed", ...view(await store.getApproval(id)) });
    }
    return res.status(201).json({ ...view(await store.getApproval(id)), duplicate: false });
  });
  app.get("/api/approvals/:id", auth.requireRole("application"), async (req, res) => {
    const approval = await store.getApproval(req.params.id);
    if (!approval || approval.clientId !== req.serviceClient) return res.status(404).json({ error: "Approval not found" });
    return res.json(view(approval));
  });
}
module.exports = { registerApplicationApi };
