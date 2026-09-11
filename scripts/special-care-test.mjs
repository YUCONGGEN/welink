import './local-test-ready.mjs';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const base='http://127.0.0.1:18246',password='WeLink-care-test-2026!',stamp=Date.now(),errors=[];
async function api(path,token,body,method=body?'POST':'GET'){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 assert.equal(response.status,200,path);return response.json();
}
const credential=JSON.parse(await fs.readFile('.local/storage-admin.json','utf8'));
const admin=await api('/api/auth/login','',{account:credential.account,password:credential.password}),people=[];
for(const [i,name]of ['林知夏','陈予安','许星然'].entries()){
 const {user}=await api('/api/admin/users',admin.token,{name,account:'care_'+i+'_'+stamp,password});
 people.push(await api('/api/auth/login','',{account:user.number,password}));
}
const [owner,bob,carol]=people;
const cid=(await api('/api/conversations',owner.token,{kind:'direct',members:[bob.user.id]})).id;
const first=await api('/api/conversations/'+cid+'/messages',bob.token,{text:'原来的聊天记录会保留。',clientId:'care-before-'+stamp});
const group=await api('/api/contact-groups',owner.token,{name:'家人与朋友'});
const entry=(await fs.readFile('.local/dev-client/client.url','utf8')).trim();
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const care=p=>p.locator('[data-contact-folder="special-care"]');
const row=(p,id)=>care(p).locator('[data-profile="'+id+'"]');
async function login(person,mobile=false){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1100,height:780},isMobile:mobile,hasTouch:mobile});
 const p=await context.newPage();p.on('pageerror',error=>errors.push(error.message));
 await p.goto(entry);await p.getByLabel('账号',{exact:true}).fill(person.user.number);await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录',exact:true}).click();await p.locator('.rail').waitFor();await p.locator('[data-nav=contacts]').click();return p;
}
async function hold(p,locator){
 const cdp=await p.context().newCDPSession(p),box=await locator.boundingBox();assert.ok(box);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+90,y:box.y+24}]});await p.waitForTimeout(650);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}
async function screenshot(p,name){await p.screenshot({path:'docs/screenshots/'+name,animations:'disabled',style:'#toasts{visibility:hidden}'})}
try{
 const desktop=await login(owner),phone=await login(owner,true),peer=await login(bob);
 await desktop.locator('[data-profile="'+bob.user.id+'"]').click({button:'right'});
 await desktop.locator('.context-menu [data-contact=attention]').getByText('设为特别关心',{exact:true}).click();
 await row(desktop,bob.user.id).waitFor();await row(phone,bob.user.id).waitFor();
 assert.equal(await row(phone,bob.user.id).locator('[aria-label="特别关心"]').count(),1);
 await peer.locator('#sidebar-search').fill(owner.user.number);await peer.locator('[data-profile="'+owner.user.id+'"]').click();assert.equal(await peer.locator('.contact-profile [aria-label="特别关心"]').count(),0);
 await hold(phone,row(phone,bob.user.id));await phone.locator('.context-menu [data-contact=attention]').getByText('取消特别关心',{exact:true}).click();await row(desktop,bob.user.id).waitFor({state:'detached'});
 await desktop.locator('[data-profile="'+bob.user.id+'"]').click();await desktop.locator('[data-contact=edit]').click();
 await desktop.locator('#contact-remark').fill('予安 · 家人');await desktop.locator('#contact-note').fill('重要的联系人，只有自己能看到备注。');await desktop.locator('#contact-folder').selectOption(group.id);await desktop.locator('#contact-special-care').check();
 await screenshot(desktop,'windows-special-care-settings.png');await desktop.locator('#contact-save').click();
 await row(phone,bob.user.id).filter({hasText:'予安 · 家人'}).waitFor();
 await desktop.locator('#sidebar-search').fill(carol.user.number);await desktop.locator('[data-profile="'+carol.user.id+'"]').click();await desktop.locator('.contact-profile [data-contact=attention]').click();
 assert.equal((await api('/api/conversations',owner.token)).length,1,'marking a never-chatted contact must not create a conversation');
 await desktop.locator('#sidebar-search').fill('');await row(desktop,carol.user.id).waitFor();await row(phone,carol.user.id).waitFor();
 await screenshot(desktop,'windows-special-care.png');await screenshot(phone,'android-special-care.png');
 await phone.locator('[data-contact=toggle][data-group-id=special-care]').click();assert.equal(await care(phone).locator('.contact-row').count(),0);
 await phone.reload();await phone.locator('.rail').waitFor();await phone.locator('[data-nav=contacts]').click();assert.equal(await phone.locator('[data-group-id=special-care]').getAttribute('aria-expanded'),'false');
 assert.equal(await care(desktop).locator('.contact-row').count(),2,'collapse state must be local to this device');await phone.locator('[data-group-id=special-care]').click();
 await hold(phone,row(phone,carol.user.id));await phone.locator('.context-menu [data-contact=delete]').click();await phone.locator('#contact-remove-confirm').click();await row(desktop,carol.user.id).waitFor({state:'detached'});
 // Special care never overrides mute, message order, or another owner's mark.
 await api('/api/conversations/'+cid,owner.token,{muted:true},'PATCH');
 const otherCID=(await api('/api/conversations',owner.token,{kind:'direct',members:[carol.user.id]})).id;
 await api('/api/conversations/'+otherCID+'/messages',carol.token,{text:'最新消息依然排在前面。',clientId:'care-newer-'+stamp});
 await desktop.locator('[data-nav=messages]').click();await desktop.locator('[data-conversation="'+otherCID+'"]').waitFor();
 assert.equal(await desktop.locator('#sidebar-content [data-conversation]').first().getAttribute('data-conversation'),otherCID);
 assert.equal(await desktop.locator('[data-conversation="'+cid+'"] [aria-label="特别关心"]').count(),1);
 assert.equal((await api('/api/conversations',owner.token)).find(c=>c.id===cid).muted,true);
 await desktop.locator('[data-conversation="'+cid+'"]').click();await desktop.locator('.chat-head [aria-label="特别关心"]').waitFor();
 await api('/api/contacts/'+owner.user.id,bob.token,{specialCare:true},'PATCH');
 await desktop.locator('[data-nav=contacts]').click();await row(desktop,bob.user.id).click({button:'right'});await desktop.locator('.context-menu [data-contact=delete]').click();await desktop.locator('#contact-remove-confirm').click();
 await row(phone,bob.user.id).waitFor({state:'detached'});
 const detail=await api('/api/contacts/'+bob.user.id,owner.token);assert.equal(!!detail.user.specialCare,false);assert.equal(detail.user.remark,'予安 · 家人');assert.equal(detail.user.contactGroupId,group.id);
 assert.equal((await api('/api/contacts/'+owner.user.id,bob.token)).user.specialCare,true);
 assert.ok((await api('/api/conversations/'+cid+'/messages',owner.token)).some(m=>m.id===first.id));
 await api('/api/conversations/'+cid+'/messages',bob.token,{text:'再次聊天，原来的记录还在。',clientId:'care-return-'+stamp});
 await desktop.locator('[data-nav=messages]').click();await desktop.locator('[data-conversation="'+cid+'"]').click();await desktop.getByText('原来的聊天记录会保留。',{exact:true}).waitFor();assert.equal(await desktop.locator('.chat-head [aria-label="特别关心"]').count(),0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,desktopContextMenu:true,mobileLongPress:true,privateAndSynced:true,markBeforeFirstChat:true,localCollapsePersistence:true,muteAndRecentOrderPreserved:true,removalKeepsRemarksAndHistory:true,otherOwnerUnchanged:true},null,2));
}catch(error){for(const[i,p]of browser.contexts().flatMap(context=>context.pages()).entries()){await p.screenshot({path:'.local/special-care-failed-'+i+'.png'}).catch(()=>{});await fs.writeFile('.local/special-care-failed-'+i+'.txt',await p.locator('body').innerText().catch(()=>''))}throw error}finally{await browser.close()}
