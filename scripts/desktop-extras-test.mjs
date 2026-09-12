import './local-test-ready.mjs';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:18246',stamp=Date.now(),password='Desktop-extras-test-2026!';
async function api(path,token,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200,path);return r.json()}
const adminConfig=JSON.parse(await fs.readFile('.local/storage-admin.json','utf8')),admin=await api('/api/auth/login','',{account:adminConfig.account,password:adminConfig.password}),people=[];
for(let i=0;i<2;i++){const {user}=await api('/api/admin/users',admin.token,{account:'dx_'+i+'_'+stamp,name:i?'陈予安':'林知夏',password});people.push(await api('/api/auth/login','',{account:user.number,password}))}
const [a,b]=people,cid=(await api('/api/conversations',a.token,{kind:'direct',members:[b.user.id]})).id;
const entry=(await fs.readFile('.local/dev-client/client.url','utf8')).trim(),errors=[],writes=[];
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),page=await browser.newPage({viewport:{width:1100,height:820},acceptDownloads:true});
page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&/^\/api\/(files|conversations\/.+\/messages)$/.test(new URL(request.url()).pathname))writes.push(request.url())});
await page.addInitScript(()=>{
 window.desktopPrefs={closeToTray:true,messageAlerts:true,trayAvailable:true,autoStart:false,startMinimized:true,hotkeysEnabled:true,showHotkey:'Ctrl+Alt+W',captureHotkey:'Ctrl+Alt+A',hotkeyErrors:{capture:'Ctrl+Alt+A 已被其他程序占用'}};
 window.welinkDesktopSettings=async()=>window.desktopPrefs;window.welinkDesktopSave=async p=>{if(p.showHotkey===p.captureHotkey&&p.hotkeysEnabled)throw Error('快捷键冲突');window.desktopPrefs={...window.desktopPrefs,...p}};window.welinkDesktopUnread=async()=>{};window.welinkDesktopExit=async()=>{};
 window.shotCopies=[];window.shotHeld=false;window.shotStarts=0;window.shotCancels=0;
 window.shotFixture=()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');ctx.fillStyle='#f7fbff';ctx.fillRect(0,0,640,360);ctx.fillStyle='#0099ff';ctx.fillRect(0,0,640,56);ctx.fillStyle='#fff';ctx.font='22px sans-serif';ctx.fillText('WeLink 项目计划',22,35);ctx.fillStyle='#334155';ctx.font='20px sans-serif';ctx.fillText('周五 14:00 · 会议室 A',35,100);ctx.fillText('确认设计稿，安排下一轮测试',35,155);for(let x=35;x<605;x+=8){ctx.fillStyle=x%3?'#93c5fd':'#1e40af';ctx.fillRect(x,220,4,85)}return canvas.toDataURL('image/png')};
 window.shotDeliver=()=>window.dispatchEvent(new CustomEvent('welink-screenshot-result',{detail:{image:window.shotFixture()}}));
 window.welinkScreenshotCapture=async()=>{window.shotStarts++;if(!window.shotHeld)setTimeout(window.shotDeliver,20);return true};window.welinkScreenshotCancel=async()=>{window.shotCancels++};window.welinkScreenshotCopy=async data=>window.shotCopies.push(data);
});
async function login(){await page.getByLabel('账号',{exact:true}).fill(a.user.number);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.rail').waitFor()}
async function waitFor(check,message){for(let i=0;i<90;i++){if(await check())return;await page.waitForTimeout(100)}throw Error(message)}
async function capture(){await page.evaluate(()=>window.dispatchEvent(new CustomEvent('welink-screenshot-request')));await page.locator('#screenshot-canvas').waitFor()}
async function draw(tool,from,to){await page.locator('[data-shot-tool="'+tool+'"]').click();const r=await page.locator('#screenshot-canvas').boundingBox();await page.mouse.move(r.x+from[0]*r.width/640,r.y+from[1]*r.height/360);await page.mouse.down();await page.mouse.move(r.x+to[0]*r.width/640,r.y+to[1]*r.height/360,{steps:8});await page.mouse.up();await page.waitForTimeout(60)}
const pixels=()=>page.locator('#screenshot-canvas').evaluate(c=>c.toDataURL());
try{
 await page.goto(entry);await page.getByLabel('账号',{exact:true}).waitFor();await capture();assert.equal(await page.locator('#screenshot-send').count(),0,'signed-out screenshot can send');await page.locator('#screenshot-copy').click();await page.waitForFunction(()=>window.shotCopies.length===1);assert.equal(writes.length,0);await page.keyboard.press('Escape');
 await login();await page.locator('.rail [data-action=settings]').click();await page.locator('[data-desktop=settings]').click();await page.getByText('Ctrl+Alt+A 已被其他程序占用',{exact:true}).waitFor();assert.equal(await page.locator('#desktop-auto-start').isChecked(),false);assert.equal(await page.locator('#desktop-start-minimized').isDisabled(),true);await page.locator('#desktop-auto-start').check();assert.equal(await page.locator('#desktop-start-minimized').isEnabled(),true);
 await page.locator('#desktop-capture-hotkey').focus();await page.keyboard.press('Control+Alt+W');await page.locator('#desktop-save').click();await page.locator('#desktop-save-error').getByText('Error: 快捷键冲突',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.desktopPrefs.captureHotkey),'Ctrl+Alt+A');
 await page.locator('#desktop-capture-hotkey').focus();await page.keyboard.press('Control+Shift+S');await page.locator('#desktop-message-alerts').uncheck();await page.screenshot({path:'docs/screenshots/windows-desktop-extras.png',style:'#toasts{visibility:hidden}',animations:'disabled'});await page.locator('#desktop-save').click();assert.equal(await page.evaluate(()=>window.desktopPrefs.captureHotkey),'Ctrl+Shift+S');assert.equal(await page.evaluate(()=>window.desktopPrefs.autoStart),true);
 await page.getByRole('dialog',{name:'设置',exact:true}).waitFor();await page.keyboard.press('Escape');
 await page.locator('[data-conversation="'+cid+'"]').click();await page.locator('#composer').waitFor();await page.locator('[data-action=screenshot]').click();await page.locator('#screenshot-canvas').waitFor();await page.locator('#screenshot-send').getByText('发送到 陈予安',{exact:true}).waitFor();const original=await pixels();assert.equal(writes.length,0,'capture auto-uploaded');
 await draw('rectangle',[25,67],[326,118]);assert.notEqual(await pixels(),original);await page.locator('#screenshot-undo').click();await waitFor(async()=>await pixels()===original,'undo did not restore pixels');
 await draw('rectangle',[25,67],[326,118]);await draw('arrow',[355,145],[325,104]);await draw('pen',[40,185],[260,180]);await draw('mosaic',[30,214],[330,314]);await page.locator('[data-shot-tool=text]').click();await page.locator('#screenshot-text').fill('这里需要确认');const rect=await page.locator('#screenshot-canvas').boundingBox();await page.mouse.click(rect.x+360*rect.width/640,rect.y+170*rect.height/360);await page.waitForTimeout(80);await page.screenshot({path:'docs/screenshots/windows-screenshot-editor.png',style:'#toasts{visibility:hidden}',animations:'disabled'});
 await page.locator('#screenshot-copy').click();await page.waitForFunction(()=>window.shotCopies.length===2);assert.notEqual(await page.evaluate(()=>window.shotCopies[1]),original);assert.equal(writes.length,0);
 const downloadPromise=page.waitForEvent('download');await page.locator('#screenshot-save').click();const download=await downloadPromise,data=await fs.readFile(await download.path());assert.equal(data.subarray(1,4).toString(),'PNG');assert.equal(data.readUInt32BE(16),640);assert.equal(data.readUInt32BE(20),360);assert.equal(writes.length,0);
 await page.locator('#screenshot-send').click();await waitFor(async()=>(await api('/api/conversations/'+cid+'/messages',a.token)).some(m=>m.kind==='image'),'confirmed screenshot not delivered');assert.equal(writes.filter(url=>url.endsWith('/messages')).length,1);
 await capture();await page.locator('.screenshot-editor .modal-head [data-action=close-modal]').click();await page.waitForTimeout(50);await capture();await page.keyboard.press('Escape');
 await page.evaluate(()=>window.shotHeld=true);await page.locator('[data-action=screenshot]').click();await page.locator('.rail [data-action=settings]').click();await page.locator('.modal [data-action=logout]').click();await page.getByLabel('账号',{exact:true}).waitFor();const count=writes.length;await page.evaluate(()=>window.shotDeliver());await page.waitForTimeout(300);assert.equal(await page.locator('#screenshot-canvas').count(),0,'late screenshot reopened after logout');assert.equal(writes.length,count);
 // A cancelled older browser capture must not stop a newer stream or show a stale error.
 const lifecycle=await browser.newPage();await lifecycle.setContent('<div id="overlays"></div>');
 const source=await fs.readFile('internal/ui/src/screenshots.js','utf8');
 const captureState=await lifecycle.evaluate(async source=>{
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),{createScreenshots}=await import(url);URL.revokeObjectURL(url);
  const notices=[],requests=[];Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getDisplayMedia:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))}});
  const capture=createScreenshots({S:{token:'',user:null,active:null,conversations:[]},modal:()=>{throw Error('cancelled capture opened a preview')},closeModal:()=>{},toast:value=>notices.push(value),esc:value=>value,upload:()=>{throw Error('unexpected upload')}});
  const first=capture.start();capture.reset();const second=capture.start();
  const canvas=document.createElement('canvas');canvas.width=canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);const nextStream=canvas.captureStream();let resumePlay;
  HTMLVideoElement.prototype.play=function(){return new Promise(resolve=>resumePlay=resolve)};
  requests[1].resolve(nextStream);await Promise.resolve();await Promise.resolve();requests[0].reject(Error('old provider cancelled'));await first;
  const newerStillLive=nextStream.getVideoTracks()[0].readyState==='live';capture.reset();resumePlay();await second;
  return{newerStillLive,released:nextStream.getVideoTracks()[0].readyState==='ended',notices};
 },source);await lifecycle.close();assert.deepEqual(captureState,{newerStillLive:true,released:true,notices:[]});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks:['configurable desktop shortcuts and startup controls','conflicts preserve settings','capture never sends without confirmation','annotate, mosaic and undo','copy and PNG download','explicit recipient delivery','close and reopen','logout discards late capture','late browser capture does not stop the next stream']},null,2));
}catch(error){console.error((await page.locator('body').innerText()).slice(-1300));throw error}finally{await browser.close()}
