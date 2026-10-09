const jwt = require("jsonwebtoken");
const { createDebug } = require("./debug");
const { createServiceClient } = require("./service-client");
function createGoogleTransport(env, fetchImpl = fetch, debug = createDebug({env,service:"gchat-hub"})) {
  fetchImpl = debug.wrapFetch(fetchImpl);
  const gateway=createServiceClient({baseUrl:env.GATEWAY_URL,clientId:"gchat-hub",clientSecret:env.BRIDGE_SECRET,fetchImpl,debug});
  let token, expires=0;
  async function googleToken() {
    if(token && expires>Date.now()) {debug.log("GOOGLE_TOKEN_CACHE", {expiresAt:new Date(expires).toISOString()});return token;}
    const credentials=JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}");
    if(!credentials.private_key || !credentials.client_email) throw Error("Google service account is not configured");
    debug.log("GOOGLE_ASSERTION_CREATE", {clientEmail:credentials.client_email,scope:"https://www.googleapis.com/auth/chat.bot"});
    const assertion=jwt.sign({scope:"https://www.googleapis.com/auth/chat.bot"},credentials.private_key,{algorithm:"RS256",issuer:credentials.client_email,audience:"https://oauth2.googleapis.com/token",expiresIn:3600,...(credentials.private_key_id?{keyid:credentials.private_key_id}:{})});
    const response=await gateway.post("/api/google/token",{assertion});
    if(!response.access_token) throw Error("Google access token unavailable");
    token=response.access_token; expires=Date.now()+Math.max(0,Number(response.expires_in || 0)-60)*1000;
    return token;
  }
  return {spaces:{messages:{create:async({parent,requestBody,messageId})=>({data:await gateway.post("/api/google/messages",{parent,message:requestBody,messageId,googleAccessToken:await googleToken()})})}}};
}
module.exports={createGoogleTransport};
