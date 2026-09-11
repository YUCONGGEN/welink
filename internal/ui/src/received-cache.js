import {scopedRows,transaction} from './local-store.js';

const metadata=new Set(['/api/me','/api/config','/api/public-config','/api/conversations','/api/friends','/api/requests','/api/group-requests','/api/contact-groups']);
const encoder=new TextEncoder(),decoder=new TextDecoder();
const clone=value=>JSON.parse(JSON.stringify(value));
const classify=path=>{const url=new URL(path,location.origin),match=url.pathname.match(/^\/api\/conversations\/([a-f0-9]{32})(\/messages)?$/);return metadata.has(url.pathname)?{name:url.pathname,url}:match?{name:match[2]?'messages:'+match[1]:url.pathname,cid:match[1],messages:!!match[2],url}:null};
const temporary=error=>!error.status&&error.name!=='AbortError'||[408,502,503,504].includes(error.status);

export function createReceivedCache({S,toast,modal,closeModal,esc,bytes,connectionState,onReconciled}){
 let current=null;
 const identity=()=>JSON.stringify([new URL(S.config.server).href.replace(/\/$/,''),(S.config.fingerprint||'').toLowerCase(),S.token]);
 const alive=ctx=>current===ctx&&!ctx.dead&&ctx.token===S.token&&!S.signingOut&&ctx.identity===identity();
 const limits=ctx=>{const p=ctx.records.get('/api/config')?.data||S.policy||{};return {messages:p.receivedCacheMessages??5000,bytes:p.receivedCacheBytes??20*1024*1024,days:p.receivedCacheDays??30,conversations:p.receivedCacheConversations??100}};
 function warning(ctx){if(!ctx.warned&&alive(ctx)){ctx.warned=true;toast('本机聊天缓存暂时不可用，联网聊天不受影响')}}
 async function context(){
  if(!/^[a-f0-9]{64}$/.test(S.token)||!S.config.server||!crypto.subtle)return null;
  const key=identity();if(current?.identity===key)return current.ready;
  const ctx=current={identity:key,token:S.token,records:new Map(),revision:0,chain:Promise.resolve(),dead:false};
  ctx.ready=(async()=>{
   const digest=await crypto.subtle.digest('SHA-256',encoder.encode(key));ctx.scope='received:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
   ctx.key=await crypto.subtle.importKey('raw',Uint8Array.from(ctx.token.match(/../g),b=>parseInt(b,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);
   await transaction(['cache'],'readwrite',stores=>{const r=stores.cache.openCursor();r.onsuccess=()=>{const cursor=r.result;if(cursor){if(cursor.value.scope?.startsWith('received:')&&cursor.value.expires<Date.now())cursor.delete();cursor.continue()}}});
   for(const row of await scopedRows('cache',ctx.scope)){
    try{const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:encoder.encode(ctx.scope+'\n'+row.name)},ctx.key,row.cipher),value=JSON.parse(decoder.decode(plain));
     ctx.records.set(row.name,{...value,versions:new Map(),revision:0,size:plain.byteLength});
    }catch{ctx.records.set(row.name,{invalid:true,updated:0,size:0})}
   }
   if(alive(ctx))await flush(ctx,new Set());
   return ctx;
  })().catch(()=>{warning(ctx);return null});return ctx.ready;
 }
 function serial(ctx,work){const next=ctx.chain.then(()=>alive(ctx)?work():undefined);ctx.chain=next.catch(()=>warning(ctx));return next}
 function record(ctx,name,data){let row=ctx.records.get(name);if(!row||row.invalid){row={data,versions:new Map(),revision:0,updated:Date.now(),size:0};ctx.records.set(name,row)}return row}
 function prune(ctx,changed){
  const policy=limits(ctx),now=Date.now(),allowed=policy.messages>0&&policy.bytes>0;
  for(const [name,row]of ctx.records)if(!allowed||row.invalid||now-row.updated>policy.days*86400000){ctx.records.delete(name);changed.add(name)}
  let chats=[...ctx.records].filter(([name])=>name.startsWith('messages:')).sort((a,b)=>b[1].updated-a[1].updated);
  for(const [name]of chats.slice(policy.conversations)){ctx.records.delete(name);changed.add(name)}
  chats=chats.slice(0,policy.conversations);
  let count=chats.reduce((n,[,r])=>n+r.data.items.length,0);
  for(const [name,row]of [...chats].reverse())if(count>policy.messages){const remove=Math.min(row.data.items.length,count-policy.messages);row.data.items.splice(0,remove);count-=remove;changed.add(name)}
  for(const [,row]of chats){const retained=new Set([...row.data.items.map(m=>m.id),...row.data.deleted]);for(const id of row.versions.keys())if(!retained.has(id))row.versions.delete(id)}
  for(const name of changed){const row=ctx.records.get(name);if(row)row.size=encoder.encode(JSON.stringify({data:row.data,updated:row.updated})).byteLength}
  let total=[...ctx.records.values()].reduce((n,r)=>n+r.size,0);
  const ordered=[...ctx.records].sort((a,b)=>Number(!a[0].startsWith('messages:'))-Number(!b[0].startsWith('messages:'))||a[1].updated-b[1].updated);
  for(const [name,row]of ordered)if(total>policy.bytes){ctx.records.delete(name);changed.add(name);total-=row.size}
 }
 async function flush(ctx,changed){
  prune(ctx,changed);const writes=[];
  for(const name of changed){const row=ctx.records.get(name),id=JSON.stringify([ctx.scope,name]);if(!row){writes.push({id});continue}
   const iv=crypto.getRandomValues(new Uint8Array(12));
   const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(ctx.scope+'\n'+name)},ctx.key,encoder.encode(JSON.stringify({data:row.data,updated:row.updated})));
   writes.push({id,scope:ctx.scope,name,iv,cipher,expires:row.updated+limits(ctx).days*86400000});
  }
  if(!writes.length||!alive(ctx))return;
  await transaction(['cache'],'readwrite',stores=>{if(!alive(ctx))return;for(const row of writes)if(row.cipher)stores.cache.put(row);else stores.cache.delete(row.id)});
 }
 function merge(ctx,cid,items,ticket,changed,checked){
  const name='messages:'+cid,row=record(ctx,name,{items:[],deleted:[]}),map=new Map(row.data.items.map(m=>[m.id,m])),deleted=new Set(row.data.deleted);
  const returned=new Set(items.map(m=>m.id));
  if(checked)for(const id of checked)if(!returned.has(id)&&(row.versions.get(id)||0)<=ticket){map.delete(id);deleted.add(id);row.versions.set(id,ticket)}
  for(const message of items){if(message.conversationId!==cid||deleted.has(message.id)||(row.versions.get(message.id)||0)>ticket)continue;
   if(map.get(message.id)?.recalled&&!message.recalled)continue;
   map.set(message.id,clone(message));row.versions.set(message.id,ticket);
  }
  row.data={items:[...map.values()].sort((a,b)=>a.seq-b.seq),deleted:[...deleted].slice(-limits(ctx).messages)};row.updated=Date.now();changed.add(name);
  const conversations=ctx.records.get('/api/conversations');
  for(const conversation of conversations?.data||[]){if(conversation.id!==cid||!conversation.last)continue;
   if(deleted.has(conversation.last.id))conversation.last=row.data.items[row.data.items.length-1]||null;
   else if(map.has(conversation.last.id))conversation.last=clone(map.get(conversation.last.id));
   conversations.revision=Math.max(conversations.revision,ticket);
   changed.add('/api/conversations');
  }
 }
 async function remember(ctx,info,value,ticket){return serial(ctx,async()=>{
  const changed=new Set();
  let result=value;
  if(info.messages){
   merge(ctx,info.cid,value,ticket,changed);
   const row=ctx.records.get(info.name),returned=new Set(value.map(m=>m.id));
   const candidates=row.data.items.filter(m=>returned.has(m.id)||(row.versions.get(m.id)||0)>ticket),around=info.url.searchParams.get('around');
   result=around&&!candidates.some(m=>m.id===around)?[]:selectMessages(ctx,info,candidates);
  }
  else{
   const row=record(ctx,info.name,value);
   if(row.revision>ticket)return clone(row.data);row.data=clone(value);row.revision=ticket;row.updated=Date.now();changed.add(info.name);
   if(info.name==='/api/conversations'){
    const ids=new Set(value.map(c=>c.id));for(const name of ctx.records.keys())if(name.startsWith('messages:')&&!ids.has(name.slice(9))||/^\/api\/conversations\/[a-f0-9]{32}$/.test(name)&&!ids.has(name.slice(19))){ctx.records.delete(name);changed.add(name)}
   }
  }
  await flush(ctx,changed);
  return result;
 })}
 function selectMessages(ctx,info,source){
  const row=ctx.records.get(info.name);if(!row)return undefined;
  const q=info.url.searchParams;let items=(source||row.data.items).slice();const around=q.get('around');
  if(around){const at=items.findIndex(m=>m.id===around);if(at<0)throw Error('本机尚未缓存这条消息，请联网后查看');items=items.slice(Math.max(0,at-30),at+31)}
  const text=(q.get('q')||'').trim().toLowerCase(),kind=q.get('kind'),sender=q.get('sender'),before=Number(q.get('before')||Infinity),after=Number(q.get('after')||0),from=Number(q.get('from')||0),to=Number(q.get('to')||Infinity),user=ctx.records.get('/api/me')?.data?.id;
  items=items.filter(m=>m.seq<before&&m.seq>after&&m.created>=from&&m.created<to&&(!text||!m.recalled&&(m.text+' '+(m.fileName||'')).toLowerCase().includes(text))&&(!kind||!m.recalled&&m.kind===kind)&&(!sender||m.sender===sender)&&(!q.get('mentions')||!m.recalled&&(m.mentionRecipients||[]).includes(user)));
  return clone(around?items:after?items.slice(0,60):items.slice(-60));
 }
 async function cached(ctx,info){return serial(ctx,async()=>{await flush(ctx,new Set());const data=info.messages?selectMessages(ctx,info):ctx.records.get(info.name)?.data;return data===undefined?undefined:clone(data)})}
 async function dropConversation(ctx,cid){return serial(ctx,async()=>{
  const changed=new Set(['messages:'+cid,'/api/conversations/'+cid]);for(const name of changed)ctx.records.delete(name);
  const row=ctx.records.get('/api/conversations');if(row){row.data=row.data.filter(c=>c.id!==cid);changed.add('/api/conversations')}
  await flush(ctx,changed);
 })}
 async function run(path,options,network){
  const method=options.method||'GET',info=method==='GET'?classify(path):null,sent=method==='POST'&&/^\/api\/conversations\/[a-f0-9]{32}\/messages$/.test(path)?classify(path):null,ctx=info||sent?await context():null,ticket=ctx?++ctx.revision:0;
  let timer;
  try{
   const request=network().then(async value=>{if(ctx&&alive(ctx))try{if(sent){await serial(ctx,async()=>{const changed=new Set();merge(ctx,sent.cid,[value],ticket,changed);await flush(ctx,changed)})}else{const canonical=await remember(ctx,info,value,ticket);if(canonical!==undefined)return canonical}}catch{warning(ctx)}return value});
   if(!ctx||!info||!ctx.records.has(info.name)||options.signal)return await request;
   return await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('连接暂时不可用'),{status:504})),S.cacheView?0:6000)})]);
  }catch(error){
   if(error.status===401&&current===ctx)await forget();
   if(ctx&&info&&alive(ctx)){
    if(error.status===404&&info.messages&&info.url.searchParams.get('around'))await event('message-deleted',{id:info.url.searchParams.get('around'),conversationId:info.cid}).catch(()=>{});
    else if((error.status===403||error.status===404)&&info.cid)await dropConversation(ctx,info.cid).catch(()=>{});
    if(temporary(error)){
     const value=await cached(ctx,info).catch(()=>undefined);
     if(value!==undefined&&alive(ctx)){
      S.offline=true;S.cacheView=true;connectionState();
      if(info.name==='/api/friends')return value.map(u=>({...u,online:false}));
      if(info.name==='/api/conversations')return value.map(c=>({...c,...(c.peer?{peer:{...c.peer,online:false}}:{})}));
      return value;
     }
    }
   }
   throw error;
  }finally{clearTimeout(timer)}
 }
 async function identified(user){const ctx=await context();if(ctx){await remember(ctx,{name:'/api/me'},user,++ctx.revision).catch(()=>warning(ctx));await remember(ctx,{name:'/api/public-config'},{registrationEnabled:S.registrationEnabled},++ctx.revision).catch(()=>warning(ctx))}}
 async function event(type,message){
  const ctx=await context();if(!ctx||!alive(ctx)||!message?.conversationId)return;const ticket=++ctx.revision;
  await serial(ctx,async()=>{
   const changed=new Set();merge(ctx,message.conversationId,type==='message-deleted'?[]:[message],ticket,changed,type==='message-deleted'?[message.id]:null);
   if(type==='recall')for(const [name,row]of ctx.records)if(name.startsWith('messages:'))for(const item of row.data.items)if(item.reply?.id===message.id){item.reply={...item.reply,text:'',fileName:'',recalled:true};row.versions.set(item.id,ticket);changed.add(name)}
   if(type==='recall'){const row=ctx.records.get('/api/conversations');for(const c of row?.data||[])if(c.last?.reply?.id===message.id){c.last.reply={...c.last.reply,text:'',fileName:'',recalled:true};row.revision=Math.max(row.revision,ticket);changed.add('/api/conversations')}}
   await flush(ctx,changed);
  });
 }
 async function reconcile(network){
  const ctx=await context();if(!ctx||!alive(ctx))return;
  await ctx.chain;
  const batches=[...ctx.records].filter(([name])=>name.startsWith('messages:')).map(([name,row])=>({cid:name.slice(9),ids:row.data.items.map(m=>m.id)}));
  for(const {cid,ids}of batches){
   let denied=false;
   for(let at=0;at<ids.length;at+=200){
    if(!alive(ctx))return;const checked=ids.slice(at,at+200),ticket=++ctx.revision;
    try{const items=await network('/api/conversations/'+cid+'/messages/sync',{method:'POST',body:{ids:checked}});
     await serial(ctx,async()=>{const changed=new Set();merge(ctx,cid,items,ticket,changed,checked);await flush(ctx,changed)});
    }catch(error){if([403,404,405].includes(error.status)){denied=true;await dropConversation(ctx,cid);break}throw error}
   }
   if(alive(ctx))onReconciled(cid,clone(ctx.records.get('messages:'+cid)?.data.items||[]),ids,denied);
  }
 }
 async function forget(){const ctx=current;current=null;if(!ctx)return;ctx.dead=true;await ctx.ready;await ctx.chain.catch(()=>{});if(ctx.scope)await transaction(['cache'],'readwrite',stores=>{const request=stores.cache.index('scope').openCursor(ctx.scope);request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.delete();cursor.continue()}}}).catch(()=>{});ctx.records.clear()}
 async function show(){
  const ctx=await context();if(!ctx){toast('此设备暂不支持加密聊天缓存');return}await ctx.chain;
  const count=[...ctx.records].filter(([name])=>name.startsWith('messages:')).reduce((n,[,r])=>n+r.data.items.length,0),size=[...ctx.records.values()].reduce((n,r)=>n+r.size,0),policy=limits(ctx);
  modal('本机聊天缓存',`<p>已缓存 <b>${count}</b> 条消息 · ${esc(bytes(size))}</p><p class="hint">断网时可查看本机已加载的聊天记录。图片、语音、视频和文件内容仍需联网打开。</p><p class="hint">当前上限 ${policy.messages} 条消息、${esc(bytes(policy.bytes))}，保留 ${policy.days} 天。缓存与此服务器和登录会话绑定，退出登录会清除；不会删除服务器记录、草稿或待发送消息。</p>`,'<button class="secondary" data-action="close-modal">关闭</button><button class="primary" id="clear-received-cache">清理本机缓存</button>');
  document.querySelector('#clear-received-cache').onclick=async()=>{await forget();closeModal();toast('本机聊天缓存已清理，服务器记录仍保留')};
 }
 document.addEventListener('click',event=>{if(event.target.closest('[data-received-cache]'))show().catch(()=>toast('无法读取本机聊天缓存'))});
 return {run,identified,event,reconcile,forget,settingsRow:()=>'<div class="prefs-row"><span>本机聊天缓存</span><button class="secondary" data-received-cache>管理</button></div>'};
}
