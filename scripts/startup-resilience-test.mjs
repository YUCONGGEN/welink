import './local-test-ready.mjs';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:18246',password='Startup-resilience-2026!';
async function api(path,token,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200,path);return r.json()}
const credentials=JSON.parse(await fs.readFile('.local/storage-admin.json','utf8')),admin=await api('/api/auth/login','',credentials);
const {user}=await api('/api/admin/users',admin.token,{name:'启动回归员工',password});
const a=await api('/api/auth/login','',{account:user.number,password}),cid=(await api('/api/conversations',a.token,{kind:'direct',members:[admin.user.id]})).id;
const entry=(await fs.readFile('.local/dev-client/client.url','utf8')).trim(),errors=[],requests=[];
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),page=await browser.newPage();
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
let release;const delayed=new Promise(resolve=>release=resolve);
await page.route('**/api/public-config',async route=>{await delayed;await route.fulfill({json:{registrationEnabled:false}})});
try{
 await page.goto(entry,{waitUntil:'domcontentloaded'});
 await page.getByLabel('账号',{exact:true}).waitFor({timeout:3000});
 await page.getByLabel('账号',{exact:true}).fill(user.number);await page.getByLabel('密码',{exact:true}).fill(password);
 release();await page.waitForTimeout(200);
 assert.equal(await page.getByLabel('账号',{exact:true}).inputValue(),user.number);assert.equal(await page.getByLabel('密码',{exact:true}).inputValue(),password);
 assert.equal(await page.locator('[data-action=register]').count(),0);
 await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.shell').waitFor();
 await page.unroute('**/api/public-config');await page.route('**/api/public-config',route=>route.fulfill({status:503,json:{error:'测试公共配置不可用'}}));
 await page.reload();await page.locator('.shell').waitFor({timeout:3500});await page.waitForFunction(()=>!document.querySelector('.connection-state'));
 await page.locator('[data-conversation="'+cid+'"]').click();await page.locator('#composer').waitFor();await page.waitForTimeout(600);requests.length=0;
 await page.locator('#composer').fill('发送消息只刷新会话列表');await page.locator('#composer').press('Enter');await page.locator('.message .bubble').getByText('发送消息只刷新会话列表',{exact:true}).waitFor();await page.waitForTimeout(700);
 assert.ok(requests.includes('/api/conversations'));assert.equal(requests.filter(p=>['/api/friends','/api/requests','/api/group-requests','/api/contact-groups','/api/groups'].includes(p)).length,0);
 assert.deepEqual(errors,[]);console.log('PASS: delayed/failed public config does not block login, typed credentials preserved, self-registration disabled, messages do not reload the directory');
}finally{release();await browser.close()}
