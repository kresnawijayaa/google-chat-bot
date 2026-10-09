const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createDebug}=require('../gchat-hub/debug');
test('Debug masks credentials in payloads, forms, errors and HTML',async()=>{
 const lines=[];
 const debug=createDebug({env:{DEBUG_FLOW:'true',BRIDGE_SECRET:'secret-string-for-test-only',ADMIN_PASSWORD:'password-for-test',APP_CLIENTS_JSON:JSON.stringify([{id:'cuti',secret:'hidden-app-client-secret-32-characters'}])},service:'test',sink:line=>lines.push(JSON.parse(line))});
 debug.log('CHECK',{body:{client_secret:'hidden-client',access_token:'hidden-access',nested:{googleAccessToken:'hidden-google',private_key:'hidden-key'}},message:'Authorization Bearer hidden-auth; secret-string-for-test-only',url:'/path?token=hidden-query',html:'<input name="token" value="hidden-confirmation">',raw:'{"access_token":"hidden-raw-token",broken',error:new Error('password-for-test; hidden-app-client-secret-32-characters')});
 const fetcher=debug.wrapFetch(async()=>Response.json({access_token:'hidden-response',expires_in:600}));
 const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({assertion:'hidden-assertion',grant_type:'jwt-bearer'})});
 assert.equal((await response.json()).access_token,'hidden-response');
 const output=JSON.stringify(lines);
 for(const secret of ['hidden-app-client-secret-32-characters','hidden-raw-token','hidden-client','hidden-access','hidden-google','hidden-key','hidden-auth','hidden-query','hidden-confirmation','password-for-test','secret-string-for-test-only','hidden-assertion','hidden-response']) assert.ok(!output.includes(secret),secret);
 assert.match(output,/REDACTED/);
});
test('Disabled debug preserves store and fetch without emitting logs',()=>{
 const lines=[];const debug=createDebug({env:{},service:'test',sink:line=>lines.push(line)});
 const store={};const fetcher=()=>{};
 assert.equal(debug.wrapStore(store),store);assert.equal(debug.wrapFetch(fetcher),fetcher);
 debug.log('CHECK',{body:{message:'hello'}});assert.equal(lines.length,0);
});
