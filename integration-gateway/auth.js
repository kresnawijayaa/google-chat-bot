const jwt = require("jsonwebtoken");
const { createHash, timingSafeEqual } = require("node:crypto");
const equal = (a,b) => timingSafeEqual(createHash("sha256").update(String(a || "")).digest(), createHash("sha256").update(String(b || "")).digest());
function createAuth({ secret, issuer, audience, clients }) {
  const ready = () => typeof secret === "string" && secret.length >= 32;
  const getClient = id => clients().find(client => client.id === id && client.secret?.length >= 32);
  function login(req, res) {
    res.set("Cache-Control", "no-store");
    if (!ready()) return res.status(503).json({error:"Service authentication is not configured"});
    const client = getClient(req.body?.client_id);
    if (!client || !equal(client.secret, req.body?.client_secret)) return res.status(401).json({error:"Invalid client credentials"});
    const token = jwt.sign({role:client.role}, secret, {algorithm:"HS256",issuer,audience,subject:client.id,expiresIn:600});
    return res.json({access_token:token,token_type:"Bearer",expires_in:600});
  }
  const requireRole = role => (req,res,next) => {
    res.set("Cache-Control", "no-store");
    if (!ready()) return res.status(503).json({error:"Service authentication is not configured"});
    try {
      const header = req.get("Authorization") || "";
      if (!header.startsWith("Bearer ")) throw Error("missing");
      const token = jwt.verify(header.slice(7),secret,{algorithms:["HS256"],issuer,audience});
      const client = getClient(token.sub);
      if (!client || token.role !== role || client.role !== role) return res.status(403).json({error:"Client does not have access to this endpoint"});
      req.serviceClient = client.id;
      next();
    } catch { return res.status(401).json({error:"Invalid or expired access token"}); }
  };
  return {login,requireRole};
}
module.exports = {createAuth};
