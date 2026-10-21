import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const dir='.local/audit-fixture',base='http://127.0.0.1:18288',password='Audit-local-only-2026!';
const entry=(await fs.readFile(dir+'/client.url','utf8')).trim();
const stamp=Date.now(),errors=[],checks=[];
async function api(path,token,body,method=body?'POST':'GET',status=200){
 const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;
}
async function register(name,tag){
 const email=tag+'-'+stamp+'@example.com',challenge=await api('/api/auth/email/code','',{email,purpose:'register'});
 const code=JSON.parse(await fs.readFile(dir+'/mail.json','utf8'))[email];
 return api('/api/auth/register','',{email,name,password,code,challengeId:challenge.challengeId});
}
const alice=await register('测试员工甲','alice'),bob=await register('测试员工乙','bob');
for(const account of [alice.user.number,alice.user.name])await api('/api/auth/login','',{account,password},'POST',401);
checks.push('号码和姓名均不能登录，邮箱登录正常');
const cid=(await api('/api/conversations',alice.token,{kind:'direct',members:[bob.user.id]})).id;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
async function makePage(mobile=false,native=false){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1100,height:780},isMobile:mobile,hasTouch:mobile,permissions:['microphone','camera']});
 if(native)await context.addInitScript(()=>{
  window.activityEvents=[];window.nativeInvitations=[];
  window.welinkDesktopSettings=async()=>({messageSound:true,closeToTray:true,trayAvailable:true});
  window.welinkDesktopUnread=async()=>{};window.welinkDesktopActivity=async(key,active)=>window.activityEvents.push({key,active});
  window.welinkDesktopClearActivities=async()=>{};window.welinkDesktopSave=async()=>{};
  window.welinkMessageNotifications=()=>{};window.welinkTakeNativeInviteAction=async()=>'';
  window.welinkMeetingNotify=async(code,title)=>{window.nativeInvitations.push({code,title});return true};window.welinkMeetingClear=()=>{};
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;
}
async function login(page,person=alice){await page.goto(entry);await page.getByLabel('邮箱',{exact:true}).fill(person.user.email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.shell').waitFor();}
let room;
try{
 const p=await makePage(false,true);let releaseConfig;const delayed=new Promise(r=>releaseConfig=r);
 await p.route('**/api/public-config',async route=>{await delayed;await route.fulfill({json:{registrationEnabled:true,emailAuthEnabled:false}})});
 await p.goto(entry);await p.getByLabel('邮箱',{exact:true}).waitFor({timeout:2500});await p.getByLabel('邮箱',{exact:true}).fill(alice.user.email);
 releaseConfig();await p.getByRole('button',{name:'注册账号',exact:true}).waitFor();assert.equal(await p.getByLabel('邮箱',{exact:true}).inputValue(),alice.user.email);
 await p.unroute('**/api/public-config');checks.push('配置延迟不阻塞邮箱登录，不清空输入，不退回旧号码登录');
 await p.route('**/api/ai/config',route=>route.fulfill({status:503,json:{error:'AI unavailable'}}));
 await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录',exact:true}).click();await p.locator('.shell').waitFor();
 await p.locator('[data-conversation="'+cid+'"]').click();
 const text='移除后保留的聊天 '+stamp;await p.locator('#composer').fill(text);await p.locator('#composer').press('Enter');await p.locator('.message .bubble').getByText(text,{exact:true}).waitFor();
 await p.locator('[data-conversation-menu="'+cid+'"]').click();await p.locator('[data-conversation-action=remove]').click();await p.locator('[data-conversation="'+cid+'"]').waitFor({state:'detached'});assert.equal(await p.locator('.modal').count(),0);
 await p.locator('#sidebar-search').fill(bob.user.number);await p.locator('[data-search-user="'+bob.user.id+'"]').click();await p.locator('.message .bubble').getByText(text,{exact:true}).waitFor();
 checks.push('AI 故障不影响进入；移除聊天无确认，搜索恢复历史');
 const group=await api('/api/conversations',alice.token,{kind:'group',members:[bob.user.id]});assert.equal(group.name,'测试员工甲、测试员工乙');
 await p.locator('#sidebar-search').fill(group.name);await p.locator('[data-group-join="'+group.id+'"]').click();await p.locator('#composer').waitFor();
 assert.equal(await p.locator('[data-action=remote-choices]').count(),0);assert.equal(await p.locator('.rail [data-nav=remote]').count(),0);
 checks.push('群名按人员姓名命名，群和左栏没有远程入口');
 await p.locator('.rail [data-action=settings]').click();await p.locator('[data-action=security]').click();await p.locator('[data-security=password]').click();
 await p.locator('.dialog-back').click();await p.getByRole('dialog',{name:'账号与安全',exact:true}).waitFor();await p.locator('.dialog-back').click();await p.getByRole('dialog',{name:'设置',exact:true}).waitFor();
 await p.locator('#pref-dark').check();await p.locator('#pref-message-sound').uncheck();await p.locator('.modal-head [data-action=close-modal]').click();assert.equal(await p.locator('body.dark').count(),1);
 checks.push('设置子页逐级返回，深色外观与提示音开关保留');
 await p.locator('.rail [data-nav=drive]').click();await p.locator('#drive-new-folder').click();await p.locator('#drive-rename').fill('项目资料');await p.locator('#drive-save-name').click();await p.locator('.cloud-folder').getByText('项目资料',{exact:true}).waitFor();
 const drive=await api('/api/drive',alice.token);assert.equal(drive.quota,5*1024**3);assert.ok(drive.folders.some(f=>f.name==='项目资料'));
 checks.push('网盘为 5 GB，可新建文件夹');
 room=await api('/api/meetings',bob.token,{title:'邀请回归',members:[alice.user.id]});await p.waitForFunction(()=>window.nativeInvitations.length>0);
 assert.equal(await p.locator('.meeting-invitation-notice').count(),0);await api('/api/meetings/'+room.code+'/end',bob.token,{});await p.waitForFunction(code=>window.activityEvents.some(e=>e.key==='meeting/'+code&&e.active===false),room.code);room=null;
 checks.push('桌面会议邀请使用原生桥接，结束后清理未读状态');
 for(const dark of [false,true]){
  const m=await makePage(true);await m.addInitScript(dark=>localStorage.setItem('welink_dark',String(dark)),dark);await login(m);await m.locator('[data-nav=meetings]').click();await m.locator('[data-action=meeting-join]').click();assert.equal(await m.locator('#meeting-camera').isChecked(),false);await m.locator('.dialog-back').click();
  assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await m.screenshot({path:dir+'/mobile-'+dark+'.png'});await m.context().close();
 }
 checks.push('移动布局无横向溢出，入会默认关闭摄像头');
 const reg=await makePage(true);await reg.goto(entry);await reg.getByRole('button',{name:'注册账号',exact:true}).click();assert.equal(await reg.locator('[name=account]').count(),0);await reg.getByLabel('姓名',{exact:true}).fill('注册员工');const email='ui-'+stamp+'@example.com';await reg.getByLabel('邮箱',{exact:true}).fill(email);await reg.getByLabel('密码',{exact:true}).fill(password);await reg.getByRole('button',{name:'获取验证码',exact:true}).click();await reg.getByText('验证码已发送，请查收邮箱（含垃圾邮件）。').waitFor();const code=JSON.parse(await fs.readFile(dir+'/mail.json','utf8'))[email];await reg.getByLabel('验证码',{exact:true}).fill(code);await reg.getByRole('button',{name:'注册并登录',exact:true}).click();await reg.locator('.shell').waitFor();checks.push('姓名＋邮箱验证码注册真实通过');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks},null,2));await fs.writeFile(dir+'/report.json',JSON.stringify({ok:true,checks},null,2));
}finally{if(room)await api('/api/meetings/'+room.code+'/end',bob.token,{}).catch(()=>{});await browser.close()}
