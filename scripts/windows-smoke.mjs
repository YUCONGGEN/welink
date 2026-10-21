import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const exe=path.resolve(process.env.LINKME_WINDOWS_EXE||'dist/LinkMe-Windows.exe'),data=await fs.mkdtemp(path.resolve('.local/windows-smoke-')),report=path.join(data,'native-diagnostic.json');
await fs.mkdir(data,{recursive:true});await fs.unlink(report).catch(()=>{});
const p=spawn(exe,['-data',data,'-listen','127.0.0.1:0'],{windowsHide:true,stdio:'ignore',env:{...process.env,WELINK_DEBUG:'1'}});
try{
 let result;
 for(let i=0;i<100;i++){try{result=JSON.parse(await fs.readFile(report,'utf8'));break}catch{}if(p.exitCode!==null)throw Error('Native process exited before rendering');await new Promise(r=>setTimeout(r,250))}
	assert.ok(result,'WebView2 did not report rendered UI');assert.equal(result.ready,true);assert.equal(result.browserVisible,true,'WebView2 controller must be visible after a hidden launcher starts the app');assert.equal(result.server,'http://www.yucg.cn:8250');assert.equal(result.status,401);assert.equal(result.emailAuthEnabled,true);assert.equal(result.loginUsesEmail,true);assert.ok(result.width>=760&&result.height>=540);
 console.log(JSON.stringify({ok:true,nativeWindow:'WebView2',...result},null,2));
}finally{if(p.exitCode===null)p.kill()}
