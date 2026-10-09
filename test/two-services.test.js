const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname,"..");
const hubRequire=createRequire(path.join(root,"gchat-hub/package.json"));
const gatewayRequire=createRequire(path.join(root,"integration-gateway/package.json"));
const jwt=hubRequire("jsonwebtoken");
const {createApp:createHub}=require("../gchat-hub");
const {createApp:createGateway}=require("../integration-gateway");
function memoryStore() {
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,"gchat-hub/store.js"),"utf8"),{module,process:{env:{}},require:hubRequire,Map,Date});
  return module.exports;
}
async function start(app) {
  const server=app.listen(0,"127.0.0.1");
  await new Promise(r=>server.once("listening",r));
  return {server,url:"http://127.0.0.1:"+server.address().port};
}
const secret = name => (name+"-").padEnd(40,"x");
const jsonPost = (url,body,token) => fetch(url,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},body:JSON.stringify(body)});
async function login(url,id,password) {
  const response=await jsonPost(url+"/auth/token",{client_id:id,client_secret:password});
  assert.equal(response.status,200);
  return (await response.json()).access_token;
}
test("Hub and gateway: verified callbacks, authorized apps, outgoing Google transport, isolation and acknowledgment",async()=>{
  const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048,privateKeyEncoding:{type:"pkcs8",format:"pem"},publicKeyEncoding:{type:"spki",format:"pem"}});
  const store=memoryStore();
  await store.setAllowedUser("00042","approver@example.com","Approver");
  const callbackAudience="https://gateway.example.com/google-chat";
  const incomingEmail="addon@example.iam.gserviceaccount.com";
  const hubEnv={ADMIN_PASSWORD:secret("admin"),TOKEN_SECRET:secret("hub-jwt"),GATEWAY_RELAY_SECRET:secret("relay"),GATEWAY_CLIENT_SECRET:secret("outbound"),GATEWAY_PUBLIC_URL:"https://gateway.example.com",GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:"sender@example.iam.gserviceaccount.com",private_key:privateKey}),INTEGRATION_CLIENTS_JSON:JSON.stringify([{id:"cuti",secret:secret("cuti")},{id:"lembur",secret:secret("lembur")}])};
  const gatewayEnv={TOKEN_SECRET:secret("gateway-jwt"),HUB_CLIENT_SECRET:secret("outbound"),HUB_RELAY_CLIENT_SECRET:secret("relay"),GOOGLE_CALLBACK_AUDIENCE:callbackAudience,GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL:incomingEmail};
  let deliveries=0;
  const sent=[];
  const transport=async(url,options)=>{
    if(url==="https://oauth2.googleapis.com/token") {
      const assertion=options.body.get("assertion");
      const payload=jwt.verify(assertion,publicKey,{algorithms:["RS256"],audience:url,issuer:"sender@example.iam.gserviceaccount.com"});
      assert.equal(payload.scope,"https://www.googleapis.com/auth/chat.bot");
      return Response.json({access_token:"google-test-access",expires_in:3600});
    }
    if(url.startsWith("https://chat.googleapis.com/v1/")) {
      assert.equal(options.headers.Authorization,"Bearer google-test-access");
      deliveries++;sent.push(JSON.parse(options.body));
      return Response.json({name:"spaces/dm/messages/test"});
    }
    return fetch(url,options);
  };
  const hub=await start(createHub({env:hubEnv,store}));
  gatewayEnv.HUB_URL=hub.url;
  const verifyGoogleToken=async token=>jwt.verify(token,publicKey,{algorithms:["RS256"],audience:callbackAudience,issuer:"https://accounts.google.com"});
  const gateway=await start(createGateway({env:gatewayEnv,fetchImpl:transport,verifyGoogleToken}));
  hubEnv.GATEWAY_URL=gateway.url;
  // Transport's service URL is read when constructed; re-create hub after binding gateway URL.
  await new Promise(r=>hub.server.close(r));
  const activeHub=await start(createHub({env:hubEnv,store}));
  gatewayEnv.HUB_URL=activeHub.url;
  // Recreate gateway with the final hub URL, preserving the same local listen address.
  const gatewayPort=gateway.server.address().port;
  await new Promise(r=>gateway.server.close(r));
  const app=createGateway({env:gatewayEnv,fetchImpl:transport,verifyGoogleToken});
  const gatewayServer=app.listen(gatewayPort,"127.0.0.1");
  await new Promise(r=>gatewayServer.once("listening",r));
  const googleToken=claims=>jwt.sign({email:incomingEmail,email_verified:true,...claims},privateKey,{algorithm:"RS256",issuer:"https://accounts.google.com",audience:callbackAudience,expiresIn:300});
  const event=text=>({chat:{user:{email:"approver@example.com",name:"users/42"},space:{name:"spaces/dm",spaceType:"DIRECT_MESSAGE"},messagePayload:{message:{text}}}});
  try {
    assert.equal((await jsonPost(activeHub.url+"/internal/google-chat",event("/regist"))).status,401);
    assert.equal((await jsonPost(gateway.url+"/google-chat",event("/regist"))).status,401);
    assert.equal((await jsonPost(gateway.url+"/google-chat",event("/regist"),"fake")).status,401);
    assert.equal((await jsonPost(gateway.url+"/google-chat",event("/regist"),googleToken({email:"other@example.com"}))).status,403);
    const wrongAudience=jwt.sign({email:incomingEmail,email_verified:true},privateKey,{algorithm:"RS256",issuer:"https://accounts.google.com",audience:"https://wrong.example.com",expiresIn:300});
    assert.equal((await jsonPost(gateway.url+"/google-chat",event("/regist"),wrongAudience)).status,401);
    const expired=jwt.sign({email:incomingEmail,email_verified:true},privateKey,{algorithm:"RS256",issuer:"https://accounts.google.com",audience:callbackAudience,expiresIn:-1});
    assert.equal((await jsonPost(gateway.url+"/google-chat",event("/regist"),expired)).status,401);
    const valid=googleToken({});
    assert.match(JSON.stringify(await (await jsonPost(gateway.url+"/google-chat",event("/regist"),valid)).json()),/Silakan kirim NIK/);
    assert.match(JSON.stringify(await (await jsonPost(gateway.url+"/google-chat",event("00042"),valid)).json()),/Pendaftaran berhasil/);
    assert.equal((await store.getUser("approver@example.com")).nik,"00042");
    assert.equal((await jsonPost(activeHub.url+"/auth/token",{client_id:"cuti",client_secret:"wrong"})).status,401);
    const cuti=await login(activeHub.url,"cuti",secret("cuti"));
    const lembur=await login(activeHub.url,"lembur",secret("lembur"));
    const expiredApp=jwt.sign({role:"application"},hubEnv.TOKEN_SECRET,{algorithm:"HS256",issuer:"gchat-hub",audience:"gchat-hub-api",subject:"cuti",expiresIn:-1});
    assert.equal((await fetch(activeHub.url+"/api/decisions",{headers:{Authorization:"Bearer "+expiredApp}})).status,401);
    assert.equal((await jsonPost(activeHub.url+"/internal/google-chat",event("/regist"),cuti)).status,403);
    assert.equal((await jsonPost(gateway.url+"/api/google/messages",{},cuti)).status,401);
    const request={requestId:"CUTI-001",approverNik:"00042",employeeName:"Budi",type:"Cuti",date:"12 Oktober 2026",reason:"Keluarga"};
    const response=await jsonPost(activeHub.url+"/api/approvals",request,cuti);
    assert.equal(response.status,201);
    const approval=await response.json();
    assert.equal(deliveries,1);
    const callback=sent[0].cardsV2[0].card.sections[0].widgets.at(-1).buttonList.buttons[0].onClick.action.function;
    assert.equal(callback,callbackAudience);
    const duplicate=await jsonPost(activeHub.url+"/api/approvals",request,cuti);
    assert.equal((await duplicate.json()).duplicate,true);
    assert.equal(deliveries,1);
    assert.equal((await jsonPost(activeHub.url+"/api/approvals",{...request,employeeName:"Different"},cuti)).status,409);
    assert.equal((await fetch(activeHub.url+"/api/approvals/"+approval.id,{headers:{Authorization:"Bearer "+lembur}})).status,404);
    assert.equal((await jsonPost(activeHub.url+"/api/decisions/"+approval.id+"/ack",{},cuti)).status,404);
    const click={commonEventObject:{parameters:{action:"approve",approvalId:approval.id}},chat:{user:{email:"approver@example.com"},buttonClickedPayload:{}}};
    const result=await (await jsonPost(gateway.url+"/google-chat",click,valid)).json();
    assert.ok(result.hostAppDataAction.chatDataAction.updateMessageAction);
    assert.equal((await store.getApproval(approval.id)).status,"APPROVED");
    const pending=await (await fetch(activeHub.url+"/api/decisions",{headers:{Authorization:"Bearer "+cuti}})).json();
    assert.equal(pending.items.length,1);
    assert.equal((await jsonPost(activeHub.url+"/api/decisions/"+approval.id+"/ack",{},lembur)).status,404);
    assert.equal((await jsonPost(activeHub.url+"/api/decisions/"+approval.id+"/ack",{},cuti)).status,200);
    assert.equal((await jsonPost(activeHub.url+"/api/decisions/"+approval.id+"/ack",{},cuti)).status,200);
    assert.equal((await store.listPendingDecisions("cuti")).length,0);
    assert.equal((await fetch(activeHub.url+"/approval-demo")).status,401);
    const outboundToken=await login(gateway.url,"gchat-hub",secret("outbound"));
    assert.equal((await jsonPost(gateway.url+"/api/google/messages",{parent:"https://attacker.example.com",message:{text:"x"},googleAccessToken:"fake"},outboundToken)).status,400);
  } finally {await new Promise(r=>gatewayServer.close(r));await new Promise(r=>activeHub.server.close(r));}
});
test("Unconfigured gateway rejects callbacks and transport instead of allowing anonymous access",async()=>{
  const {server,url}=await start(createGateway({env:{}}));
  try {
    assert.equal((await jsonPost(url+"/google-chat",{})).status,503);
    assert.equal((await jsonPost(url+"/api/google/token",{})).status,503);
    assert.equal((await jsonPost(url+"/auth/token",{})).status,503);
  } finally {await new Promise(r=>server.close(r));}
});
