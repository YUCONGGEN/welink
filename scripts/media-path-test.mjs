import './local-test-ready.mjs';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:18246',password='Local-media-path-2026!',stamp=Date.now(),errors=[];
const credential=JSON.parse(await fs.readFile('.local/storage-admin.json','utf8'));
async function api(path,token,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.equal(response.status,200,path);return data}
const admin=await api('/api/auth/login','',{account:credential.account,password:credential.password}),people=[];
for(let i=0;i<2;i++){const result=await api('/api/admin/users',admin.token,{name:i?'视频同事':'语音同事',account:'mp_'+i+'_'+stamp,password});people.push(await api('/api/auth/login','',{account:result.user.number,password}))}
const cid=(await api('/api/conversations',people[0].token,{kind:'direct',members:[people[1].user.id]})).id;
const entry=(await fs.readFile('.local/dev-client/client.url','utf8')).trim();
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
async function page(person,mode){
 const context=await browser.newContext({viewport:{width:1100,height:780},permissions:['camera','microphone']});
 await context.route('**/api/rtc-config',async route=>{const response=await route.fetch(),policy=await response.json();assert.equal(policy.relayEnabled,true);if(mode==='relay-tcp')for(const server of policy.iceServers)server.urls=server.urls.filter(u=>!u.startsWith('turn:')||u.endsWith('transport=tcp'));await route.fulfill({response,json:policy})});
 await context.addInitScript(({forced})=>{
  window.mediaPeers=[];window.mediaStreams=[];window.iceConfigurations=[];
  const Native=RTCPeerConnection;window.RTCPeerConnection=class extends Native{
   constructor(config){super(config);window.mediaPeers.push(this);window.iceConfigurations.push(config)}
   setConfiguration(config){window.iceConfigurations.push(config);return super.setConfiguration(config)}
   addIceCandidate(candidate){if(forced&&candidate?.candidate&&!candidate.candidate.includes(' typ relay '))return Promise.resolve();return super.addIceCandidate(candidate)}
   setRemoteDescription(description){if(forced)description={...description,sdp:description.sdp.split('\r\n').filter(line=>!line.startsWith('a=candidate:')||line.includes(' typ relay ')).join('\r\n')};return super.setRemoteDescription(description)}
  };
  const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async config=>{const stream=await get(config);window.mediaStreams.push(stream);return stream};
 },{forced:mode!=='direct'});
 const p=await context.newPage();p.on('pageerror',error=>errors.push(error.message));await p.goto(entry);await p.getByLabel('账号',{exact:true}).fill(person.user.number);await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录',exact:true}).click();await p.locator('.rail').waitFor();await p.locator('[data-conversation="'+cid+'"]').click();await p.locator('#composer').waitFor();return p;
}
async function media(p,relay,tcp){
 let previous;
 for(let attempt=0;attempt<90;attempt++){
  const value=await p.evaluate(async()=>{
   let audio=0,frames=0,relay=false,tcp=false,connected=false;
   for(const pc of window.mediaPeers){if(pc.connectionState!=='connected')continue;connected=true;const report=await pc.getStats();let pair;
    for(const value of report.values()){if(value.type==='inbound-rtp'){audio+=value.kind==='audio'?value.bytesReceived||0:0;frames+=value.kind==='video'?value.framesDecoded||0:0}if(value.type==='transport'&&value.selectedCandidatePairId)pair=report.get(value.selectedCandidatePairId)}
    if(pair){const local=report.get(pair.localCandidateId),remote=report.get(pair.remoteCandidateId);relay=local?.candidateType==='relay'||remote?.candidateType==='relay';tcp=local?.relayProtocol==='tcp'||remote?.relayProtocol==='tcp';}
   }
   return {audio,frames,relay,tcp,connected};
  });
  if(value.connected&&value.relay===relay&&(!tcp||value.tcp)&&previous&&value.audio>previous.audio&&value.frames>previous.frames)return value;
  previous=value;await p.waitForTimeout(500);
 }
 throw Error('Media did not sustain '+(relay?'relay':'direct')+' reception');
}
const results=[];
try{
 for(const mode of ['direct','relay-udp','relay-tcp']){
  const a=await page(people[0],mode),b=await page(people[1],mode);
  await a.locator('.chat-head [data-call-mode=video]').click();await b.locator('[data-call-answer=video]').click();await Promise.all([a,b].map(p=>p.locator('.meeting-room').waitFor()));
  const received=await Promise.all([a,b].map(p=>media(p,mode!=='direct',mode==='relay-tcp')));
  for(const p of[a,b]){const configurations=await p.evaluate(()=>window.iceConfigurations);assert.ok(configurations[0].iceServers.every(s=>s.urls.every(u=>u.startsWith('stun:'))));if(mode!=='direct')assert.ok(configurations.some(c=>c.iceServers.some(s=>s.urls.some(u=>u.startsWith('turn:')))))}
  await a.locator('#meeting-network').filter({hasText:mode==='direct'?'P2P 直连':'中转连接'}).waitFor();
  await a.screenshot({path:'.local/media-path-'+mode+'.png'});
  await a.locator('#meeting-leave').click();for(const p of[a,b]){await p.locator('.meeting-room').waitFor({state:'detached'});await p.waitForFunction(()=>window.mediaStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))&&window.mediaPeers.every(p=>p.connectionState==='closed'))}
  if(mode==='direct'){
   await a.locator('[data-nav=meetings]').click();await a.locator('[data-action=meeting-create]').click();await a.locator('#meeting-mic').uncheck();await a.locator('#meeting-camera').uncheck();await a.locator('#meeting-create-submit').click();await a.locator('.meeting-room').waitFor();
   await a.evaluate(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async config=>{if(config.video){window.delayedCameraReady=true;await new Promise(resolve=>window.resumeCamera=resolve);const stream=await original(config);window.delayedCameraFinished=true;return stream}return original(config)}});
   await a.locator('#meeting-video').click();await a.waitForFunction(()=>window.delayedCameraReady);await a.locator('#meeting-end').click();await a.locator('#meeting-confirm-leave').click();await a.locator('.meeting-room').waitFor({state:'detached'});await a.evaluate(()=>window.resumeCamera());await a.waitForFunction(()=>window.delayedCameraFinished&&window.mediaStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
  }
  results.push({mode,received,tracksReleased:true,lateCameraReleased:mode==='direct'});console.log(mode+': bidirectional audio/video and cleanup passed');
  await a.context().close();await b.context().close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,results},null,2));
}catch(error){for(const [i,context]of browser.contexts().entries())for(const p of context.pages()){await p.screenshot({path:'.local/media-path-failed-'+i+'.png'}).catch(()=>{});await fs.writeFile('.local/media-path-failed-'+i+'.txt',await p.locator('body').innerText().catch(()=>''))}throw error}finally{await browser.close()}
