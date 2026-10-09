const express = require("express");
const { createDebug } = require("./debug");
const { OAuth2Client } = require("google-auth-library");
const { createAuth } = require("./auth");
const jwt = require("jsonwebtoken");
function createApp({ env = process.env, fetchImpl = fetch, debugSink, verifyGoogleToken } = {}) {
  const app = express();
  const debug = createDebug({env,service:"integration-gateway",sink:debugSink});
  fetchImpl = debug.wrapFetch(fetchImpl);
  app.use(debug.middleware);
  app.use(express.json({limit:"128kb"}));
  app.use(debug.payload);
  const auth = createAuth({secret:env.BRIDGE_SECRET,issuer:"integration-gateway",audience:"integration-gateway-api",clients:()=>[{id:"gchat-hub",secret:env.BRIDGE_SECRET,role:"hub"}],debug});
  // One shared secret for this demo; separate audiences keep transport and relay tokens distinct.
  async function relay(body) {
    if (!env.BRIDGE_SECRET || env.BRIDGE_SECRET.length < 32) throw Error("Bridge secret missing");
    const url = new URL(env.HUB_URL);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost","127.0.0.1"].includes(url.hostname)))) throw Error("Invalid hub URL");
    debug.log("RELAY_TOKEN_CREATE", {destination:url.origin + "/internal/google-chat",expiresIn:60});
    const token = jwt.sign({role:"gateway"},env.BRIDGE_SECRET,{algorithm:"HS256",issuer:"integration-gateway",audience:"gchat-hub-events",subject:"integration-gateway",expiresIn:60});
    const response = await fetchImpl(url.origin + "/internal/google-chat",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:"error"});
    if (!response.ok) throw Error("Hub unavailable");
    return response.json();
  }
  const callbackAudience = (env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/$/, "") + "/google-chat" : "");
  const googleAuth = new OAuth2Client();
  const verify = verifyGoogleToken || (async token => {
    const ticket = await googleAuth.verifyIdToken({idToken:token,audience:callbackAudience});
    return ticket.getPayload();
  });
  app.get("/",(req,res)=>res.json({service:"integration-gateway",status:"running"}));
  app.post("/auth/token",auth.login);
  app.post("/google-chat",async(req,res)=>{
    res.set("Cache-Control","no-store");
    if(!callbackAudience || !env.GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL) return res.status(503).json({error:"Google request verification is not configured"});
    const header=req.get("Authorization") || "";
    if(!header.startsWith("Bearer ")) return res.status(401).json({error:"Google ID token required"});
    try {
      const claims=await verify(header.slice(7));
      if(claims.email_verified!==true || claims.email!==env.GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL) return res.status(403).json({error:"Unexpected Google add-on identity"});
      debug.log("GOOGLE_ID_TOKEN_VERIFIED", {email:claims.email,audience:claims.aud,expiresAt:claims.exp});
    } catch (error) {debug.log("GOOGLE_ID_TOKEN_REJECTED", {error});return res.status(401).json({error:"Invalid Google ID token"});}
    try {res.json(await relay(req.body));}
    catch (error) {debug.log("RELAY_ERROR", {error});res.status(502).json({error:"Notification hub unavailable"});}
  });
  app.post("/api/google/token",auth.requireRole("hub"),async(req,res)=>{
    if(typeof req.body?.assertion!=="string" || req.body.assertion.length>16000) return res.status(400).json({error:"JWT assertion required"});
    try {
      const response=await fetchImpl("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:req.body.assertion}),signal:AbortSignal.timeout(10000),redirect:"error"});
      if(!response.ok) return res.status(502).json({error:"Google token exchange failed"});
      return res.json(await response.json());
    } catch {return res.status(502).json({error:"Google token exchange unavailable"});}
  });
  app.post("/api/google/messages",auth.requireRole("hub"),async(req,res)=>{
    const {parent,message,googleAccessToken,messageId}=req.body || {};
    if(typeof parent!=="string" || !/^spaces\/[A-Za-z0-9_-]+$/.test(parent) || !message || typeof message!=="object" || Array.isArray(message) || typeof googleAccessToken!=="string" || !googleAccessToken) return res.status(400).json({error:"Invalid message transport request"});
    if(messageId && !/^client-[a-z0-9-]{1,56}$/.test(messageId)) return res.status(400).json({error:"Invalid message ID"});
    const url="https://chat.googleapis.com/v1/"+parent+"/messages"+(messageId?"?messageId="+encodeURIComponent(messageId):"");
    try {
      const response=await fetchImpl(url,{method:"POST",headers:{Authorization:"Bearer "+googleAccessToken,"Content-Type":"application/json"},body:JSON.stringify(message),signal:AbortSignal.timeout(10000),redirect:"error"});
      if(response.status===409 && messageId) {
        const existing=await fetchImpl("https://chat.googleapis.com/v1/"+parent+"/messages/"+messageId,{headers:{Authorization:"Bearer "+googleAccessToken},signal:AbortSignal.timeout(10000),redirect:"error"});
        if(existing.ok) return res.json(await existing.json());
      }
      if(!response.ok) return res.status(502).json({error:"Google Chat rejected the message"});
      return res.json(await response.json());
    } catch {return res.status(502).json({error:"Google Chat unavailable"});}
  });
  app.use((error,req,res,next)=>{debug.log("REQUEST_ERROR", {error});res.status(error.status===400?400:500).json({error:"Request could not be processed"});});
  return app;
}
const app=createApp();
if(require.main===module && !process.env.VERCEL) app.listen(Number(process.env.PORT || 3002),()=>console.log("Integration Gateway listening"));
module.exports=app;
module.exports.createApp=createApp;
