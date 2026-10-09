const { AsyncLocalStorage } = require("node:async_hooks");
const { randomUUID } = require("node:crypto");
function createDebug({ env = process.env, service, sink = line => console.log(line) }) {
  const enabled = env.DEBUG_FLOW === "true";
  const context = new AsyncLocalStorage();
  const sensitiveKey = /authorization|cookie|password|secret|token|assertion|private.?key|credential|database.?url/i;
  const knownSecrets = Object.entries(env).filter(([key,value]) => sensitiveKey.test(key) && typeof value === "string" && value.length >= 8).map(([,value]) => value);
  try {
    const key = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}").private_key;
    if (key) knownSecrets.push(key);
  } catch {}
  try {
    const clients = JSON.parse(env.APP_CLIENTS_JSON || "[]");
    if (Array.isArray(clients)) for (const client of clients) if (typeof client?.secret === "string" && client.secret.length >= 8) knownSecrets.push(client.secret);
  } catch {}
  function cleanString(value) {
    let text = String(value);
    for (const secret of knownSecrets) text = text.split(secret).join("[REDACTED]");
    return text
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
      .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]+/gi, "[REDACTED AUTH]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED JWT]")
      .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[REDACTED DATABASE URL]")
      .replace(/(name="token"\s+value=")[^"]*/gi, '$1[REDACTED]')
      .replace(/([?&](?:[^=&]*(?:token|secret|password|assertion|credential)[^=&]*)=)[^&#\s]*/gi, "$1[REDACTED]")
      .replace(/("[^"\n]*(?:token|secret|password|assertion|private.?key|credential)[^"\n]*"\s*:\s*")((?:\\.|[^"\\])*)"/gi, '$1[REDACTED]"')
      .slice(0, 12000);
  }
  function sanitize(value, depth = 0) {
    if (depth > 15) return "[DEPTH LIMIT]";
    if (value instanceof Error) return { name: value.name, message: cleanString(value.message) };
    if (typeof value === "string") return cleanString(value);
    if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, depth + 1));
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).slice(0, 100).map(([key,item]) => [key, sensitiveKey.test(key) ? "[REDACTED]" : sanitize(item, depth + 1)])
    );
    return value;
  }
  function log(step, data = {}) {
    if (!enabled) return;
    try {
      sink(JSON.stringify({ time: new Date().toISOString(), service, requestId: context.getStore()?.requestId || null, step, ...sanitize(data) }));
    } catch {} // Debug output must never interrupt application work.
  }
  function parseBody(body, contentType = "") {
    if (body instanceof URLSearchParams) return Object.fromEntries(body);
    if (typeof body !== "string") return body;
    try { return JSON.parse(body); } catch {}
    if (contentType.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(body));
    return body;
  }
  function middleware(req, res, next) {
    if (!enabled) return next();
    const supplied = req.get("X-Request-ID") || "";
    const requestId = /^[A-Za-z0-9_-]{8,80}$/.test(supplied) ? supplied : randomUUID();
    context.run({ requestId }, () => {
      const started = Date.now();
      res.set("X-Request-ID", requestId);
      log("HTTP_IN", { method: req.method, url: req.originalUrl, headers: { authorization: req.get("Authorization"), contentType: req.get("Content-Type") } });
      let responseBody;
      const originalJson = res.json, originalSend = res.send;
      res.json = function(body) { responseBody = body; return originalJson.call(this, body); };
      res.send = function(body) { responseBody = parseBody(body); return originalSend.call(this, body); };
      res.once("finish", () => log("HTTP_OUT", { method: req.method, url: req.originalUrl, status: res.statusCode, durationMs: Date.now() - started, body: responseBody, location: res.get("Location") }));
      res.once("close", () => { if (!res.writableFinished) log("HTTP_ABORTED", { method: req.method, url: req.originalUrl }); });
      next();
    });
  }
  function payload(req, res, next) { log("PAYLOAD_IN", { body: req.body }); next(); }
  function wrapFetch(fetchImpl = fetch) {
    if (!enabled) return fetchImpl;
    return async (url, options = {}) => {
      const started = Date.now();
      const headers = new Headers(options.headers);
      const requestId = context.getStore()?.requestId;
      // Correlate our services; do not send a custom tracking header to Google.
      if (requestId && new URL(url).hostname !== "oauth2.googleapis.com" && new URL(url).hostname !== "chat.googleapis.com") headers.set("X-Request-ID", requestId);
      log("FETCH_SEND", { method: options.method || "GET", url: String(url), headers: Object.fromEntries(headers), body: parseBody(options.body, headers.get("Content-Type") || "") });
      try {
        const response = await fetchImpl(url, { ...options, headers: Object.fromEntries(headers) });
        let body;
        try {
          // Bound debug response reads; application receives the untouched original response.
          const reader = response.clone().body?.getReader();
          if (reader) {
            const chunks = []; let bytes = 0;
            while (bytes < 20000) {
              const part = await reader.read(); if (part.done) break;
              const size = Math.min(part.value.length, 20000 - bytes);
              chunks.push(Buffer.from(part.value.subarray(0, size))); bytes += size;
            }
            if (bytes >= 20000) void reader.cancel().catch(() => {});
            body = parseBody(Buffer.concat(chunks).toString("utf8"), response.headers.get("Content-Type") || "");
          }
        } catch { body = "[Response preview unavailable]"; }
        log("FETCH_RESULT", { url: String(url), status: response.status, durationMs: Date.now() - started, body });
        return response;
      } catch (error) { log("FETCH_ERROR", { url: String(url), durationMs: Date.now() - started, error }); throw error; }
    };
  }
  function wrapStore(store) {
    if (!enabled) return store;
    return new Proxy(store, { get(target, key) {
      const method = target[key];
      if (typeof method !== "function") return method;
      return async (...args) => {
        log("STORE_CALL", { operation: String(key), input: args });
        try { const result = await method.apply(target, args); log("STORE_RESULT", { operation: String(key), output: result }); return result; }
        catch (error) { log("STORE_ERROR", { operation: String(key), error }); throw error; }
      };
    } });
  }
  return { enabled, log, middleware, payload, wrapFetch, wrapStore, sanitize };
}
module.exports = { createDebug };
