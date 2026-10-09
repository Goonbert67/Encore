/* Encore — Spotify (PKCE login) + Claude API layer for the GitHub Pages build.
   Everything here runs in the browser. Tokens and the API key live in localStorage on this device only. */

const LS={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const REDIRECT=location.origin+location.pathname;
$("redirectUri").textContent=REDIRECT;

/* ================= Spotify ================= */
const SCOPES="user-read-currently-playing user-read-playback-state user-read-recently-played user-top-read playlist-modify-private playlist-modify-public user-library-modify user-library-read";
const TOKEN_URL="https://accounts.spotify.com/api/token";
let tok=null;try{tok=JSON.parse(LS.get("encore.sp")||"null")}catch(e){}
const clientId=()=>LS.get("encore.spClient")||"";
const b64url=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");

async function spLogin(){
  const id=$("spClient").value.trim();
  if(!/^[0-9a-f]{32}$/i.test(id)){toast("That doesn't look like a Client ID. It's 32 letters and numbers.");return}
  LS.set("encore.spClient",id);
  const verifier=b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge=b64url(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier)));
  const state=b64url(crypto.getRandomValues(new Uint8Array(12)));
  LS.set("encore.pkce",JSON.stringify({verifier,state}));
  location.href="https://accounts.spotify.com/authorize?"+new URLSearchParams({client_id:id,response_type:"code",redirect_uri:REDIRECT,code_challenge_method:"S256",code_challenge:challenge,scope:SCOPES,state});
}
function saveTok(j){tok={access:j.access_token,refresh:j.refresh_token||(tok&&tok.refresh),exp:Date.now()+((j.expires_in||3600)-60)*1000};LS.set("encore.sp",JSON.stringify(tok))}
async function handleCallback(){
  const q=new URLSearchParams(location.search);
  if(!q.has("code")&&!q.has("error"))return;
  history.replaceState(null,"",REDIRECT);
  let pk=null;try{pk=JSON.parse(LS.get("encore.pkce")||"null")}catch(e){}
  LS.set("encore.pkce",null);
  if(q.get("error")){toast("Spotify login was cancelled.");return}
  if(!pk||pk.state!==q.get("state")){toast("Spotify login didn't complete. Try Connect again.");return}
  try{
    const r=await fetch(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId(),grant_type:"authorization_code",code:q.get("code"),redirect_uri:REDIRECT,code_verifier:pk.verifier})});
    const j=await r.json();
    if(!r.ok){toast("Spotify login failed: "+(j.error_description||j.error||r.status));return}
    saveTok(j);toast("Spotify connected");
  }catch(e){toast("Couldn't reach Spotify to finish the login.")}
}
async function refreshTok(){
  const r=await fetch(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId(),grant_type:"refresh_token",refresh_token:tok.refresh})});
  if(!r.ok){tok=null;LS.set("encore.sp",null);updateConn();throw {code:"auth"}}
  saveTok(await r.json());
}
let refreshing=null;
async function sp(path,opt={}){
  if(!tok)throw {code:"not_connected"};
  if(Date.now()>tok.exp){refreshing=refreshing||refreshTok().finally(()=>refreshing=null);await refreshing}
  for(let attempt=0;attempt<4;attempt++){
    const r=await fetch("https://api.spotify.com/v1"+path,{...opt,headers:{Authorization:"Bearer "+tok.access,...(opt.body?{"Content-Type":"application/json"}:{})}});
    if(r.status===401&&attempt===0){refreshing=refreshing||refreshTok().finally(()=>refreshing=null);await refreshing;continue}
    if(r.status===429){await sleep(Math.min(30,+(r.headers.get("Retry-After")||2))*1000);continue}
    if(r.status===204||r.status===202)return null;
    const txt=await r.text();let j=null;try{j=txt?JSON.parse(txt):null}catch(e){}
    if(!r.ok)throw {code:r.status===403?"forbidden":"http",status:r.status,message:(j&&j.error&&(j.error.message||j.error))||r.statusText};
    return j;
  }
  throw {code:"rate_limited"};
}
function spErr(e){switch(e&&e.code){
  case "not_connected":return "Connect Spotify in Settings first.";
  case "auth":return "Your Spotify login expired. Connect again in Settings.";
  case "forbidden":return "Spotify refused that ("+(e.message||"403")+"). Check that your Spotify account is added under User Management in the developer app.";
  case "rate_limited":return "Spotify is rate-limiting Encore. Try again in a minute.";
  default:return "Spotify error"+(e&&e.message?": "+e.message:". Try again.");}}
const pickImg=(imgs,min=160)=>{if(!imgs||!imgs.length)return null;const s=imgs.slice().sort((a,b)=>(a.width||0)-(b.width||0));return (s.find(i=>(i.width||0)>=min)||s[s.length-1]).url};

/* ================= Images (covers + artist photos) ================= */
const IMG={t:new Map(),a:new Map()};let imgSaveT=null;
async function imgLoad(){try{const x=await db();const v=await new Promise(res=>{const r=x.transaction("kv").objectStore("kv").get("img");r.onsuccess=()=>res(r.result);r.onerror=()=>res(null)});if(v){IMG.t=new Map(v.t);IMG.a=new Map(v.a)}}catch(e){}}
function imgSave(){clearTimeout(imgSaveT);imgSaveT=setTimeout(async()=>{try{const x=await db();x.transaction("kv","readwrite").objectStore("kv").put({t:[...IMG.t],a:[...IMG.a]},"img")}catch(e){}},2000)}
function paint(el,url){if(!url||el.querySelector("img"))return;const im=new Image();im.alt="";im.decoding="async";im.referrerPolicy="no-referrer";im.onload=()=>el.classList.add("has-img");im.src=url;el.appendChild(im)}
function cachedFor(el){const t=el.dataset.imgT,a=el.dataset.imgA;if(t&&IMG.t.has(t))return IMG.t.get(t).c;if(!t&&a&&IMG.a.has(a))return IMG.a.get(a);return null}
const imgQ=[];let imgActive=0;const pending=new Map();
const io="IntersectionObserver" in window?new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){io.unobserve(e.target);imgQ.push(e.target);pump()}},{rootMargin:"400px"}):null;
function scanImages(){
  document.querySelectorAll(".cover[data-img-u]:not([data-b]),.cover[data-img-t]:not([data-b]),.cover[data-img-a]:not([data-b])").forEach(el=>{
    el.dataset.b=1;if(el.dataset.imgU){paint(el,el.dataset.imgU);return}
    const c=cachedFor(el);if(c){paint(el,c);return}
    if(tok&&io)io.observe(el);
  });
}
function pump(){while(imgActive<3&&imgQ.length){const el=imgQ.shift();if(!el.isConnected)continue;imgActive++;resolveImg(el).then(u=>paint(el,u)).catch(()=>{}).finally(()=>{imgActive--;pump()})}}
function once(key,fn){if(!pending.has(key))pending.set(key,fn().finally(()=>pending.delete(key)));return pending.get(key)}
async function trackInfo(uri){
  if(IMG.t.has(uri))return IMG.t.get(uri);
  return once("t"+uri,async()=>{const id=uri.split(":").pop();const j=await sp("/tracks/"+id);const v={c:pickImg(j.album&&j.album.images),ar:j.artists&&j.artists[0]&&j.artists[0].id};IMG.t.set(uri,v);imgSave();return v});
}
let repFor=null,repMap=null;
function repTrack(name){ // most-played track URI for an artist, to find their Spotify id
  if(repFor!==D){repFor=D;repMap=new Map();const best=new Map();for(let i=0;i<D.ts.length;i++){const t=D.tracks[D.ti[i]];if(!t[3])continue;let m=best.get(t[1]);if(!m)best.set(t[1],m=new Map());m.set(t[3],(m.get(t[3])||0)+1)}for(const [a,m] of best)repMap.set(a,[...m].sort((x,y)=>y[1]-x[1])[0][0])}
  return repMap.get(name);
}
async function artistImg(name){
  if(IMG.a.has(name))return IMG.a.get(name);
  return once("a"+name,async()=>{
    let id=null;const rt=repTrack(name);
    if(rt){try{id=(await trackInfo(rt)).ar}catch(e){}}
    let j=null;
    if(id)j=await sp("/artists/"+id);
    else{const s=await sp("/search?type=artist&limit=1&q="+encodeURIComponent(name));j=s&&s.artists&&s.artists.items[0]}
    const u=j?pickImg(j.images,200):null;IMG.a.set(name,u);imgSave();return u;
  });
}
async function resolveImg(el){
  const c=cachedFor(el);if(c)return c;
  if(el.dataset.imgT)return (await trackInfo(el.dataset.imgT)).c;
  if(el.dataset.imgA)return artistImg(el.dataset.imgA);
  return null;
}
new MutationObserver(()=>{cancelAnimationFrame(scanImages.f);scanImages.f=requestAnimationFrame(scanImages)}).observe(document.querySelector("main"),{childList:true,subtree:true});

/* ================= Claude ================= */
const clKey=()=>LS.get("encore.clKey")||"";
const clModel=()=>LS.get("encore.clModel")||"claude-sonnet-5-5";
async function claude(prompt,{onText,signal,maxTokens=3000,model}={}){
  if(!clKey())throw {code:"no_key"};
  let r;
  try{r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",signal,headers:{"content-type":"application/json","x-api-key":clKey(),"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body:JSON.stringify({model:model||clModel(),max_tokens:maxTokens,stream:!!onText,messages:[{role:"user",content:prompt}]})})}
  catch(e){throw e&&e.name==="AbortError"?{code:"cancelled"}:{code:"network"}}
  if(!r.ok){let j={};try{j=await r.json()}catch(e){}throw {code:"http",status:r.status,message:(j.error&&j.error.message)||r.statusText}}
  if(!onText){const j=await r.json();return (j.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("")}
  const rd=r.body.getReader(),dec=new TextDecoder();let buf="",text="";
  try{
    for(;;){const {value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;
      while((i=buf.indexOf("\n\n"))>=0){const ev=buf.slice(0,i);buf=buf.slice(i+2);const line=ev.split("\n").find(l=>l.startsWith("data:"));if(!line)continue;
        let d;try{d=JSON.parse(line.slice(5))}catch(e){continue}
        if(d.type==="content_block_delta"&&d.delta&&d.delta.type==="text_delta"){text+=d.delta.text;onText(text)}
        if(d.type==="error")throw {code:"http",status:d.error&&d.error.type==="overloaded_error"?529:500,message:d.error&&d.error.message,text}}}
  }catch(e){if(e&&e.name==="AbortError")throw {code:"cancelled",text};throw e.code?e:{code:"network",text}}
  return text;
}
async function claudeJSON(prompt,opt){const t=await claude(prompt,opt);const m=t.match(/\[[\s\S]*\]/);if(!m)throw {code:"invalid_json"};try{return JSON.parse(m[0])}catch(e){throw {code:"invalid_json"}}}
function claudeErr(e){
  if(!e)return "Claude didn't answer. Try again.";
  if(e.code==="no_key")return "Add your Claude API key in Settings first.";
  if(e.code==="cancelled")return "Stopped.";
  if(e.code==="network")return "Couldn't reach Claude. Check your connection and try again.";
  if(e.code==="invalid_json")return "Claude's answer came back in the wrong format. Try again.";
  const m=String(e.message||"");
  if(e.status===401)return "Claude rejected the API key. Check it in Settings.";
  if(/credit/i.test(m))return "Your Claude API credit is used up. Top up at console.anthropic.com.";
  if(e.status===429)return "Too many Claude requests right now. Wait a minute and try again.";
  if(e.status===529||/overload/i.test(m))return "Claude is busy. Try again in a moment.";
  if(e.status===404&&/model/i.test(m))return "That model isn't available on your API key. Pick the other one in Settings.";
  return "Claude error: "+(m||e.status||"unknown");
}

/* ================= Settings + connection state ================= */
$("spClient").value=clientId();
$("clKey").value=clKey();
$("clModel").value=clModel();
$("spConnect").onclick=spLogin;
$("spDisconnect").onclick=()=>{tok=null;LS.set("encore.sp",null);updateConn();toast("Spotify disconnected from Encore")};
$("clModel").onchange=e=>LS.set("encore.clModel",e.target.value);
$("clSave").onclick=async()=>{
  const k=$("clKey").value.trim(),msg=$("clMsg");msg.classList.remove("err");
  if(!/^sk-ant-/.test(k)){msg.textContent="Claude API keys start with sk-ant-.";msg.classList.add("err");return}
  LS.set("encore.clKey",k);msg.textContent="Checking the key…";
  try{await claude("Reply with just: OK",{maxTokens:5,model:"claude-haiku-5-5"});msg.textContent="Key saved and working.";}
  catch(e){msg.textContent=claudeErr(e);msg.classList.add("err")}
  updateConn();
};
$("clForget").onclick=()=>{LS.set("encore.clKey",null);$("clKey").value="";$("clMsg").textContent="Key removed from this browser.";updateConn()};
function updateConn(){
  $("connSpotify").textContent=tok?"Connected":"Not connected";
  $("spConnect").textContent=tok?"Reconnect":"Connect Spotify";
  $("spDisconnect").hidden=!tok;
  $("connClaude").textContent=clKey()?"Key saved":"No key";
  $("clForget").hidden=!clKey();
  $("topSave").disabled=!tok;
}

/* ================= history helpers for prompts ================= */
const norm=s=>String(s||"").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/[^\p{L}\p{N}]+/gu," ").trim();
const coreTitle=t=>norm(String(t).split(/ - | \(|\[/)[0]);
const mainArtist=a=>norm(String(a).split(/,|&| feat| ft\.| x /i)[0]);
let histFor=null,histMap=null;
function playsOf(title,artist){
  if(D.meta.source!=="import")return null;
  if(histFor!==D){histFor=D;histMap=new Map();const per=new Map();
    for(let i=0;i<D.ts.length;i++)if(D.ms[i]>=PLAY_MS)per.set(D.ti[i],(per.get(D.ti[i])||0)+1);
    for(const [k,c] of per){const t=D.tracks[k];const key=coreTitle(t[0])+"|"+mainArtist(t[1]);histMap.set(key,(histMap.get(key)||0)+c)}}
  return histMap.get(coreTitle(title)+"|"+mainArtist(artist))||0;
}
function tasteContext(){
  if(D.meta.source!=="import")return "No listening history imported.";
  const N=D.ts.length,last=D.ts[N-1],all=agg(0,N),r6=agg(lowerBound(D.ts,last-182*DAY),N);
  const L=a=>a.slice(0,20).map(x=>`${x.n} (${fmtH(x.ms)})`).join(", ");
  const yA=new Map();for(let i=0;i<N;i++){const y=X.yr[i];let m=yA.get(y);if(!m)yA.set(y,m=new Map());const a=D.tracks[D.ti[i]][1];m.set(a,(m.get(a)||0)+D.ms[i])}
  const eras=[...yA].sort((a,b)=>a[0]-b[0]).map(([y,m])=>`${y}: ${[...m].sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]).join(", ")}`).join("; ");
  const H=new Float64Array(24);for(let i=0;i<N;i++)H[X.hr[i]]+=D.ms[i];const peak=H.indexOf(Math.max(...H));
  let sk=0;for(let i=0;i<N;i++)if(D.ms[i]<PLAY_MS)sk++;
  return [`History: ${fmt(hrs(all.ms))} hours since ${dateStr(D.ts[0],{year:"numeric",month:"long"})}, data up to ${dateStr(last)}.`,
    `All-time top artists: ${L(all.artists)}.`,`Last 6 months top artists: ${L(r6.artists)}.`,
    `Last 6 months top songs: ${r6.tracks.slice(0,15).map(t=>`${D.tracks[t.k][0]} – ${D.tracks[t.k][1]} (${t.p} plays)`).join("; ")}.`,
    `Top 3 artists per year: ${eras}.`,`Peak listening hour: ${peak}:00. Skips ${Math.round(sk/N*100)}% of songs within 30 seconds.`].join("\n");
}
const heavyRotation=n=>D.meta.source!=="import"?"":agg(0,D.ts.length).tracks.slice(0,n).map(t=>`${D.tracks[t.k][0]} – ${D.tracks[t.k][1]}`).join("\n");
async function pool(items,n,fn){let i=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(i<items.length){const k=i++;await fn(items[k],k)}}))}
function setStatus(el,msg,err,settings){el.innerHTML=msg?`<p class="note ai-status${err?" err":""}">${esc(msg)}${settings?' <button class="btn small" data-tab="data">Open Settings</button>':""}</p>`:""}
const thinking=(el,msg)=>{el.innerHTML=`<div class="thinking">${esc(msg)}</div>`};
const cleanPicks=arr=>(Array.isArray(arr)?arr:[]).map(x=>({title:String(x&&x.title||"").trim(),artist:String(x&&x.artist||"").trim(),why:String(x&&x.why||"").trim()})).filter(x=>x.title&&x.artist);

/* ================= Spotify search / save ================= */
async function spSearch(title,artist){
  const a=mainArtist(artist),t=coreTitle(title);
  const score=e=>((e.artists||[]).some(c=>{const n=norm(c.name);return a&&(n.includes(a)||a.includes(n))})?2:0)+(coreTitle(e.name)===t?1:0);
  const qs=[artist?`track:${title} artist:${artist}`:title,`${title} ${artist}`.trim()];
  for(const q of qs){
    const j=await sp("/search?type=track&limit=5&q="+encodeURIComponent(q));
    const items=(j&&j.tracks&&j.tracks.items)||[];
    const best=items.slice().sort((x,y)=>score(y)-score(x))[0];
    if(best&&(score(best)>0||!artist))return {uri:best.uri,name:best.name,artist:best.artists.map(c=>c.name).join(", "),url:best.external_urls&&best.external_urls.spotify,img:pickImg(best.album&&best.album.images)};
  }
  return null;
}
async function saveLiked(uris){
  for(let i=0;i<uris.length;i+=40){const chunk=uris.slice(i,i+40);
    try{await sp("/me/library",{method:"PUT",body:JSON.stringify({uris:chunk})})}
    catch(e){if(e.code!=="http")throw e;await sp("/me/library?uris="+encodeURIComponent(chunk.join(",")),{method:"PUT"})}}
}
async function makePlaylist(name,uris,description){
  const pl=await sp("/me/playlists",{method:"POST",body:JSON.stringify({name,description:description||"Made with Encore",public:false})});
  for(let i=0;i<uris.length;i+=100)await sp(`/playlists/${pl.id}/items`,{method:"POST",body:JSON.stringify({uris:uris.slice(i,i+100)})});
  return pl;
}

/* ================= pick list ================= */
function PickList(el,label,defaultName){
  let items=[],plName="";
  function row(it,i){
    const plays=playsOf(it.title,it.artist);
    const tags=[plays===null?"":plays>0?`<span class="tag">You've played it ${fmt(plays)}×</span>`:`<span class="tag new">New to you</span>`,it.saved?`<span class="tag saved">♥ Saved</span>`:""].join("");
    const st=it.sp&&it.sp.url?`<a class="sp-link" href="${esc(it.sp.url)}" target="_blank" rel="noopener">Open ↗</a>`:it.state==="looking"?'<span class="note">Finding…</span>':it.state==="missing"?'<span class="note">Not found</span>':it.state==="err"?`<span class="note" title="${esc(it.err)}">Error</span>`:"";
    return `<div class="track"><input type="checkbox" class="check" id="${label}${i}" ${it.on?"checked":""} ${it.sp?"":"disabled"} aria-label="Include ${esc(it.title)}">${cover(it.artist,"",it.sp&&it.sp.img?{u:it.sp.img}:{a:it.artist})}
      <label class="t-main" for="${label}${i}"><div class="t-name">${esc(it.sp?it.sp.name:it.title)}</div><div class="t-sub">${esc(it.sp?it.sp.artist:it.artist)}</div>${it.why?`<div class="why">${esc(it.why)}</div>`:""}<div class="pick-meta">${tags}</div></label>
      <div class="t-end">${st}</div></div>`;
  }
  function render(note){
    const ok=items.filter(x=>x.sp&&x.on).length;
    el.innerHTML=`<div class="picks"><div class="list">${items.map(row).join("")}</div>
      <div class="footer-actions"><span class="note">${ok} of ${items.length} selected${note?" · "+esc(note):""}</span>
      <div class="row-actions" data-role="acts"><input class="pl-name" data-role="name" aria-label="Playlist name" placeholder="Playlist name" value="${esc(plName)}"><button class="btn" data-act="liked" ${ok&&tok?"":"disabled"}>Save to Liked Songs</button><button class="btn primary" data-act="playlist" ${ok&&tok?"":"disabled"}>Create playlist</button></div></div>
      <p class="note ai-status" data-role="msg"></p></div>`;
  }
  el.addEventListener("input",e=>{if(e.target.dataset.role==="name")plName=e.target.value});
  el.addEventListener("change",e=>{const m=e.target.id&&e.target.id.match(new RegExp("^"+label+"(\\d+)$"));if(m){items[+m[1]].on=e.target.checked;render()}});
  el.addEventListener("click",async e=>{
    const b=e.target.closest("[data-act]");if(!b)return;
    const chosen=items.filter(x=>x.sp&&x.on),msg=()=>el.querySelector('[data-role="msg"]');b.disabled=true;
    try{
      if(b.dataset.act==="liked"){await saveLiked(chosen.map(x=>x.sp.uri));chosen.forEach(x=>x.saved=true);render();msg().textContent=`Saved ${chosen.length} songs to Liked Songs.`}
      else{msg().textContent="Creating playlist…";const pl=await makePlaylist(plName.trim()||"Encore mix",chosen.map(x=>x.sp.uri));render();
        msg().innerHTML=`Created <a class="sp-link" href="${esc(pl.external_urls&&pl.external_urls.spotify||"https://open.spotify.com/playlist/"+pl.id)}" target="_blank" rel="noopener">${esc(pl.name)} ↗</a> with ${chosen.length} songs.`}
    }catch(err){render();const m=msg();m.textContent=spErr(err);m.classList.add("err")}
  });
  return {
    async load(list,name,note){
      plName=name||defaultName;items=list.map(x=>({...x,on:true,state:tok?"looking":"",sp:null}));
      render(tok?"":"Connect Spotify in Settings to get links and save");
      if(!tok)return;
      await pool(items,2,async it=>{
        try{it.sp=await spSearch(it.title,it.artist);it.state=it.sp?"":"missing";if(!it.sp)it.on=false}
        catch(err){it.state="err";it.err=spErr(err);it.on=false}
        render(note);
      });
      render(note);
    }
  };
}
const simList=PickList($("simOut"),"sim","Encore · similar vibe"),ideaList=PickList($("ideaOut"),"idea","Encore · idea"),pasteList=PickList($("pasteOut"),"paste","Encore · pasted list");

/* ================= Similar vibe ================= */
let simCtl=null,shown=[];
async function findSimilar(more){
  const out=$("simOut"),btn=$("simBtn");
  if(!clKey()){setStatus(out,"Add your Claude API key in Settings to get picks.",true,true);return}
  if(!SEED)return;
  simCtl&&simCtl.abort();simCtl=new AbortController();
  if(!more)shown=[];
  btn.disabled=true;thinking(out,`Claude is listening to "${SEED.name}"…`);
  const prompt=`You are a music curator recommending songs to one listener.
Seed song: "${SEED.name}" by ${SEED.artist}.
Recommend 10 songs that share the seed's vibe: its mood, energy, sound and era. Use the listener's history below to aim the picks at their taste.

${tasteContext()}

Rules:
- Real, released songs that are on Spotify. Exact song titles and main artist names.
- At most 2 songs by ${SEED.artist}.
- Mostly songs the listener probably hasn't heard. Skip anything on the heavy-rotation list.
- "why" is one concrete line, 14 words max, about the sound or mood. Don't mention the listener.
${shown.length?`- Don't repeat any of these earlier picks:\n${shown.join("\n")}\n`:""}
Heavy rotation (skip these):
${heavyRotation(120)}

Reply with only a JSON array: [{"title":"…","artist":"…","why":"…"}]`;
  try{
    const picks=cleanPicks(await claudeJSON(prompt,{signal:simCtl.signal}));
    if(!picks.length)throw {code:"invalid_json"};
    shown.push(...picks.map(p=>`${p.title} – ${p.artist}`));
    await simList.load(picks,`Like ${SEED.name}`);
    const acts=$("simOut").querySelector('[data-role="acts"]');
    if(acts&&!$("moreBtn")){acts.insertAdjacentHTML("afterbegin",'<button class="btn" id="moreBtn">More like these</button>');$("moreBtn").onclick=()=>findSimilar(true)}
  }catch(e){if(e&&e.code==="cancelled")return;setStatus(out,claudeErr(e),true,e&&e.code==="no_key")}
  finally{btn.disabled=false}
}
window.findSimilar=findSimilar;
$("simBtn").onclick=()=>findSimilar(false);
$("useNowBtn").onclick=()=>{if(NOW){setSeed(NOW.name,NOW.artist,NOW.img?{u:NOW.img}:null);findSimilar(false)}};
// keep "More like these" alive across pick-list re-renders
new MutationObserver(()=>{const acts=$("simOut").querySelector('[data-role="acts"]');if(acts&&!acts.querySelector("#moreBtn")&&shown.length){acts.insertAdjacentHTML("afterbegin",'<button class="btn" id="moreBtn">More like these</button>');$("moreBtn").onclick=()=>findSimilar(true)}}).observe($("simOut"),{childList:true});

/* ================= Playlist from an idea ================= */
$("ideaBtn").onclick=async()=>{
  const out=$("ideaOut"),btn=$("ideaBtn"),idea=$("ideaBox").value.trim();
  if(!idea){setStatus(out,"Describe the playlist first.",true);return}
  if(!clKey()){setStatus(out,"Add your Claude API key in Settings to build playlists.",true,true);return}
  btn.disabled=true;thinking(out,"Claude is picking songs…");
  const prompt=`Build a playlist of 25 songs for this idea: "${idea}"
Follow the idea first. Where it fits, lean toward this listener's taste, and include a few songs they'll know alongside new finds.

${tasteContext()}

Rules: real, released songs on Spotify; exact titles and main artist names; no more than 2 songs per artist; order them so the playlist flows; "why" is 10 words max.
Reply with only a JSON array: [{"title":"…","artist":"…","why":"…"}]`;
  try{const picks=cleanPicks(await claudeJSON(prompt));if(!picks.length)throw {code:"invalid_json"};await ideaList.load(picks,idea.length>60?idea.slice(0,57)+"…":idea)}
  catch(e){setStatus(out,claudeErr(e),true,e&&e.code==="no_key")}finally{btn.disabled=false}
};

/* ================= Paste a list ================= */
$("pasteBtn").onclick=async()=>{
  const out=$("pasteOut");
  const items=$("pasteBox").value.split(/\n+/).map(l=>l.replace(/^\s*\d+[.)]\s*/,"").trim()).filter(Boolean).map(l=>{
    let m=l.match(/^(.+?)\s+by\s+(.+)$/i);if(m)return {title:m[1],artist:m[2]};
    m=l.split(/\s+[–—-]\s+/);if(m.length>=2)return {artist:m[0],title:m.slice(1).join(" - ")};
    return {title:l,artist:""};}).filter(x=>x.title).slice(0,100);
  if(!items.length){setStatus(out,"Paste at least one song.",true);return}
  if(!tok){setStatus(out,"Connect Spotify in Settings to match songs.",true,true);return}
  $("pasteBtn").disabled=true;try{await pasteList.load(items.map(x=>({...x,why:""})))}finally{$("pasteBtn").disabled=false}
};

/* ================= Top tracks → playlist (exact songs from your history) ================= */
$("topSave").onclick=async e=>{
  if(!tok){toast("Connect Spotify in Settings first.");return}
  const [i0,i1,label]=rangeBounds(range),g=agg(i0,i1);
  const uris=g.tracks.map(t=>D.tracks[t.k][3]).filter(Boolean).slice(0,30);
  if(!uris.length){toast("No Spotify links in this range of your history.");return}
  e.target.disabled=true;
  try{const pl=await makePlaylist(`Encore · ${label}`,uris,"Your most played songs, by Encore");toast(`Created "${pl.name}" with ${uris.length} songs`)}
  catch(err){toast(spErr(err))}finally{e.target.disabled=false}
};

/* ================= Taste profile ================= */
let profCtl=null;
async function writeProfile(roast){
  const out=$("profileOut"),st=$("profileStatus"),stop=$("profileStop");
  const fail=m=>{st.hidden=false;st.textContent=m;st.classList.add("err")};
  if(!clKey())return fail("Add your Claude API key in Settings first.");
  if(D.meta.source!=="import")return fail("Import your Spotify export first, so Claude has your real history to read.");
  profCtl&&profCtl.abort();profCtl=new AbortController();
  st.hidden=true;st.classList.remove("err");out.hidden=false;out.innerHTML='<div class="thinking">Claude is reading your history…</div>';stop.hidden=false;
  const ask=roast
    ?"Roast this listener's music taste. Be playful and sharp, never cruel, and only about their music and listening habits. Reference specific artists, songs, years and numbers from the data. Three short paragraphs, under 150 words total. Second person. No headings, lists or emoji."
    :"Write a taste profile of this listener. Describe their eras, what ties their favourite artists together, and what their habits say about them. Be specific: reference real artists, years and numbers from the data. Warm and witty, three short paragraphs, under 170 words total. Second person. No headings, lists or emoji.";
  const paint=text=>{out.innerHTML=text.split(/\n\s*\n/).map(p=>`<p>${esc(p.trim())}</p>`).join("")};
  try{await claude(`${ask}\n\n${tasteContext()}`,{signal:profCtl.signal,onText:paint,maxTokens:800})}
  catch(e){if(e&&e.text)paint(e.text);else if(e&&e.code!=="cancelled")out.hidden=true;if(e&&e.code!=="cancelled")fail(claudeErr(e))}
  finally{stop.hidden=true}
}
$("profileBtn").onclick=()=>writeProfile(false);
$("roastBtn").onclick=()=>writeProfile(true);
$("profileStop").onclick=()=>profCtl&&profCtl.abort();

/* ================= Live: now playing + recent plays into history ================= */
async function pollNow(){
  if(!tok||document.hidden)return;
  try{
    const j=await sp("/me/player/currently-playing");
    const it=j&&j.item&&j.currently_playing_type==="track"?j.item:null;
    NOW=it&&j.is_playing!==false?{name:it.name,artist:it.artists.map(a=>a.name).join(", "),album:it.album&&it.album.name,url:it.external_urls&&it.external_urls.spotify,img:pickImg(it.album&&it.album.images,250)}:null;
  }catch(e){NOW=null}
  $("useNowBtn").hidden=!NOW;renderLastCard();
}
async function pollRecent(){
  if(!tok||document.hidden||!D||D.meta.source!=="import")return;
  try{
    const j=await sp("/me/player/recently-played?limit=50");const items=(j&&j.items)||[];
    let expEnd=0;for(let i=D.ts.length-1;i>=0;i--)if(!(D.fl[i]&16)){expEnd=D.ts[i];break}
    const have=new Set();for(let i=D.ts.length-1;i>=0&&D.ts[i]>expEnd;i--)have.add(D.ts[i]+"|"+D.tracks[D.ti[i]][3]);
    const fresh=items.map(x=>({ts:Math.floor(Date.parse(x.played_at)/1000),ms:x.track.duration_ms|0,n:x.track.name,a:(x.track.artists[0]||{}).name||"",al:(x.track.album||{}).name||"",u:x.track.uri,sk:false,sh:false,pl:2,lv:1}))
      .filter(r=>r.ts>expEnd&&!have.has(r.ts+"|"+r.u));
    if(!fresh.length)return;
    D=buildData(toRecords(D).concat(fresh),"import");await dbSave(D);renderAll();
  }catch(e){}
}
setInterval(pollNow,20000);setInterval(pollRecent,180000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden){pollNow();pollRecent()}});

/* ================= boot ================= */
(async()=>{
  await handleCallback();
  updateConn();
  await imgLoad();scanImages();
  if(tok){pollNow();setTimeout(pollRecent,3000)}
  if(!clKey()&&!tok&&D.meta.source!=="import"){} // first visit: Data tab nudges via the pill
})();
