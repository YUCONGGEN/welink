import './local-test-ready.mjs';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:18246',password='Local-media-path-2026!',stamp=Date.now(),errors=[];
const restartGlare=process.argv.includes('--restart-glare');
const repeats=Number(process.argv.find(arg=>arg.startsWith('--repeat='))?.split('=')[1]||1);
assert.ok(Number.isInteger(repeats)&&repeats>=1&&repeats<=10,'repeat must be between 1 and 10');
const credential=JSON.parse(await fs.readFile('.local/storage-admin.json','utf8'));
async function api(path,token,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.equal(response.status,200,path);return data}
const admin=await api('/api/auth/login','',{account:credential.account,password:credential.password}),people=[];
for(let i=0;i<2;i++){const result=await api('/api/admin/users',admin.token,{name:i?'视频同事':'语音同事',account:'mp_'+i+'_'+stamp,password});people.push(await api('/api/auth/login','',{account:result.user.number,password}))}
const cid=(await api('/api/conversations',people[0].token,{kind:'direct',members:[people[1].user.id]})).id;
const entry=(await fs.readFile('.local/dev-client/client.url','utf8')).trim();
// TURN is published on localhost by the isolated Docker service. After media
// permission Chrome enumerates physical adapters; explicitly include loopback
// so a UDP socket can reach this test-only TURN address. Production is unchanged.
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--allow-loopback-in-peer-connection']});
async function page(person,mode){
 const context=await browser.newContext({viewport:{width:1100,height:780},permissions:['camera','microphone']});
 await context.route('**/api/rtc-config',async route=>{const response=await route.fetch(),policy=await response.json();assert.equal(policy.relayEnabled,true);if(mode.startsWith('relay-'))for(const server of policy.iceServers)server.urls=server.urls.filter(u=>!u.startsWith('turn:')||u.endsWith('transport='+mode.slice(6)));await route.fulfill({response,json:policy})});
 await context.addInitScript(({forced})=>{
  window.mediaPeers=[];window.mediaStreams=[];window.iceConfigurations=[];window.negotiationTrace=[];
  const trace=(pc,event,extra={})=>window.negotiationTrace.push({at:Math.round(performance.now()),peer:window.mediaPeers.indexOf(pc),state:pc.signalingState,event,...extra});
  const hold=async(pc,stage)=>{if(window.holdSDP!==stage)return;window.holdSDP=null;trace(pc,'sdp-held',{stage});window.heldSDP=true;await new Promise(resolve=>window.resumeSDP=resolve);trace(pc,'sdp-resumed',{stage})};
  const Socket=WebSocket;window.WebSocket=class extends Socket{constructor(...args){super(...args);this.addEventListener('message',event=>{try{const message=JSON.parse(event.data);if(message.type==='signal')window.negotiationTrace.push({at:Math.round(performance.now()),event:'signal-received',type:message.signal})}catch{}})}};
  const Native=RTCPeerConnection;window.RTCPeerConnection=class extends Native{
   constructor(config){super(config);window.mediaPeers.push(this);window.iceConfigurations.push(config);for(const event of ['signalingstatechange','iceconnectionstatechange','connectionstatechange'])this.addEventListener(event,()=>trace(this,event,{ice:this.iceConnectionState,connection:this.connectionState}));this.addEventListener('icecandidateerror',event=>trace(this,'ice-gather-error',{code:event.errorCode,error:event.errorText,url:event.url}));this.addEventListener('icecandidate',event=>{if(event.candidate)trace(this,'candidate-gathered',{type:event.candidate.type,protocol:event.candidate.protocol})})}
   async createOffer(options){const description=await super.createOffer(options);await hold(this,'create');return description}
   async setLocalDescription(description){trace(this,'local-start',{type:description?.type});await hold(this,'local-'+description?.type);try{const result=await super.setLocalDescription(description);trace(this,'local-done',{type:description?.type});return result}catch(error){trace(this,'local-error',{type:description?.type,error:error.message});throw error}}
   setConfiguration(config){window.iceConfigurations.push(config);return super.setConfiguration(config)}
   async addIceCandidate(candidate){if(forced&&candidate?.candidate&&!candidate.candidate.includes(' typ relay '))return;await hold(this,'candidate');try{return await super.addIceCandidate(candidate)}catch(error){trace(this,'candidate-error',{error:error.message});throw error}}
   async setRemoteDescription(description){if(forced)description={...description,sdp:description.sdp.split('\r\n').filter(line=>!line.startsWith('a=candidate:')||line.includes(' typ relay ')).join('\r\n')};trace(this,'remote-start',{type:description.type});await hold(this,'remote-'+description.type);try{const result=await super.setRemoteDescription(description);trace(this,'remote-done',{type:description.type});return result}catch(error){trace(this,'remote-error',{type:description.type,error:error.message});throw error}}
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
  if(value.connected&&value.relay===relay&&value.tcp===tcp&&previous&&value.audio>previous.audio&&value.frames>previous.frames)return value;
  previous=value;await p.waitForTimeout(500);
 }
 const diagnostic=await p.evaluate(async()=>Promise.all(window.mediaPeers.map(async pc=>({connection:pc.connectionState,ice:pc.iceConnectionState,signaling:pc.signalingState,stats:[...((await pc.getStats()).values())].filter(value=>['inbound-rtp','candidate-pair','local-candidate','remote-candidate'].includes(value.type))}))));
 await fs.writeFile('.local/media-path-stats-'+(relay?'relay':'direct')+'.json',JSON.stringify(diagnostic,null,2));
 throw Error('Media did not sustain '+(relay?'relay':'direct')+' reception');
}
const results=[];
async function simultaneousRestart(a,b){
 const [polite,impolite]=people[0].user.id>people[1].user.id?[a,b]:[b,a];
 for(const stage of ['create','local-offer','remote-answer']){
  for(const p of[a,b]){await p.waitForFunction(()=>window.mediaPeers[0].signalingState==='stable');await p.evaluate(()=>window.negotiationTrace=[])}
  await polite.evaluate(stage=>{window.heldSDP=false;window.holdSDP=stage;window.mediaPeers[0].restartIce()},stage);
  await polite.waitForFunction(()=>window.heldSDP);
  assert.equal(await polite.evaluate(()=>window.mediaPeers[0].signalingState),stage==='remote-answer'?'have-local-offer':'stable');
  await impolite.evaluate(()=>window.mediaPeers[0].restartIce());
  await polite.waitForFunction(()=>window.negotiationTrace.some(e=>e.event==='signal-received'&&e.type==='offer'),null,{timeout:10000});
  if(stage==='create'){
   await polite.waitForFunction(()=>window.negotiationTrace.some(e=>e.event==='local-error'||e.event==='local-done'&&e.type==='answer'),null,{timeout:10000});
   assert.deepEqual(await polite.evaluate(()=>window.negotiationTrace.filter(e=>['local-error','remote-error','candidate-error'].includes(e.event))),[],'simultaneous ICE restart must accept an offer while local createOffer is pending');
  }
  await polite.evaluate(()=>window.resumeSDP());
  await polite.waitForFunction(()=>window.negotiationTrace.some(e=>e.event==='local-done'&&e.type==='answer'),null,{timeout:10000});
  for(const p of[a,b]){
   await p.waitForFunction(()=>window.mediaPeers[0].signalingState==='stable');
   assert.deepEqual(await p.evaluate(()=>window.negotiationTrace.filter(e=>['local-error','remote-error','candidate-error'].includes(e.event))),[],stage+' must negotiate without an invalid state');
  }
  await Promise.all([a,b].map(p=>media(p,false,false)));
  console.log('simultaneous ICE restart with delayed '+stage+': bidirectional media passed');
 }
 // A queued ICE operation must not swallow negotiationneeded when another track
 // is attached. This uses a real candidate and transceiver on the active call.
 for(const p of[a,b]){await p.waitForFunction(()=>window.mediaPeers[0].signalingState==='stable');await p.evaluate(()=>window.negotiationTrace=[])}
 await polite.evaluate(()=>{window.heldSDP=false;window.holdSDP='candidate'});
 await impolite.evaluate(()=>window.mediaPeers[0].restartIce());
 await polite.waitForFunction(()=>window.heldSDP,null,{timeout:10000});
 await polite.waitForFunction(()=>window.mediaPeers[0].signalingState==='stable');
 await polite.evaluate(()=>{window.negotiationNeeded=false;window.mediaPeers[0].addEventListener('negotiationneeded',()=>window.negotiationNeeded=true,{once:true});window.mediaPeers[0].addTransceiver('audio',{direction:'recvonly'})});
 await polite.waitForFunction(()=>window.negotiationNeeded);
 await polite.evaluate(()=>window.resumeSDP());
 await polite.waitForFunction(()=>window.negotiationTrace.some(e=>e.event==='local-done'&&e.type==='offer'),null,{timeout:10000});
 for(const p of[a,b]){await p.waitForFunction(()=>window.mediaPeers[0].signalingState==='stable');assert.deepEqual(await p.evaluate(()=>window.negotiationTrace.filter(e=>['local-error','remote-error','candidate-error'].includes(e.event))),[])}
 await Promise.all([a,b].map(p=>media(p,false,false)));
 console.log('track negotiation during pending ICE candidate: bidirectional media passed');
}
try{
 const modes=restartGlare?['direct']:process.argv.includes('--tcp-only')?['relay-tcp']:process.argv.includes('--udp-only')?['relay-udp']:['direct','relay-udp','relay-tcp'];
 for(const mode of Array.from({length:repeats},()=>modes).flat()){
  const a=await page(people[0],mode),b=await page(people[1],mode);
  await a.locator('.chat-head [data-call-mode=video]').click();await b.locator('[data-call-answer=video]').click();await Promise.all([a,b].map(p=>p.locator('.meeting-room').waitFor()));
  const received=await Promise.all([a,b].map(p=>media(p,mode!=='direct',mode==='relay-tcp')));
  if(restartGlare)await simultaneousRestart(a,b);
  for(const p of[a,b]){const configurations=await p.evaluate(()=>window.iceConfigurations);assert.ok(configurations[0].iceServers.every(s=>s.urls.every(u=>u.startsWith('stun:'))));if(mode!=='direct')assert.ok(configurations.some(c=>c.iceServers.some(s=>s.urls.some(u=>u.startsWith('turn:')))))}
  await a.locator('#meeting-network').filter({hasText:mode==='direct'?'P2P 直连':'中转连接'}).waitFor();
  await a.screenshot({path:'.local/media-path-'+mode+'.png'});
  await a.locator('#meeting-leave').click();for(const p of[a,b]){await p.locator('.meeting-room').waitFor({state:'detached'});await p.waitForFunction(()=>window.mediaStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))&&window.mediaPeers.every(p=>p.connectionState==='closed'))}
  if(restartGlare){
   for(const p of[a,b])await p.evaluate(()=>{window.negotiationTrace=[];window.heldSDP=false;window.resumeSDP=null;window.holdSDP='create'});
   await a.locator('.chat-head [data-call-mode=video]').click();await b.locator('[data-call-answer=video]').click();
   await Promise.all([a,b].map(p=>p.locator('.meeting-room').waitFor()));
   await Promise.any([a,b].map(p=>p.waitForFunction(()=>window.heldSDP,null,{timeout:10000})));
   await a.locator('#meeting-leave').click();
   for(const p of[a,b]){
    await p.locator('.meeting-room').waitFor({state:'detached'});
    if(await p.evaluate(()=>!!window.resumeSDP)){await p.evaluate(()=>window.resumeSDP());await p.waitForFunction(()=>window.negotiationTrace.some(e=>e.event==='sdp-resumed'))}
    await p.waitForFunction(()=>window.mediaStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))&&window.mediaPeers.every(p=>p.connectionState==='closed'));
    assert.equal(await p.getByText('会议信令处理失败：',{exact:false}).count(),0);
   }
   console.log('hang up while initial offer is pending: no stale signaling or retained tracks');
  }
  if(mode==='direct'){
   await a.locator('[data-nav=meetings]').click();await a.locator('[data-action=meeting-create]').click();await a.locator('#meeting-mic').uncheck();await a.locator('#meeting-camera').uncheck();await a.locator('#meeting-create-submit').click();await a.locator('.meeting-room').waitFor();
   await a.evaluate(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async config=>{if(config.video){window.delayedCameraReady=true;await new Promise(resolve=>window.resumeCamera=resolve);const stream=await original(config);window.delayedCameraFinished=true;return stream}return original(config)}});
   await a.locator('#meeting-video').click();await a.waitForFunction(()=>window.delayedCameraReady);await a.locator('#meeting-end').click();await a.locator('#meeting-confirm-leave').click();await a.locator('.meeting-room').waitFor({state:'detached'});await a.evaluate(()=>window.resumeCamera());await a.waitForFunction(()=>window.delayedCameraFinished&&window.mediaStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
  }
  results.push({mode,received,tracksReleased:true,lateCameraReleased:mode==='direct'});console.log(mode+': bidirectional audio/video and cleanup passed');
  await a.context().close();await b.context().close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,results},null,2));
}catch(error){for(const [i,context]of browser.contexts().entries())for(const p of context.pages()){await p.screenshot({path:'.local/media-path-failed-'+i+'.png'}).catch(()=>{});await fs.writeFile('.local/media-path-failed-'+i+'.txt',await p.locator('body').innerText().catch(()=>''));await fs.writeFile('.local/media-negotiation-failed-'+i+'.json',JSON.stringify(await p.evaluate(()=>window.negotiationTrace),null,2))}throw error}finally{await browser.close()}
