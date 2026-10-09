// Server-side example, Node.js 22+. Never put credentials in browser JavaScript.
function createHubClient({ baseUrl, clientId, clientSecret, fetchImpl = fetch }) {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost","127.0.0.1"].includes(url.hostname)))) throw Error("Invalid hub URL");
  if (!clientId || !clientSecret) throw Error("Configure HUB_CLIENT_ID and HUB_CLIENT_SECRET");
  let token, expiresAt = 0;
  function failure(response, body) {
    const error = new Error(body.error || "Hub request failed");
    error.status = response.status;
    error.response = body; // Includes id after an uncertain delivery; preserve it for status checks.
    return error;
  }
  async function login() {
    if (token && expiresAt > Date.now()) return token;
    const response = await fetchImpl(url.origin + "/auth/token", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({client_id:clientId,client_secret:clientSecret}),
      signal:AbortSignal.timeout(8000), redirect:"error",
    });
    const body=await response.json();
    if (!response.ok) throw failure(response,body);
    token=body.access_token; expiresAt=Date.now()+Math.max(0,body.expires_in-30)*1000;
    return token;
  }
  async function request(method,path,body,retry=true) {
    const response=await fetchImpl(url.origin+path,{
      method,headers:{Authorization:"Bearer "+await login(),"Content-Type":"application/json"},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(15000),redirect:"error",
    });
    if(response.status===401 && retry) {token=null;return request(method,path,body,false);}
    const result=await response.json();
    if(!response.ok) throw failure(response,result);
    return result;
  }
  return {
    sendApproval:body=>request("POST","/api/approvals",body),
    getApproval:id=>request("GET","/api/approvals/"+encodeURIComponent(id)),
  };
}
module.exports={createHubClient};
