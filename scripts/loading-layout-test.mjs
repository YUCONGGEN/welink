import './local-test-ready.mjs';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const phase=process.argv[2]||'after',base='http://127.0.0.1:18246',password='Loading-layout-test-2026!',errors=[];
async function api(path,token,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200,path);return r.json()}
const credentials=JSON.parse(await fs.readFile('.local/storage-admin.json','utf8')),admin=await api('/api/auth/login','',credentials),people=[];
for(const name of ['加载测试员工','图片测试员工']){const {user}=await api('/api/admin/users',admin.token,{name,password});people.push(await api('/api/auth/login','',{account:user.number,password}))}
const [a,b]=people,cid=(await api('/api/conversations',a.token,{kind:'direct',members:[b.user.id]})).id,entry=(await fs.readFile('.local/dev-client/client.url','utf8')).trim();
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),page=await browser.newPage({viewport:{width:1100,height:740}}),counts={},delay=150;page.on('pageerror',e=>errors.push(e.message));
if(phase==='before'){
 for(const asset of ['app.js','usability.css']){
  const body=execFileSync('git',['show','1c603f1:internal/ui/assets/'+asset],{maxBuffer:8*1024*1024});
  await page.route('**/assets/'+asset,route=>route.fulfill({contentType:asset.endsWith('.js')?'text/javascript':'text/css',body}));
 }
}
await page.addInitScript(()=>{const observer=new MutationObserver(()=>{if(document.querySelector('.shell')){window.layoutShellReady=performance.now();observer.disconnect()}});observer.observe(document,{childList:true,subtree:true})});
await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;counts[p]=(counts[p]||0)+1;await new Promise(resolve=>setTimeout(resolve,delay));await route.continue()});
const ready=()=>page.locator('.shell').waitFor();
async function measureReload(){for(const k of Object.keys(counts))delete counts[k];await page.reload({waitUntil:'domcontentloaded'});await ready();const shellReadyMs=Math.round(await page.evaluate(()=>window.layoutShellReady));await page.waitForFunction(()=>!document.querySelector('.connection-state'));await page.waitForTimeout(700);return {shellReadyMs,requests:{...counts}}}
try{
 await page.goto(entry);await page.getByLabel('账号',{exact:true}).fill(a.user.number);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await ready();await page.locator('[data-conversation="'+cid+'"]').click();await page.locator('#composer').waitFor();
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1280;c.height=720;const x=c.getContext('2d');x.fillStyle='#b7dfff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#387aad';x.fillRect(48,48,400,240);return c.toDataURL('image/png').split(',')[1]});
 const form=new FormData();form.append('conversationId',cid);form.append('file',new Blob([Buffer.from(png,'base64')],{type:'image/png'}),'布局测试.png');const file=await(await fetch(base+'/api/files',{method:'POST',headers:{Authorization:'Bearer '+a.token},body:form})).json();assert.ok(file.id);const own=await api('/api/conversations/'+cid+'/messages',a.token,{kind:'image',attachmentId:file.id,clientId:'layout-own-'+Date.now()});
 await page.locator('[data-message="'+own.id+'"] img[data-preview-image]').waitFor();await page.waitForFunction(id=>document.querySelector('[data-message="'+id+'"] img[data-preview-image]')?.naturalWidth>0,own.id);
 const measure=()=>page.locator('[data-message="'+own.id+'"]').evaluate(row=>{const image=row.querySelector('img[data-preview-image]').getBoundingClientRect(),avatar=row.querySelector('.avatar').getBoundingClientRect(),bubble=row.querySelector('.image-bubble').getBoundingClientRect();return {gap:Math.round(avatar.left-image.right),imageWidth:Math.round(image.width),bubbleWidth:Math.round(bubble.width),overflow:row.scrollWidth>row.clientWidth}});
 const desktop=await measure();await page.setViewportSize({width:390,height:844});const mobile=await measure();await page.setViewportSize({width:1100,height:740});await page.screenshot({path:'.local/loading-layout-'+phase+'.png'});
 if(phase==='after'){
  for(const viewport of [{width:1100,height:740},{width:390,height:844}]){
   await page.setViewportSize(viewport);
   for(const mine of [false,true])for(const portrait of [false,true]){
    const geometry=await page.locator('[data-message="'+own.id+'"]').evaluate(async(row,{mine,portrait})=>{row.classList.toggle('mine',mine);const c=document.createElement('canvas');c.width=portrait?180:1280;c.height=720;const img=row.querySelector('img[data-preview-image]');img.src=c.toDataURL();await img.decode();const r=img.getBoundingClientRect(),a=row.querySelector('.avatar').getBoundingClientRect();return {gap:mine?a.left-r.right:r.left-a.right,width:r.width,height:r.height,overflow:row.scrollWidth>row.clientWidth}},{mine,portrait});
    assert.ok(geometry.gap>=0&&geometry.gap<=20,JSON.stringify({viewport,mine,portrait,geometry}));assert.equal(geometry.overflow,false);assert.ok(geometry.width>0&&geometry.height<=300);
   }
  }
  await page.setViewportSize({width:1100,height:740});
 }
 const runs=[];for(let i=0;i<3;i++)runs.push(await measureReload());const report={phase,addedRequestDelayMs:delay,desktop,mobile,runs,meanShellReadyMs:Math.round(runs.reduce((n,r)=>n+r.shellReadyMs,0)/runs.length)};await fs.writeFile('.local/loading-layout-'+phase+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(phase==='after'){assert.ok(desktop.gap>=0&&desktop.gap<=20,JSON.stringify(desktop));assert.ok(mobile.gap>=0&&mobile.gap<=20,JSON.stringify(mobile));assert.equal(desktop.overflow||mobile.overflow,false)}assert.deepEqual(errors,[]);
}finally{await browser.close()}
