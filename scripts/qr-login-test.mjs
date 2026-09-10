import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
for(let n=0;n<120;n++){try{const health=await fetch('http://127.0.0.1:18246/health');if(health.ok)break}catch{}if(n===119)throw Error('local API not ready');await new Promise(r=>setTimeout(r,500))}
const entry=(await fs.readFile('.local/dev-client/client.url','utf8')).trim();
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const errors=[];
try{
 const desktop=await browser.newPage({viewport:{width:1100,height:740}});
 const phone=await browser.newPage({viewport:{width:390,height:844}});
 for(const p of [desktop,phone])p.on('pageerror',e=>errors.push(e.message));
 await phone.route('**/local/config',async route=>{const response=await route.fetch();const config=await response.json();await route.fulfill({response,json:{...config,platform:'android'}})});
 await phone.goto(entry);await phone.getByLabel('账号',{exact:true}).fill('qa_alice');await phone.getByLabel('密码',{exact:true}).fill('WeLink-test-only-2026!');await phone.getByRole('button',{name:'登录',exact:true}).click();await phone.locator('.rail').waitFor();
 await desktop.goto(entry);
 let challenge;
 async function code(button){const response=desktop.waitForResponse(r=>r.url().endsWith('/api/auth/qr')&&r.request().method()==='POST');await button.click();challenge=await (await response).json();assert.ok(challenge.payload.startsWith('welink://login/'));await desktop.locator('#qr-image img').waitFor();}
 await code(desktop.getByRole('button',{name:'使用二维码登录'}));
 await desktop.screenshot({path:'docs/screenshots/windows-qr-login.png'});
 await fs.writeFile('.local/qr-test.png',Buffer.from(challenge.image.split(',')[1],'base64'));
 await fs.writeFile('.local/qr-test-payload.txt',challenge.payload);
 await phone.evaluate(value=>window.WeLinkQrScanned(value),challenge.payload);
 await phone.locator('#qr-phone-confirm').waitFor();await desktop.getByText('扫码成功，请在手机上确认',{exact:true}).waitFor();assert.equal(await desktop.locator('.rail').count(),0);
 await phone.screenshot({path:'docs/screenshots/android-qr-confirmation.png'});
 await phone.locator('#qr-phone-cancel').click();await desktop.getByText('手机已取消登录，请刷新',{exact:true}).waitFor();assert.equal(await desktop.locator('.rail').count(),0);
 await code(desktop.locator('#qr-refresh'));await phone.evaluate(value=>window.WeLinkQrScanned(value),challenge.payload);await phone.locator('#qr-phone-confirm').click();await desktop.locator('.rail').waitFor();
 const phoneToken=await phone.evaluate(()=>localStorage.getItem('welink_token')),desktopToken=await desktop.evaluate(()=>localStorage.getItem('welink_token'));assert.notEqual(phoneToken,desktopToken);assert.equal(desktopToken.length,64);
 const replay=await fetch('http://127.0.0.1:18246/api/auth/qr/poll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:challenge.id,pollSecret:challenge.pollSecret})});assert.equal(replay.status,404);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks:['desktop QR rendering','phone confirmation','cancel keeps desktop signed out','explicit approval signs desktop in','independent session','replay rejected']},null,2));
}catch(error){console.error({pageErrors:errors});for(const context of browser.contexts())for(const page of context.pages())console.error(await page.locator("#auth-error").allTextContents());throw error}finally{await browser.close()}
