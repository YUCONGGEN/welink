import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const base='http://127.0.0.1:18246',password='WeLink-test-only-2026!';
const out=path.resolve('docs/screenshots');await fs.mkdir(out,{recursive:true});
async function api(url,token,body,method=body?'POST':'GET'){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const text=await r.text();if(!r.ok)throw Error(`${r.status}: ${text}`);return JSON.parse(text)}
async function account(account,name,avatar){let a;try{a=await api('/api/auth/register','',{account,name,password})}catch{a=await api('/api/auth/login','',{account,password})}await api('/api/me',a.token,{name,avatar,bio:'保持好奇，认真生活。'},'PATCH');return a}
const alice=await account('qa_alice','林知夏','blue'),bob=await account('qa_bob','陈予安','green'),carol=await account('qa_carol','许星然','purple');
for(const other of [bob,carol]){try{const q=await api('/api/requests',alice.token,{userId:other.user.id,message:'一起测试 WeLink'});await api('/api/requests/'+q.id,other.token,{accept:true})}catch(e){if(!e.message.startsWith('409'))throw e}}
const direct=await api('/api/conversations',alice.token,{kind:'direct',members:[bob.user.id]});
const secondary=await api('/api/conversations',alice.token,{kind:'direct',members:[carol.user.id]});
const groups=await api('/api/conversations',alice.token);let group=groups.find(c=>c.kind==='group');if(!group)group=await api('/api/conversations',alice.token,{kind:'group',name:'周末出游计划',members:[bob.user.id,carol.user.id]});
let stamp=Date.now();async function send(cid,who,text){return api('/api/conversations/'+cid+'/messages',who.token,{text,kind:'text',clientId:'ui-'+(++stamp)})}
await send(group.id,carol,'天气不错，这周末去公园走走吧 ☀️');await send(secondary.id,carol,'刚看到你发的照片，很喜欢那个颜色。');
await send(direct.id,bob,'知夏，下午的设计稿看了吗？');await send(direct.id,alice,'看到了，新的配色很舒服，整体比之前轻盈很多。');await send(direct.id,bob,'我把几个细节又调整了一下，想听听你的意见。');await send(direct.id,alice,'好呀，等下我们用远程协助一起看看 👋');await send(direct.id,bob,'没问题，我先把文件整理好。');
const entry=(await fs.readFile('.local/dev-client/client.url','utf8')).trim().replace('[::]','127.0.0.1');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const errors=[];
async function pageFor(width,height){const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(entry);await page.locator('#auth-form').waitFor();return page}
async function login(page){await page.getByRole('textbox',{name:'账号',exact:true}).fill('qa_alice');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.rail').waitFor()}
try{
 const desktop=await pageFor(1100,740);await desktop.screenshot({path:path.join(out,'windows-login.png')});await login(desktop);await desktop.locator(`[data-conversation="${direct.id}"]`).click();await desktop.locator('#composer').waitFor();await desktop.locator('#messages').getByText('没问题，我先把文件整理好。').last().waitFor();await desktop.locator('#messages').evaluate(e=>{e.style.scrollBehavior='auto';e.scrollTop=e.scrollHeight});await desktop.screenshot({path:path.join(out,'windows-chat.png')});
 const marker='自动化验证消息 '+Date.now();await desktop.getByLabel('输入消息').fill(marker);await desktop.getByLabel('输入消息').press('Enter');await desktop.locator('#messages').getByText(marker,{exact:true}).waitFor();
 const incoming='实时同步验证 '+Date.now();await send(direct.id,bob,incoming);await desktop.locator('#messages').getByText(incoming,{exact:true}).waitFor();
 const msg=desktop.locator('.message').filter({has:desktop.locator('.bubble').getByText(marker,{exact:true})});await msg.hover();await msg.getByRole('button',{name:'引用',exact:true}).click();await desktop.locator('#reply-draft').getByText('回复 林知夏：'+marker,{exact:true}).waitFor();await desktop.getByLabel('输入消息').fill('这条消息带有引用');await desktop.getByLabel('输入消息').press('Enter');await desktop.locator('.quote').filter({hasText:marker}).waitFor();
 await msg.hover();await msg.getByRole('button',{name:'收藏',exact:true}).click();await desktop.getByTitle('收藏',{exact:true}).first().click();await desktop.locator('#favorites-list').getByText(marker,{exact:true}).waitFor();
 await desktop.locator('[data-nav=contacts]').click();await desktop.locator(`[data-profile="${bob.user.id}"]`).click();await desktop.screenshot({path:path.join(out,'windows-contacts.png')});
 await desktop.locator(`[data-start-chat="${bob.user.id}"]`).click();await desktop.locator('#file-input').setInputFiles({name:'联调说明.txt',mimeType:'text/plain',buffer:Buffer.from('WeLink 文件上传下载测试')});await desktop.locator('.file-card').filter({hasText:'联调说明.txt'}).last().waitFor();
 await desktop.locator('[data-action=search-history]').first().click();await desktop.locator('#history-search').fill('实时同步验证');await desktop.locator('#history-results').getByText(incoming,{exact:true}).waitFor();await desktop.locator('[data-action=close-modal]').click();
 const mobile=await pageFor(390,844);await mobile.screenshot({path:path.join(out,'android-login.png')});await login(mobile);await mobile.screenshot({path:path.join(out,'android-messages.png')});await mobile.locator(`[data-conversation="${direct.id}"]`).click();await mobile.getByLabel('输入消息').waitFor();await mobile.locator('.file-card').filter({hasText:'联调说明.txt'}).last().waitFor();await mobile.locator('#messages').evaluate(e=>{e.style.scrollBehavior='auto';e.scrollTop=e.scrollHeight});await mobile.screenshot({path:path.join(out,'android-chat.png')});assert.equal(await mobile.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true,'mobile horizontal overflow');await mobile.locator('.chat-head [data-action=back]').click();await mobile.locator('.sidebar').waitFor({state:'visible'});
 await mobile.locator('[data-nav=profile]').click();await mobile.getByText('个人资料',{exact:true}).waitFor();await mobile.screenshot({path:path.join(out,'android-profile.png')});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks:['login','conversation','send','WebSocket receive','quote','favorites','contacts','file upload','history search','mobile navigation','mobile layout'],screenshots:out},null,2));
}finally{await browser.close()}
