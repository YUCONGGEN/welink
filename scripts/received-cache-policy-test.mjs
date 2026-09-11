import './local-test-ready.mjs';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:18246',stamp=Date.now(),password='WeLink-cache-policy-2026!',errors=[];
async function api(path,token,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200,path);return r.json()}
const credential=JSON.parse(await fs.readFile('.local/storage-admin.json','utf8')),admin=await api('/api/auth/login','',{account:credential.account,password:credential.password}),people=[];
for(let i=0;i<2;i++){const {user}=await api('/api/admin/users',admin.token,{name:'缓存容量测试'+i,account:'lim_'+i+'_'+stamp,password});people.push(await api('/api/auth/login','',{account:user.number,password}))}
const [a,b]=people,cid=(await api('/api/conversations',a.token,{kind:'direct',members:[b.user.id]})).id;
for(let i=0;i<84;i++)await api('/api/conversations/'+cid+'/messages',b.token,{text:'容量测试 '+i,clientId:'cache-policy-'+stamp+'-'+i});
const entry=(await fs.readFile('.local/dev-client/client.url','utf8')).trim();
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),context=await browser.newContext(),page=await context.newPage();
let offline=false,disabled=false,socketsEnabled=false,liveSocket,syncs=0;page.on('pageerror',error=>errors.push(error.message));
await context.routeWebSocket('**/api/ws',ws=>{if(socketsEnabled){liveSocket=ws;ws.connectToServer()}else ws.close()});
await context.route('**/api/**',async route=>{if(offline){await route.fulfill({status:503,json:{error:'测试离线'}});return}const path=new URL(route.request().url()).pathname;if(path.endsWith('/messages/sync'))syncs++;if(path==='/api/config'){const response=await route.fetch();await route.fulfill({json:{...await response.json(),receivedCacheMessages:disabled?0:12,receivedCacheBytes:20971520,receivedCacheDays:1,receivedCacheConversations:2}});return}await route.continue()});
async function rows(store='cache'){return page.evaluate(name=>new Promise((resolve,reject)=>{const r=indexedDB.open('welink-local');r.onsuccess=()=>{const db=r.result,tx=db.transaction(name),q=tx.objectStore(name).getAll();q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close()};r.onerror=()=>reject(r.error)}),store)}
async function open(){await page.locator('[data-conversation="'+cid+'"]').click();await page.locator('#composer').waitFor()}
async function until(check,message){for(let i=0;i<70;i++){if(await check())return;await page.waitForTimeout(100)}throw Error(message)}
try{
 await page.goto(entry);await page.getByLabel('账号',{exact:true}).fill(a.user.number);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.rail').waitFor();await open();await until(async()=>await page.locator('[data-message]').count()===60,'online view should not be limited by cache quota');
 // POST acknowledgments must populate the cache even when there is no WebSocket.
 await page.locator('#composer').fill('没有 WebSocket 也应缓存的已发送消息');await page.locator('#send-message').click();await until(async()=>!(await rows('queue')).length,'message did not deliver');
 // Reconnecting while browsing online history must preserve rows outside the cache quota.
 await page.locator('[data-action=search-history]').first().click();await page.locator('#history-search').fill('容量测试 0');await page.locator('[data-history-id]').first().click();
 await page.locator('[data-action=latest-messages]').waitFor();await until(async()=>await page.locator('[data-message]').count()===31,'online history context did not load');
 socketsEnabled=true;await until(async()=>syncs>0,'WebSocket did not reconcile');await until(async()=>!(await page.locator('#connection-status').innerText()).includes('核对'),'reconciliation did not finish');
 assert.equal(await page.locator('[data-message]').count(),31,'cache pruning removed online history rows');socketsEnabled=false;liveSocket.close();
 offline=true;await page.reload();await page.locator('.rail').waitFor();await open();await until(async()=>await page.locator('[data-message]').count()===12,'cache message limit not enforced');
 await page.locator('#messages').getByText('没有 WebSocket 也应缓存的已发送消息',{exact:true}).waitFor();
 await page.locator('#composer').fill('待发送内容不应被清理');await page.locator('#send-message').click();await until(async()=>(await rows('queue')).length===1,'offline outgoing queue missing');
 await page.locator('.rail-bottom [data-action=settings]').click();await page.locator('[data-received-cache]').click();await page.locator('#clear-received-cache').click();await until(async()=>!(await rows()).length,'clear cache left persisted rows');assert.equal((await rows('queue')).length,1);
 await page.reload();await page.locator('#retry-connect').waitFor();assert.ok(await page.evaluate(()=>localStorage.getItem('welink_token')),'clear cache erased login token');
 offline=false;await page.locator('#retry-connect').click();await page.locator('.rail').waitFor();await open();await until(async()=>(await rows()).some(row=>row.name==='/api/me'),'cache did not recover');
 // Logging out offline in one tab must also hide the same session in its sibling.
 const sibling=await context.newPage();sibling.on('pageerror',error=>errors.push(error.message));await sibling.goto(entry);await sibling.locator('.rail').waitFor();
 offline=true;await page.locator('.rail-bottom [data-action=settings]').click();await page.locator('.modal [data-action=logout]').click();await page.getByLabel('账号',{exact:true}).waitFor();await sibling.getByLabel('账号',{exact:true}).waitFor();await until(async()=>!(await rows()).length,'sibling window rewrote logged-out cache');await sibling.close();
 offline=false;await page.getByLabel('账号',{exact:true}).fill(a.user.number);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.rail').waitFor();await open();
 // Authentication failures are distinct from a corrupt local record.
 await page.goto(new URL('/assets/icon.svg',entry).href);
 await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('welink-local');r.onsuccess=()=>{const db=r.result,tx=db.transaction('cache','readwrite'),q=tx.objectStore('cache').openCursor();q.onsuccess=()=>{const cursor=q.result;if(cursor){if(cursor.value.name==='/api/me'){const row=cursor.value;row.cipher=new Uint8Array([1,2,3]).buffer;cursor.update(row)}cursor.continue()}};tx.oncomplete=()=>{db.close();resolve()}}}));
 offline=true;await page.goto(entry);await page.locator('#retry-connect').waitFor();assert.equal(await page.locator('.rail').count(),0);
 offline=false;await page.locator('#retry-connect').click();await page.locator('.rail').waitFor();await open();
 await page.goto(new URL('/assets/icon.svg',entry).href);
 await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('welink-local');r.onsuccess=()=>{const db=r.result,tx=db.transaction('cache','readwrite'),q=tx.objectStore('cache').openCursor();q.onsuccess=()=>{const cursor=q.result;if(cursor){const row=cursor.value;row.expires=Date.now()-1;cursor.update(row);cursor.continue()}};tx.oncomplete=()=>{db.close();resolve()}}}));
 offline=true;await page.goto(entry);await page.locator('#retry-connect').waitFor();assert.equal((await rows()).length,0,'expired entries remain');
 offline=false;disabled=true;await page.locator('#retry-connect').click();await page.locator('.rail').waitFor();await open();await until(async()=>!(await rows()).length,'server disable policy did not clear cache');
 assert.deepEqual(errors,[]);console.log('PASS: cache count limit, POST acknowledgments, clear without outbox deletion, sibling logout, corrupt/expired data, and server disable policy');
}catch(error){console.error((await page.locator('body').innerText()).slice(-1400));throw error}finally{await browser.close()}
