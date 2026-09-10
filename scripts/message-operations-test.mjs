import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const base='http://127.0.0.1:18246',password='WeLink-test-only-2026!',stamp=Date.now();
async function api(path,token,body,method=body?'POST':'GET',status=200){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data}
for(let i=0;i<60;i++){try{if((await fetch(base+'/health')).ok)break}catch{}if(i===59)throw Error('Local backend not ready');await new Promise(r=>setTimeout(r,1000))}
const a=await api('/api/auth/register','',{account:'ops_a_'+stamp,name:'林知夏',password}),b=await api('/api/auth/register','',{account:'ops_b_'+stamp,name:'陈予安',password});
const request=await api('/api/requests',a.token,{userId:b.user.id,message:'消息操作验证'});await api('/api/requests/'+request.id,b.token,{accept:true});
const cid=(await api('/api/conversations',a.token,{kind:'direct',members:[b.user.id]})).id;
let sequence=0;
const send=(who,text,replyId='')=>api('/api/conversations/'+cid+'/messages',who.token,{text,replyId,clientId:'ops-'+stamp+'-'+(++sequence)});
const root=await send(b,'这条旧消息位于历史第一页之外');
for(let i=0;i<70;i++)await send(b,'旅行安排历史记录 '+String(i).padStart(2,'0'));
const quoted=await send(a,'引用之前讨论的行程',root.id),incoming=await send(b,'下周六上午九点出发，记得带上相机。');
const entry=(await fs.readFile('.local/dev-client/client.url','utf8')).trim().replace('[::]','127.0.0.1');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const errors=[];
async function pageFor(user,mobile=false){const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1100,height:740},hasTouch:mobile,isMobile:mobile,permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(entry);await page.getByLabel('账号',{exact:true}).fill(user.user.account);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator(`[data-conversation="${cid}"]`).click();await page.locator(`[data-message="${incoming.id}"]`).waitFor();return page}
const message=(page,id)=>page.locator(`[data-message="${id}"]`);
async function close(page){await page.locator('.modal-head [data-action=close-modal]').click()}
try{
 const desktop=await pageFor(a),phone=await pageFor(a,true),peer=await pageFor(b);
 await message(desktop,quoted.id).locator('.quote').getByText('陈予安：'+root.text,{exact:true}).waitFor();
 await message(desktop,incoming.id).locator('.bubble').click({button:'right'});await desktop.locator('.context-menu').getByText('复制文字',{exact:true}).click();assert.equal(await desktop.evaluate(()=>navigator.clipboard.readText()),incoming.text);
 await message(desktop,incoming.id).locator('.bubble').click({button:'right'});await desktop.screenshot({path:'docs/screenshots/windows-message-menu.png'});await desktop.locator('.context-menu').getByText('引用',{exact:true}).click();await desktop.getByLabel('输入消息').fill('收到，我们到时见！');await desktop.getByLabel('输入消息').press('Enter');await desktop.locator('.message').filter({hasText:'收到，我们到时见！'}).locator('.quote').waitFor();
 await desktop.locator('.chat-head [data-action=search-history]').click();await desktop.locator('#history-search').fill('旅行安排历史记录');await desktop.locator('.history-item').filter({hasText:'旅行安排历史记录 69'}).waitFor();assert.equal(await desktop.locator('.history-item').count(),60);
 await desktop.locator('.history-more').click();await desktop.locator('.history-item').filter({hasText:'旅行安排历史记录 00'}).waitFor();assert.equal(await desktop.locator('.history-item').count(),70);
 await desktop.locator('#history-sender').selectOption(a.user.id);await desktop.locator('#history-results').getByText('未找到相关消息').waitFor();await desktop.locator('#history-sender').selectOption('');await desktop.locator('#history-search').fill(root.text);await desktop.locator('.history-item').filter({hasText:root.text}).waitFor();await desktop.screenshot({path:'docs/screenshots/windows-history-search.png'});
 await desktop.locator(`[data-history-id="${root.id}"]`).click();await message(desktop,root.id).waitFor();assert.equal(await desktop.locator('.history-live-bar').count(),1);
 await desktop.locator('[data-action=latest-messages]').click();await message(desktop,incoming.id).waitFor();
 const bubble=message(phone,incoming.id).locator('.bubble');await bubble.scrollIntoViewIfNeeded();const rect=await bubble.boundingBox(),cdp=await phone.context().newCDPSession(phone);const point={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await phone.locator('.context-menu').waitFor();await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await phone.waitForTimeout(200);await phone.locator('.context-menu').waitFor();await phone.screenshot({path:'docs/screenshots/android-message-menu.png'});
 await phone.locator('.context-menu').getByText('收藏',{exact:true}).click();await phone.getByText('已收藏',{exact:true}).waitFor();
 await message(desktop,incoming.id).locator('.bubble').click({button:'right'});await desktop.locator('.context-menu').getByText('删除',{exact:true}).click();await desktop.locator('[data-action=modal-submit]').click();await message(desktop,incoming.id).waitFor({state:'detached'});await message(phone,incoming.id).waitFor({state:'detached'});assert.equal(await message(peer,incoming.id).count(),1);
 await phone.locator('.chat-head [data-action=search-history]').click();await phone.locator('#history-search').fill(incoming.text);await phone.locator('#history-results').getByText('未找到相关消息').waitFor();await close(phone);
 const recall=await send(a,'这条消息将被撤回');await message(desktop,recall.id).waitFor();const reply=await send(b,'引用了即将撤回的消息',recall.id);await message(desktop,reply.id).waitFor();await message(desktop,recall.id).locator('.bubble').click({button:'right'});await desktop.locator('.context-menu').getByText('撤回',{exact:true}).click();await message(phone,recall.id).getByText('你撤回了一条消息').waitFor();await message(peer,reply.id).locator('.quote').getByText('林知夏：消息已撤回',{exact:true}).waitFor();
 await desktop.reload();await desktop.locator(`[data-conversation="${cid}"]`).click();await message(desktop,reply.id).waitFor();assert.equal(await message(desktop,incoming.id).count(),0);await message(desktop,reply.id).locator('.quote').getByText('林知夏：消息已撤回',{exact:true}).waitFor();
 // Use the same two active devices to verify the account security flow.
 await phone.locator('.chat-head [data-action=back]').click();await phone.locator('[data-nav=profile]').click();await phone.locator('.utility-row[data-action=settings]').click();await phone.locator('[data-action=security]').click();await phone.locator('[data-security=devices]').click();await phone.locator('.device-current').waitFor();await phone.screenshot({path:'docs/screenshots/android-login-devices.png'});await phone.locator('#revoke-other-devices').click();await phone.locator('#device-confirm-revoke').click();await desktop.locator('#auth-form').waitFor();await phone.locator('.device-current').waitFor();assert.equal(await phone.locator('.device-row').count(),1);
 await phone.locator('[data-security=back]').click();await phone.locator('[data-security=password]').click();await phone.locator('#security-old-password').fill(password);await phone.locator('#security-new-password').fill(password+'new');await phone.locator('#security-repeat-password').fill(password+'new');await phone.locator('#password-save').click();await phone.getByRole('dialog',{name:'账号与安全',exact:true}).waitFor();
 await api('/api/auth/login','',{account:a.user.account,password},'POST',401);await api('/api/auth/login','',{account:a.user.account,password:password+'new'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks:['Windows context menu/copy/quote','Android touch long press','personal deletion sync and persistence','peer history and favorites retained','search paging/sender/context','mobile search','recall quote redaction','device revocation auto logout','password update']},null,2));
}finally{await browser.close()}
