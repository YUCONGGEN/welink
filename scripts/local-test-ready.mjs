import fs from 'node:fs/promises';
// Only local integration services; no production accounts are created.
for(let attempt=0;attempt<40;attempt++){
 try{
  const health=await fetch('http://127.0.0.1:18246/health',{signal:AbortSignal.timeout(2000)});
  const entry=new URL((await fs.readFile('.local/dev-client/client.url','utf8')).trim());
  if(entry.origin!=='http://127.0.0.1:18746')throw Error('unexpected local client origin');
  const bootstrap=await fetch(entry,{redirect:'manual',signal:AbortSignal.timeout(2000)});
  if(health.ok&&bootstrap.status===303)break;
 }catch{}
 if(attempt===39)throw Error('local integration service did not become ready');
 await new Promise(resolve=>setTimeout(resolve,250));
}
