// Remote assistance picture: device-pixel alignment, Lanczos3 GPU scaling,
// exact 1:1 mode and pointer mapping, through the real invitation and UI
// with a synthetic local engine (no screen is captured).
// LINKME_CLIENT_URL overrides .local/dev-client/client.url; LINKME_TEST_PEOPLE
// (a JSON file of two logged-in {token,user} plus password) replaces the
// accounts the admin would create.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';

const base='http://127.0.0.1:18246',errors=[],given=process.env.LINKME_TEST_PEOPLE&&JSON.parse(await fs.readFile(process.env.LINKME_TEST_PEOPLE,'utf8'));
const password=given?.password||'Remote-view-test-2026!';
const entry=(process.env.LINKME_CLIENT_URL||(await fs.readFile('.local/dev-client/client.url','utf8'))).trim();
async function api(path,token,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200,path);return r.json()}

// A 1920x1080 "desktop" of one-pixel strokes, as one PNG tile.
function png(w,h,pixel){
 const raw=Buffer.alloc((w*3+1)*h);
 for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++){const v=pixel(x,y),o=y*(w*3+1)+1+x*3;raw[o]=raw[o+1]=raw[o+2]=v}}
 const chunk=(type,data)=>{const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length,0);b.write(type,4,'ascii');data.copy(b,8);b.writeUInt32BE(zlib.crc32(b.subarray(4,8+data.length)),8+data.length);return b};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const W=1920,H=1080,image=png(W,H,(x,y)=>(y%20<12&&x%3===0)?20:250);
const meta=Buffer.from(JSON.stringify({revision:1,width:W,height:H,sourceWidth:W,sourceHeight:H,reset:true,tiles:[{x:0,y:0,w:W,h:H,size:image.length,mime:'image/png'}]}));
const head=Buffer.alloc(8);head.writeUInt32BE(meta.length,0);head.writeUInt32BE(image.length,4);
const body=Buffer.concat([head,meta,image]);

const people=given?.people||[];
if(!given){const admin=await api('/api/auth/login','',JSON.parse(await fs.readFile('.local/storage-admin.json','utf8')));for(const name of ['清晰度查看者','清晰度测试设备']){const {user}=await api('/api/admin/users',admin.token,{name,password});people.push(await api('/api/auth/login','',{account:user.number,password}))}}
const [viewer,host]=people,cid=(await api('/api/conversations',viewer.token,{kind:'direct',members:[host.user.id]})).id;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});

// Either login form: account number, or the e-mail field taking the number.
async function signIn(p,person){await p.route('**/api/auth/login',r=>{const b=JSON.parse(r.request().postData()||'{}');r.continue({postData:JSON.stringify({account:b.account||b.email,password:b.password})})});await p.goto(entry);const field=p.locator('input').nth(0);await field.evaluate(e=>{e.type='text';e.removeAttribute('pattern')});await field.fill(person.user.number);await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录',exact:true}).click();await p.locator('.rail').waitFor()}
// The invited person is online; the engine itself is synthetic.
const hostPage=await (await browser.newContext()).newPage();await hostPage.route('**/local/remote/**',route=>route.fulfill({json:{ok:true}}));await signIn(hostPage,host);

// What is on screen, not just element state: the picture is light, the
// area around it dark, so a hidden or transparent picture reads as dark.
async function seenOn(p){const box=await p.locator('.remote-canvas').boundingBox(),shot=(await p.screenshot({clip:{x:box.x+box.width*.3,y:box.y+box.height*.3,width:box.width*.4,height:box.height*.4}})).toString('base64');return p.evaluate(async b=>{const i=new Image();i.src='data:image/png;base64,'+b;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const g=c.getContext('2d');g.drawImage(i,0,0);const d=g.getImageData(0,0,c.width,c.height).data;let s=0;for(let k=0;k<d.length;k+=4)s+=d[k+1];return s/(d.length/4)},shot)}

// Sessions are ended even when an assertion fails, so a rerun can invite again.
const started=[];
const endAll=()=>Promise.all(started.map(id=>fetch(base+'/api/remotes/'+id+'/end',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+viewer.token},body:'{}'}).catch(()=>{})));
try{
for(const dpr of [1,1.25]){
 const ctx=await browser.newContext({viewport:{width:1100,height:740},deviceScaleFactor:dpr}),p=await ctx.newPage(),inputs=[];
 p.on('pageerror',e=>errors.push(e.message));
 let served=false;
 await p.route('**/local/remote/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/tiles')){if(served){await new Promise(r=>setTimeout(r,500));return route.fulfill({status:204})}served=true;return route.fulfill({contentType:'application/octet-stream',body})}
  if(path.endsWith('/input'))inputs.push(...JSON.parse(route.request().postData()||'{}').events||[]);
  return route.fulfill({json:path.endsWith('/state')?{status:'connected',role:'viewer',deviceId:'123456789012345678901234',width:W,height:H,frame:1,path:'p2p',rtt:3}:{ok:true}});
 });
 await signIn(p,viewer);
 await p.locator('[data-conversation="'+cid+'"]').click();await p.locator('[data-action=remote]:visible').click();
 const waiting=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/remotes'&&r.request().method()==='POST');
 await p.locator('[data-invite-remote=control][data-direction=request]').click();const invited=await waiting,reply=await invited.json();assert.equal(invited.status(),200,JSON.stringify(reply));const rid=reply.id;started.push(rid);
 await api('/api/remotes/'+rid+'/respond',host.token,{accept:true,deviceId:'123456789012345678901234'});
 await p.locator('.remote-screen').waitFor();await p.waitForFunction(()=>document.querySelector('#remote-image')?.dataset.resampling);
 const fit=await p.evaluate(()=>{const c=document.querySelector('#remote-image'),o=document.querySelector('.resampled-view'),b=c.getBoundingClientRect(),d=devicePixelRatio;return {mode:c.dataset.resampling,opacity:c.style.opacity,outW:o?.width,outH:o?.height,shown:o&&!o.hidden,w:b.width*d,h:b.height*d,x:b.left*d,y:b.top*d}});
 const whole=v=>Math.abs(v-Math.round(v))<0.02;
 const seen=()=>seenOn(p);
 const visible=await p.evaluate(()=>{const o=document.querySelector('.resampled-view'),st=getComputedStyle(o);return st.visibility==='visible'&&st.display!=='none'});
 assert.ok(visible,`dpr ${dpr}: the scaled copy is visible`);
 const brightness=await seen();assert.ok(brightness>150,`dpr ${dpr}: the remote picture is on screen (brightness ${brightness.toFixed(0)})`);
 assert.equal(fit.mode,'lanczos3',`dpr ${dpr}: scaled through Lanczos3`);
 assert.ok(fit.shown&&fit.opacity==='0',`dpr ${dpr}: the scaled copy covers the canvas`);
 assert.equal(fit.outW,Math.round(fit.w),`dpr ${dpr}: copy has one pixel per device pixel`);
 assert.ok(whole(fit.x)&&whole(fit.y),`dpr ${dpr}: picture starts on a whole device pixel (${fit.x},${fit.y})`);
 // A click lands on the remote pixel under the pointer.
 await p.mouse.click(fit.x/dpr+fit.w/dpr*0.25,fit.y/dpr+fit.h/dpr*0.5);await p.waitForTimeout(300);
 const move=inputs.find(e=>e.type==='move');assert.ok(move,'pointer sent');
 assert.ok(Math.abs(move.x-W*0.25)<=2&&Math.abs(move.y-H*0.5)<=2,`dpr ${dpr}: click maps to ${move.x},${move.y}`);
 // 1:1 shows every remote pixel on exactly one device pixel.
 await p.locator('[data-action=remote-actual]').click();
 assert.ok(await seen()>150,'1:1 picture on screen');
 const actual=await p.evaluate(()=>{const c=document.querySelector('#remote-image'),b=c.getBoundingClientRect(),d=devicePixelRatio;return {mode:c.dataset.resampling,w:b.width*d,h:b.height*d,render:c.style.imageRendering,x:b.left*d}});
 assert.equal(actual.mode,'native');assert.ok(Math.abs(actual.w-W)<0.5&&Math.abs(actual.h-H)<0.5,`dpr ${dpr}: 1:1 is ${actual.w}x${actual.h}`);assert.equal(actual.render,'pixelated');assert.ok(whole(actual.x));
 await p.locator('[data-action=remote-actual]').click();
 await p.waitForFunction(()=>document.querySelector('#remote-image')?.dataset.resampling==='lanczos3');
 // The window shrinks: the picture refits.
 await p.setViewportSize({width:900,height:640});await p.waitForTimeout(300);
 const small=await p.evaluate(()=>{const o=document.querySelector('.resampled-view'),c=document.querySelector('#remote-image'),d=devicePixelRatio;return {outW:o.width,w:c.getBoundingClientRect().width*d}});
 assert.equal(small.outW,Math.round(small.w),'refits after a resize');
 await p.locator('[data-action=stop-remote]').click();await p.locator('.remote-screen').waitFor({state:'detached'});
 assert.equal(await p.locator('.resampled-view').count(),0,'the scaled copy is removed with the session');
 console.log(`dpr ${dpr}: Lanczos3 ${fit.outW}x${fit.outH} at (${fit.x},${fit.y}); 1:1 ${actual.w}x${actual.h}; click -> ${move.x},${move.y}`);
 await ctx.close();
}
// Motion (YuDesk 191): frames that come faster than Lanczos passes finish
// are shown scaled by the browser; one pass runs once the picture settles.
// The GPU is slowed by 40 ms a pass (a 4K picture on a weak GPU), so passes
// cannot keep up with frames arriving every few tens of milliseconds.
{
 const ctx=await browser.newContext({viewport:{width:1100,height:740}}),p=await ctx.newPage();
 p.on('pageerror',e=>errors.push(e.message));
 await ctx.addInitScript(()=>{const flush=WebGLRenderingContext.prototype.flush;WebGLRenderingContext.prototype.flush=function(){const t=performance.now();while(performance.now()-t<40);return flush.call(this)}});
 const tile=png(128,128,(x,y)=>(x+y)%7?240:30);
 let revision=1,streaming=false,served=false;
 const delta=()=>{revision++;const m=Buffer.from(JSON.stringify({revision,width:W,height:H,sourceWidth:W,sourceHeight:H,reset:false,tiles:[{x:(revision%10)*128,y:256,w:128,h:128,size:tile.length,mime:'image/png'}]})),h=Buffer.alloc(8);h.writeUInt32BE(m.length,0);h.writeUInt32BE(tile.length,4);return Buffer.concat([h,m,tile])};
 await p.route('**/local/remote/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/tiles')){if(!served){served=true;return route.fulfill({contentType:'application/octet-stream',body})}if(streaming){await new Promise(r=>setTimeout(r,4));return route.fulfill({contentType:'application/octet-stream',body:delta()})}await new Promise(r=>setTimeout(r,500));return route.fulfill({status:204})}
  return route.fulfill({json:path.endsWith('/state')?{status:'connected',role:'viewer',deviceId:'123456789012345678901234',width:W,height:H,frame:1,path:'p2p',rtt:3}:{ok:true}});
 });
 await signIn(p,viewer);
 await p.locator('[data-conversation="'+cid+'"]').click();await p.locator('[data-action=remote]:visible').click();
 const waiting=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/remotes'&&r.request().method()==='POST');
 await p.locator('[data-invite-remote=control][data-direction=request]').click();const rid=(await (await waiting).json()).id;started.push(rid);
 await api('/api/remotes/'+rid+'/respond',host.token,{accept:true,deviceId:'123456789012345678901234'});
 await p.waitForFunction(()=>document.querySelector('#remote-image')?.dataset.resampling==='lanczos3');
 const mode=()=>p.evaluate(()=>{const c=document.querySelector('#remote-image'),o=document.querySelector('.resampled-view');return {mode:c.dataset.resampling,opacity:c.style.opacity,shown:!o.hidden}});
 streaming=true;
 await p.waitForFunction(()=>document.querySelector('#remote-image')?.dataset.resampling==='motion',null,{timeout:5000});
 const moving=await mode();assert.ok(!moving.shown&&moving.opacity==='','motion shows the source canvas');
 assert.ok(await seenOn(p)>150,'the picture is on screen in motion');
 const before=revision;await p.waitForTimeout(400);assert.ok(revision-before>=10,`frames keep flowing in motion (${revision-before} in 400 ms)`);
 assert.equal((await mode()).mode,'motion','stays in motion while frames keep coming');
 streaming=false;const stopped=Date.now();
 await p.waitForFunction(()=>document.querySelector('#remote-image')?.dataset.resampling==='lanczos3',null,{timeout:2000});
 const settled=await mode();assert.ok(settled.shown&&settled.opacity==='0','the settled picture is Lanczos3 again');
 assert.ok(await seenOn(p)>150,'the settled picture is on screen');
 console.log(`motion: ${revision-1} delta frames, Lanczos3 again ${Date.now()-stopped} ms after the last frame`);
 await p.locator('[data-action=stop-remote]').click();await ctx.close();
}
}finally{await endAll()}
await browser.close();
assert.deepEqual(errors,[]);
console.log('remote view ok');
