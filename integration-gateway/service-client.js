function createServiceClient({baseUrl, clientId, clientSecret, fetchImpl = fetch}) {
  let cached, expires = 0;
  function base() {
    const url = new URL(baseUrl);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1","localhost"].includes(url.hostname)))) throw Error("Invalid service URL");
    return url.origin;
  }
  async function token() {
    if (cached && expires > Date.now()) return cached;
    const response = await fetchImpl(base()+"/auth/token",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({client_id:clientId,client_secret:clientSecret}),signal:AbortSignal.timeout(8000),redirect:"error"});
    if (!response.ok) throw Error("Service login failed");
    const result = await response.json();
    if (!result.access_token) throw Error("Service login returned no token");
    cached = result.access_token; expires = Date.now() + Math.max(0, Number(result.expires_in || 0)-30)*1000;
    return cached;
  }
  async function post(endpoint,body,retry=true) {
    const response = await fetchImpl(base()+endpoint,{method:"POST",headers:{"Authorization":"Bearer "+await token(),"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:"error"});
    if(response.status===401 && retry) {cached=null;return post(endpoint,body,false);}
    const result = await response.json();
    if(!response.ok) {const error=new Error("Upstream service request failed");error.status=response.status;throw error;}
    return result;
  }
  return {post};
}
module.exports = {createServiceClient};
