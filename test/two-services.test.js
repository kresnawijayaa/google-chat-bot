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
test("Demo through gateway: registration, token login, delivery, approve and reject",async()=>{
  const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048,privateKeyEncoding:{type:"pkcs8",format:"pem"},publicKeyEncoding:{type:"spki",format:"pem"}});
  const logs=[];
  const debugSink=line=>logs.push(JSON.parse(line));
  const store=memoryStore();
  await store.setAllowedUser("00042","approver@example.com","Approver");
  const callbackAudience="https://gateway.example.com/google-chat";
  const incomingEmail="addon@example.iam.gserviceaccount.com";
  const hubEnv={DEBUG_FLOW:"true",ADMIN_PASSWORD:secret("admin"),BRIDGE_SECRET:secret("bridge"),GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:"sender@example.iam.gserviceaccount.com",private_key:privateKey})};
  const gatewayEnv={DEBUG_FLOW:"true",BRIDGE_SECRET:secret("bridge"),PUBLIC_URL:"https://gateway.example.com",GOOGLE_ADDON_SERVICE_ACCOUNT_EMAIL:incomingEmail};
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
      assert.equal(new Headers(options.headers).get("Authorization"),"Bearer google-test-access");
      deliveries++;sent.push(JSON.parse(options.body));
      return Response.json({name:"spaces/dm/messages/test"});
    }
    return fetch(url,options);
  };
  const hub=await start(createHub({env:hubEnv,store,debugSink}));
  gatewayEnv.HUB_URL=hub.url;
  const verifyGoogleToken=async token=>jwt.verify(token,publicKey,{algorithms:["RS256"],audience:callbackAudience,issuer:"https://accounts.google.com"});
  const gateway=await start(createGateway({env:gatewayEnv,fetchImpl:transport,verifyGoogleToken,debugSink}));
  hubEnv.GATEWAY_URL=gateway.url;
  // Transport's service URL is read when constructed; re-create hub after binding gateway URL.
  await new Promise(r=>hub.server.close(r));
  const activeHub=await start(createHub({env:hubEnv,store,debugSink}));
  gatewayEnv.HUB_URL=activeHub.url;
  // Recreate gateway with the final hub URL, preserving the same local listen address.
  const gatewayPort=gateway.server.address().port;
  await new Promise(r=>gateway.server.close(r));
  const app=createGateway({env:gatewayEnv,fetchImpl:transport,verifyGoogleToken,debugSink});
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
    assert.equal((await jsonPost(gateway.url+"/auth/token",{client_id:"gchat-hub",client_secret:"wrong"})).status,401);
    const bridgeToken=await login(gateway.url,"gchat-hub",secret("bridge"));
    assert.equal((await jsonPost(activeHub.url+"/internal/google-chat",event("/regist"),bridgeToken)).status,401);
    const expiredBridge=jwt.sign({role:"hub"},hubEnv.BRIDGE_SECRET,{algorithm:"HS256",issuer:"integration-gateway",audience:"integration-gateway-api",subject:"gchat-hub",expiresIn:-1});
    assert.equal((await jsonPost(gateway.url+"/api/google/token",{},expiredBridge)).status,401);
    const headers={Authorization:"Basic "+Buffer.from("admin:"+hubEnv.ADMIN_PASSWORD).toString("base64"),"Content-Type":"application/x-www-form-urlencoded",Origin:activeHub.url};
    const form=new URLSearchParams({approverEmail:"approver@example.com",employeeName:"Budi",type:"Cuti",date:"12 Oktober 2026",reason:"Keluarga"});
    assert.equal((await fetch(activeHub.url+"/send-approval",{method:"POST",headers:{...headers,Origin:"https://other.example.com"},body:form})).status,403);
    // Local transport uses HTTP; card callbacks still require the public HTTPS gateway.
    // Construct a hub transport pointing locally while exposing the production callback origin.
    const {createGoogleTransport}=require("../gchat-hub/google-transport");
    const demoHub=await start(createHub({env:{...hubEnv,GATEWAY_URL:"https://gateway.example.com"},store,debugSink,chat:createGoogleTransport(hubEnv,fetch,require("../gchat-hub/debug").createDebug({env:hubEnv,service:"gchat-hub",sink:debugSink}))}));
    let approval;
    try {
      headers.Origin=demoHub.url;
      const response=await fetch(demoHub.url+"/send-approval",{method:"POST",headers,body:form});
      assert.equal(response.status,200);
      const history=await store.listApprovals({});
      approval=history.items[0];
      assert.equal(approval.deliveryStatus,"SENT");
    } finally {await new Promise(r=>demoHub.server.close(r));}
    assert.equal(deliveries,1);
    const callback=sent[0].cardsV2[0].card.sections[0].widgets.at(-1).buttonList.buttons[0].onClick.action.function;
    assert.equal(callback,callbackAudience);
    const click={commonEventObject:{parameters:{action:"approve",approvalId:approval.id}},chat:{user:{email:"approver@example.com"},buttonClickedPayload:{}}};
    const result=await (await jsonPost(gateway.url+"/google-chat",click,valid)).json();
    assert.ok(result.hostAppDataAction.chatDataAction.updateMessageAction);
    assert.equal((await store.listApprovals({})).items[0].status,"APPROVED");
    // A second decision cannot overwrite an approval.
    click.commonEventObject.parameters.action="decline";
    await jsonPost(gateway.url+"/google-chat",click,valid);
    assert.equal((await store.listApprovals({})).items[0].status,"APPROVED");
    await store.setApproval("reject-demo",{id:"reject-demo",approverEmail:"approver@example.com",status:"PENDING"});
    click.commonEventObject.parameters.approvalId="reject-demo";
    await jsonPost(gateway.url+"/google-chat",click,valid);
    assert.equal((await store.listApprovals({status:"DECLINED"})).total,1);
    for (const page of ["/users","/approvals","/approval-demo"]) {
      assert.equal((await fetch(activeHub.url+page,{headers:{Authorization:headers.Authorization}})).status,200);
    }
    assert.equal((await fetch(activeHub.url+"/approval-demo")).status,401);
    const outboundToken=await login(gateway.url,"gchat-hub",secret("bridge"));
    assert.equal((await jsonPost(gateway.url+"/api/google/messages",{parent:"https://attacker.example.com",message:{text:"x"},googleAccessToken:"fake"},outboundToken)).status,400);
    assert.ok(logs.some(line=>line.step==="LOGIN_SUCCESS"));
    assert.ok(logs.some(line=>line.step==="GOOGLE_ID_TOKEN_VERIFIED"));
    assert.ok(logs.some(line=>line.step==="STORE_RESULT" && line.operation==="decide" && line.output.approval?.status==="APPROVED"));
    assert.ok(logs.some(line=>line.step==="FETCH_SEND" && line.url.startsWith("https://chat.googleapis.com/")));
    const callbackSend=logs.find(line=>line.step==="FETCH_SEND" && line.url===activeHub.url+"/internal/google-chat");
    assert.ok(logs.some(line=>line.service==="gchat-hub" && line.step==="HTTP_IN" && line.requestId===callbackSend.requestId));

    // Source application API uses the actual hub -> gateway -> Google mock transport.
    const appHub=await start(createHub({
      env:{...hubEnv,GATEWAY_URL:"https://gateway.example.com",APP_CLIENTS_JSON:JSON.stringify([{id:"source-app",secret:secret("source-app")}])},
      store,debugSink,
      chat:createGoogleTransport(hubEnv,fetch,require("../gchat-hub/debug").createDebug({env:hubEnv,service:"gchat-hub",sink:debugSink}))
    }));
    try {
      const sourceToken=await login(appHub.url,"source-app",secret("source-app"));
      const response=await jsonPost(appHub.url+"/api/approvals",{requestId:"SOURCE-001",approverNik:"00042",employeeName:"Budi",type:"Cuti",date:"Today"},sourceToken);
      assert.equal(response.status,201);const sourceApproval=await response.json();
      assert.equal(sourceApproval.deliveryStatus,"SENT");assert.equal(deliveries,2);
      const callbackEvent={commonEventObject:{parameters:{approvalId:sourceApproval.id,action:"decline"}},chat:{user:{email:"approver@example.com"},buttonClickedPayload:{}}};
      assert.equal((await jsonPost(gateway.url+"/google-chat",callbackEvent,valid)).status,200);
      const status=await (await fetch(appHub.url+"/api/approvals/"+sourceApproval.id,{headers:{Authorization:"Bearer "+sourceToken}})).json();
      assert.equal(status.status,"DECLINED");assert.equal(status.decidedBy,"approver@example.com");
    } finally {await new Promise(r=>appHub.server.close(r));}

    const serialized=JSON.stringify(logs);
    for (const hidden of [hubEnv.BRIDGE_SECRET,hubEnv.ADMIN_PASSWORD,privateKey,valid,bridgeToken,"google-test-access"]) assert.ok(!serialized.includes(hidden));
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

test("Application API: separate credentials, NIK approval, idempotent delivery, status ownership and callback",async()=>{
  const logs=[];
  const env={BRIDGE_SECRET:secret("bridge"),ADMIN_PASSWORD:secret("admin"),GATEWAY_URL:"https://gateway.example.com",APP_CLIENTS_JSON:JSON.stringify([{id:"cuti",secret:secret("cuti")},{id:"lembur",secret:secret("lembur")}])};
  const store=memoryStore();
  await store.setUser("approver@example.com",{email:"approver@example.com",nik:"00042",dmSpace:"spaces/dm"});
  let deliveries=0;
  const chat={spaces:{messages:{create:async()=>{deliveries++;await new Promise(r=>setTimeout(r,10));return {data:{name:"spaces/dm/messages/test"}};}}}};
  const hub=await start(createHub({env,store,chat,debugSink:line=>logs.push(line)}));
  try {
    assert.equal((await jsonPost(hub.url+"/auth/token",{client_id:"cuti",client_secret:"wrong"})).status,401);
    const token=await login(hub.url,"cuti",secret("cuti"));
    const other=await login(hub.url,"lembur",secret("lembur"));
    const body={requestId:"CUTI-001",approverNik:"00042",employeeName:"Budi",type:"Cuti",date:"12 Oktober 2026",reason:"Keluarga"};
    assert.equal((await jsonPost(hub.url+"/api/approvals",body)).status,401);
    assert.equal((await jsonPost(hub.url+"/api/approvals",{...body,approverNik:42},token)).status,400);
    assert.equal((await jsonPost(hub.url+"/api/approvals",{...body,approverNik:"99999"},token)).status,422);
    const results=await Promise.all([jsonPost(hub.url+"/api/approvals",body,token),jsonPost(hub.url+"/api/approvals",body,token)]);
    assert.deepEqual(results.map(res=>res.status).sort(),[200,201]);
    const records=await Promise.all(results.map(res=>res.json()));
    const id=records[0].id;
    assert.equal(records[1].id,id);
    assert.equal(deliveries,1);
    assert.equal((await jsonPost(hub.url+"/api/approvals",{...body,reason:"Different"},token)).status,409);
    assert.equal((await fetch(hub.url+"/api/approvals/"+id,{headers:{Authorization:"Bearer "+other}})).status,404);
    const own=await fetch(hub.url+"/api/approvals/"+id,{headers:{Authorization:"Bearer "+token}});
    assert.equal(own.status,200);
    assert.equal((await own.json()).deliveryStatus,"SENT");
    assert.equal((await jsonPost(hub.url+"/internal/google-chat",{},token)).status,401);
    const claims=jwt.decode(token);
    const jwtKey=require("node:crypto").createHmac("sha256",env.BRIDGE_SECRET).update("gchat-hub-application-api-v1").digest("hex");
    const expired=jwt.sign({role:"application"},jwtKey,{algorithm:"HS256",issuer:claims.iss,audience:claims.aud,subject:claims.sub,expiresIn:-1});
    assert.equal((await jsonPost(hub.url+"/api/approvals",body,expired)).status,401);
    const relay=jwt.sign({role:"gateway"},env.BRIDGE_SECRET,{algorithm:"HS256",issuer:"integration-gateway",audience:"gchat-hub-events",subject:"integration-gateway",expiresIn:60});
    const click={commonEventObject:{parameters:{approvalId:id,action:"approve"}},chat:{user:{email:"approver@example.com"},buttonClickedPayload:{}}};
    assert.equal((await jsonPost(hub.url+"/internal/google-chat",click,relay)).status,200);
    const decision=await (await fetch(hub.url+"/api/approvals/"+id,{headers:{Authorization:"Bearer "+token}})).json();
    assert.equal(decision.status,"APPROVED");assert.equal(decision.decidedBy,"approver@example.com");assert.ok(decision.decidedAt);
    // A retry still returns the same result after the registered user is deleted.
    await store.deleteUser("approver@example.com");
    const repeated=await jsonPost(hub.url+"/api/approvals",body,token);
    assert.equal(repeated.status,200);assert.equal((await repeated.json()).status,"APPROVED");assert.equal(deliveries,1);
    const exampleClient=require("../examples/hub-client.cjs").createHubClient({baseUrl:hub.url,clientId:"cuti",clientSecret:secret("cuti")});
    assert.equal((await exampleClient.getApproval(id)).status,"APPROVED");
    assert.equal((await exampleClient.sendApproval(body)).duplicate,true);
    await assert.rejects(exampleClient.sendApproval({...body,type:"Other"}),error=>error.status===409 && error.response.id===id);
    // Removing a client closes access for its existing token.
    env.APP_CLIENTS_JSON=JSON.stringify([{id:"lembur",secret:secret("lembur")}]);
    assert.equal((await fetch(hub.url+"/api/approvals/"+id,{headers:{Authorization:"Bearer "+token}})).status,403);
  } finally {await new Promise(r=>hub.server.close(r));}
});
test("Application API fails closed on missing or invalid configuration",async()=>{
 for(const clients of ["[]","invalid",'[{"id":"duplicate","secret":"short"}]']) {
  const hub=await start(createHub({env:{BRIDGE_SECRET:secret("bridge"),APP_CLIENTS_JSON:clients},store:memoryStore(),chat:{}}));
  try {assert.equal((await jsonPost(hub.url+"/auth/token",{})).status,503);assert.equal((await jsonPost(hub.url+"/api/approvals",{})).status,503);}
  finally {await new Promise(r=>hub.server.close(r));}
 }
});
test("Failed delivery remains queryable and is not resent by retrying requestId",async()=>{
 const env={BRIDGE_SECRET:secret("bridge"),GATEWAY_URL:"https://gateway.example.com",APP_CLIENTS_JSON:JSON.stringify([{id:"cuti",secret:secret("cuti")}])};
 const store=memoryStore();await store.setUser("approver@example.com",{email:"approver@example.com",nik:"00042",dmSpace:"spaces/dm"});
 let count=0;const chat={spaces:{messages:{create:async()=>{count++;throw Error("mock unavailable");}}}};
 const hub=await start(createHub({env,store,chat}));
 try {
  const token=await login(hub.url,"cuti",secret("cuti"));const body={requestId:"FAIL-001",approverNik:"00042",employeeName:"Budi",type:"Cuti",date:"Today"};
  const failed=await jsonPost(hub.url+"/api/approvals",body,token);assert.equal(failed.status,502);const result=await failed.json();assert.equal(result.deliveryStatus,"FAILED");
  const retry=await jsonPost(hub.url+"/api/approvals",body,token);assert.equal(retry.status,200);assert.equal((await retry.json()).deliveryStatus,"FAILED");assert.equal(count,1);
 } finally {await new Promise(r=>hub.server.close(r));}
});
