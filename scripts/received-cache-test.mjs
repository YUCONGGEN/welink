import './local-test-ready.mjs';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const base='http://127.0.0.1:18246',stamp=Date.now(),password='WeLink-cache-test-2026!',errors=[];
async function api(path,token,body,method=body?'POST':'GET'){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 assert.equal(response.status,200,path);return response.json();
}
const credential=JSON.parse(await fs.readFile('.local/storage-admin.json','utf8'));
const admin=await api('/api/auth/login','',{account:credential.account,password:credential.password}),people=[];
for(const [i,name]of ['林知夏','陈予安','许星然'].entries()){
 const {user}=await api('/api/admin/users',admin.token,{name,account:'cache_'+i+'_'+stamp,password});
 people.push(await api('/api/auth/login','',{account:user.number,password}));
}
const [a,b,c]=people,cid=(await api('/api/conversations',a.token,{kind:'direct',members:[b.user.id]})).id;
const group=(await api('/api/conversations',b.token,{kind:'group',name:'缓存权限验证',members:[a.user.id]})).id;
const messages=[];
for(let i=0;i<85;i++)messages.push(await api('/api/conversations/'+cid+'/messages',b.token,{text:(i===0?'即将撤回的独有文本':i===1?'个人删除的独有文本':'缓存消息 '+String(i).padStart(3,'0'))+' '+stamp,clientId:'received-'+stamp+'-'+i}));
const quote=await api('/api/conversations/'+cid+'/messages',a.token,{text:'保留引用卡片',replyId:messages[0].id,clientId:'received-quote-'+stamp});
const groupMessage=await api('/api/conversations/'+group+'/messages',b.token,{text:'退群后清除这段缓存',clientId:'received-group-'+stamp});
const entry=(await fs.readFile('.local/dev-client/client.url','utf8')).trim(),profile='.local/received-cache-browser-'+stamp;
let context,page,offline=false,serverOverride='',delayResponse=null;
async function launch(mobile=false){
 context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:mobile?{width:390,height:844}:{width:1100,height:780},isMobile:mobile,hasTouch:mobile});
 await context.route('**/local/config',async route=>{if(!serverOverride)return route.continue();const response=await route.fetch();await route.fulfill({json:{...await response.json(),server:serverOverride}})});
 await context.route('**/api/**',async route=>{
  if(offline){await route.fulfill({status:503,json:{error:'测试网络暂时不可用'}});return}
  if(delayResponse&&new URL(route.request().url()).pathname===delayResponse.path&&route.request().method()==='GET'){
   const job=delayResponse;delayResponse=null;const response=await route.fetch();job.ready();await job.wait;await route.fulfill({response});return;
  }
  await route.continue();
 });
 await context.routeWebSocket('**/api/ws',ws=>{if(offline)ws.close();else ws.connectToServer()});
 page=context.pages()[0];page.on('pageerror',error=>errors.push(error.message));await page.goto(entry);
}
async function login(person){await page.getByLabel('账号',{exact:true}).fill(person.user.number);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.rail').waitFor()}
async function open(id=cid){await page.locator('[data-conversation="'+id+'"]').click();await page.locator('#composer').waitFor();}
async function cacheRows(){return page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('welink-local');request.onsuccess=()=>{const db=request.result,tx=db.transaction('cache'),r=tx.objectStore('cache').getAll();r.onsuccess=()=>resolve(r.result.filter(v=>v.scope?.startsWith('received:')).map(v=>({name:v.name,scope:v.scope,encrypted:v.iv instanceof Uint8Array&&v.cipher instanceof ArrayBuffer&&!v.data&&!v.token})));tx.oncomplete=()=>db.close()};request.onerror=()=>reject(request.error)}))}
async function decrypted(){return page.evaluate(async()=>{
 const rows=await new Promise((resolve,reject)=>{const r=indexedDB.open('welink-local');r.onsuccess=()=>{const db=r.result,tx=db.transaction('cache'),q=tx.objectStore('cache').getAll();q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close()};r.onerror=()=>reject(r.error)});
 const token=localStorage.getItem('welink_token'),key=await crypto.subtle.importKey('raw',Uint8Array.from(token.match(/../g),b=>parseInt(b,16)),{name:'AES-GCM'},false,['decrypt']),values=[];
 for(const row of rows)if(row.scope?.startsWith('received:'))try{values.push({name:row.name,value:JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:new TextEncoder().encode(row.scope+'\n'+row.name)},key,row.cipher)))})}catch{}
 return values;
})}
async function until(check,message){for(let i=0;i<100;i++){if(await check())return;await page.waitForTimeout(100)}throw Error(message)}
try{
 await launch();await login(a);await open();await page.locator('[data-message="'+quote.id+'"]').waitFor();
 await page.locator('[data-action=load-older]').click();await page.locator('[data-message="'+messages[0].id+'"]').waitFor();
 await open(group);await page.locator('[data-message="'+groupMessage.id+'"]').waitFor();
 assert.ok((await cacheRows()).every(row=>row.encrypted),'cache must contain ciphertext, not plaintext or tokens');
 const scope=(await cacheRows())[0].scope;
 await context.close();offline=true;await launch(true);await page.locator('.rail').waitFor();await open();
 await page.locator('[data-message="'+quote.id+'"]').waitFor();await page.locator('[data-action=load-older]').click();await page.locator('[data-message="'+messages[0].id+'"]').waitFor();
 assert.ok((await page.locator('#connection-status').innerText()).includes('离线查看'));
 await page.locator('[data-action=search-history]').first().click();await page.locator('#history-search').fill('缓存消息 020');await page.locator('#history-results').getByText('缓存消息 020 '+stamp,{exact:true}).waitFor();
 await page.locator('.modal [data-action=close-modal]').click();
 await page.locator('#composer').fill('离线时仍可保存待发送消息');await page.locator('#send-message').click();await page.locator('[data-outbox]').waitFor();
 await page.screenshot({path:'docs/screenshots/android-received-cache.png',style:'#toasts{visibility:hidden}'});
 await api('/api/messages/'+messages[0].id+'/recall',b.token,{});
 await api('/api/messages/'+messages[1].id,a.token,null,'DELETE');
 await api('/api/conversations/'+group+'/members/'+a.user.id,b.token,null,'DELETE');
 const newest=await api('/api/conversations/'+cid+'/messages',b.token,{text:'离线期间的新消息',clientId:'received-new-'+stamp});
 offline=false;
 await page.locator('[data-message="'+newest.id+'"]').waitFor({timeout:20000});
 await until(async()=>!(await page.locator('#connection-status').innerText()).includes('核对'),'cache reconciliation did not finish');
 await until(async()=>!(await cacheRows()).some(row=>row.name==='messages:'+group),'removed group cache remained');
 await page.locator('[data-action=load-older]').click();await page.locator('.recalled[data-message="'+messages[0].id+'"]').waitFor();
 assert.equal(await page.locator('[data-message="'+messages[1].id+'"]').count(),0);
 const plain=JSON.stringify(await decrypted());assert.ok(!plain.includes('即将撤回的独有文本')&&!plain.includes('个人删除的独有文本')&&!plain.includes('退群后清除这段缓存'),'redacted content remained in encrypted cache');
 await context.close();offline=true;await launch();await page.locator('.rail').waitFor();await open();await page.locator('[data-action=load-older]').click();await page.locator('.recalled[data-message="'+messages[0].id+'"]').waitFor();
 assert.equal(await page.locator('[data-message="'+messages[1].id+'"]').count(),0);
 await page.screenshot({path:'docs/screenshots/windows-received-cache.png',style:'#toasts{visibility:hidden}'});
 // The same token against a different configured backend must not restore this cache.
 await context.close();serverOverride='http://127.0.0.1:28246';await launch();await page.locator('#retry-connect').waitFor();assert.equal(await page.locator('.rail').count(),0);
 assert.ok((await cacheRows()).every(row=>row.scope===scope));
 await context.close();serverOverride='';offline=false;await launch();await page.locator('.rail').waitFor();await open();
 // Hold an old HTTP snapshot, then receive a recall over WebSocket before it returns.
 const racing=await api('/api/conversations/'+cid+'/messages',a.token,{text:'延迟响应不得恢复的原文',clientId:'received-race-'+stamp});
 await page.locator('[data-message="'+racing.id+'"]').waitFor();
 let ready,release;const fetched=new Promise(resolve=>ready=resolve),wait=new Promise(resolve=>release=resolve);delayResponse={path:'/api/conversations/'+cid+'/messages',ready,wait};
 const click=page.locator('[data-conversation="'+cid+'"]').click();await fetched;
 await api('/api/messages/'+racing.id+'/recall',a.token,{});await page.waitForTimeout(300);release();await click;await page.waitForTimeout(500);
 await page.locator('.recalled[data-message="'+racing.id+'"]').waitFor();
 assert.ok(!JSON.stringify(await decrypted()).includes('延迟响应不得恢复的原文'),'late snapshot resurrected recalled cache content');
 await page.locator('.rail-bottom [data-action=settings]').click();await page.locator('.modal [data-action=logout]').click();await page.getByLabel('账号',{exact:true}).waitFor();
 assert.equal((await cacheRows()).length,0,'explicit logout did not clear received cache');
 await login(c);await page.locator('.rail').waitFor();assert.equal(await page.locator('[data-conversation="'+cid+'"]').count(),0);
 assert.ok((await cacheRows()).every(row=>row.scope!==scope),'new account reused old scope');
 await api('/api/admin/users/'+c.user.id+'/password',admin.token,{password:'changed-cache-password-2026!'});
 await context.close();await launch();await page.getByLabel('账号',{exact:true}).waitFor();
 assert.equal((await cacheRows()).length,0,'revoked cold-start session retained received cache');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,checks:['encrypted received cache','desktop/mobile offline cold start and pagination','offline history search and outgoing queue','reconnect recall/delete/quote redaction','removed membership cache purge','backend/account/session isolation','late snapshot does not resurrect recall','logout and revoked-token cleanup']},null,2));
}catch(error){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-1800));throw error}finally{await context?.close()}
