import {openLocalStore,transaction,scopedRows,localGet,localPut} from './local-store.js';

export function createOutbox({sendLarge,S,api,toast,esc,av,bytes,randomID,Mentions,renderMessages,renderReply,queueRefresh,modal,closeModal}){
 const $=selector=>document.querySelector(selector);
 let scope='',generation=0,rows=[],drafts=new Map(),timer,working=false,controller,saveChain=Promise.resolve(),storageWarning=false;
 const scopeFor=()=>JSON.stringify([new URL(S.config.server).href.replace(/\/$/,''),(S.config.fingerprint||'').toLowerCase(),S.user?.id]);
 const alive=(g,key)=>g===generation&&key===scope&&S.user&&!S.signingOut;
 const draftID=cid=>JSON.stringify([scope,cid]);
 function storageError(error){if(!storageWarning){storageWarning=true;toast('无法保存到本机：'+(error.name==='QuotaExceededError'?'存储空间不足，请清理待发送文件':error.message))}}
 async function refreshRows(g=generation,key=scope){if(!key)return;const result=await scopedRows('queue',key);if(alive(g,key)){const next=result.sort((a,b)=>a.created-b.created||a.id.localeCompare(b.id));if(JSON.stringify(rows)!==JSON.stringify(next)){rows=next;renderMessages(true);updatePanel()}}}
 function stop(){generation++;scope='';clearTimeout(timer);controller?.abort();controller=null;rows=[];drafts.clear();working=false}
 async function start(){stop();const g=generation,key=scope=scopeFor();
  try{await openLocalStore();const saved=await scopedRows('drafts',key);if(!alive(g,key))return;for(const d of saved){drafts.set(d.cid,d);S.drafts[d.cid]=d.text;Mentions.restore(d.cid,d.text,d.mentions)}await refreshRows(g,key);storageWarning=false;kick()}catch(error){storageError(error)}
 }
 // Every input is queued immediately; conversation changes cannot overwrite a
 // later snapshot, and enqueue clears the draft in the same IDB transaction.
 function saveDraft(){if(!scope||!S.active||S.signingOut)return Promise.resolve();const cid=S.active,el=$('#composer');if(!el)return Promise.resolve();
  const d={id:draftID(cid),scope,cid,text:el.value,mentions:Mentions.payload().map(m=>({...m})),replyId:S.reply?.id||'',updated:Date.now(),revision:randomID()};drafts.set(cid,d);
  const task=saveChain.then(()=>localPut('drafts',d));saveChain=task.catch(storageError);return task;
 }
 async function restoreReply(cid){const d=drafts.get(cid),g=generation,key=scope;if(!d?.replyId)return;
  try{let m=S.messages.find(m=>m.id===d.replyId);if(!m){const messages=await api('/api/conversations/'+cid+'/messages?around='+encodeURIComponent(d.replyId));m=messages.find(m=>m.id===d.replyId)}if(!alive(g,key)||S.active!==cid||drafts.get(cid)!==d)return;if(m&&!m.recalled){S.reply=m;renderReply()}else{d.replyId='';S.reply=null;renderReply();await localPut('drafts',d);toast('草稿引用的消息已撤回或不可访问')}}catch(error){if(!alive(g,key)||S.active!==cid||drafts.get(cid)!==d)return;if(error.status===400||error.status===403||error.status===404){d.replyId='';S.reply=null;renderReply();await localPut('drafts',d)}else toast('引用暂未恢复，请联网后重试')}
 }
 async function enqueue(cid,body,file,metadata={},clearDraft=false){
  if(!scope||!S.user||S.signingOut)throw Error('请先登录再发送');if(file&&S.policy?.chatMaxAttachmentBytes>0&&file.size>S.policy.chatMaxAttachmentBytes)throw Error('文件超过服务器配置的大小限制');if(file?.size>(S.policy.chatPersistAttachmentBytes??50*1024*1024))return sendLarge(cid,body,file,metadata);
  const g=generation,key=scope,id=randomID(),draftRevision=drafts.get(cid)?.revision,record={id,scope:key,cid,body:{...body,clientId:id},created:Date.now(),state:'waiting',attempts:0,next:0,file:file?{name:file.name,type:file.type,size:file.size}:null,metadata};
  await saveChain;if(!alive(g,key))throw Error('登录账号已变化，请重新选择内容');
  try{await transaction(['queue','blobs','drafts'],'readwrite',(stores,done,abort)=>{const request=stores.queue.index('scope').getAll(key);request.onsuccess=()=>{
   if(request.result.length>=(S.policy.chatOfflineQueueMessages||100)||request.result.reduce((n,r)=>n+(r.file?.size||0),0)+(file?.size||0)>(S.policy.chatOfflineQueueBytes??250*1024*1024)){abort(Error('本机待发送队列已满，请先处理已有消息'));return}
   stores.queue.add(record);if(file)stores.blobs.put(file,id);if(clearDraft){const draft=stores.drafts.get(JSON.stringify([key,cid]));draft.onsuccess=()=>{if(draft.result?.revision===draftRevision)stores.drafts.delete(JSON.stringify([key,cid]))}}
  }});}catch(error){if(file&&alive(g,key))return sendLarge(cid,body,file,metadata);throw error}
  if(!alive(g,key))return;storageWarning=false;if(clearDraft&&drafts.get(cid)?.revision===draftRevision){drafts.delete(cid);S.drafts[cid]='';Mentions.clear(cid)}await refreshRows(g,key).catch(storageError);kick();
 }
 async function update(id,changes){await transaction(['queue'],'readwrite',stores=>{const r=stores.queue.get(id);r.onsuccess=()=>{if(r.result)stores.queue.put({...r.result,...changes})}})}
 async function remove(id){await transaction(['queue','blobs'],'readwrite',stores=>{stores.queue.delete(id);stores.blobs.delete(id)})}
 async function ack(message){if(!scope||message.sender!==S.user?.id||!message.clientId)return;const g=generation,key=scope;const row=await localGet('queue',message.clientId);if(row?.scope!==key||row.cid!==message.conversationId)return;await remove(row.id);await refreshRows(g,key)}
 function kick(){clearTimeout(timer);if(scope&&!working)timer=setTimeout(()=>work().catch(storageError),100)}
 async function request(path,options,g,key){
  if(!alive(g,key))throw Error('账号已切换');const native=typeof AbortController==='function'?new AbortController():null;let rejectAbort;
  const cancelled=new Promise((resolve,reject)=>{rejectAbort=reject}),pending={abort(){native?.abort();rejectAbort(Object.assign(Error('请求已中断'),{name:'AbortError'}))}};
  controller=pending;const timeout=setTimeout(()=>pending.abort(),65000);
  // Older Android WebViews cannot abort fetch. Stop the delivery chain anyway;
  // a late server commit is reconciled by its stable receipt on the next attempt.
  try{return await Promise.race([api(path,{...options,...(native?{signal:native.signal}:{})}),cancelled])}finally{clearTimeout(timeout);if(controller===pending)controller=null}
 }
 async function work(){if(working||!scope||!S.user||S.signingOut)return;working=true;const g=generation,key=scope;
  try{
   const pending=(await scopedRows('queue',key)).sort((a,b)=>a.created-b.created||a.id.localeCompare(b.id));if(!alive(g,key))return;
   // A failed or delayed earlier message holds later messages in that conversation.
   const seen=new Set(),candidate=pending.find(r=>{if(seen.has(r.cid))return false;seen.add(r.cid);return r.state!=='failed'&&r.next<=Date.now()});
   if(!candidate)return;const row=candidate;await update(row.id,{state:'sending',attempts:row.attempts+1});await refreshRows(g,key);
   try{
    if(row.attempts){const receipt=await request('/api/outbox/'+row.id,{},g,key);if(receipt.delivered){if(receipt.conversationId!==row.cid)throw Object.assign(Error('消息标识与会话不一致'),{status:409});await remove(row.id);if(alive(g,key)){if(S.active===row.cid&&!S.historyMode){const messages=await request('/api/conversations/'+row.cid+'/messages',{},g,key);if(alive(g,key)&&S.active===row.cid&&!S.historyMode)S.messages=messages}queueRefresh()}return}}
    let body={...row.body};
    if(row.file&&!row.attachment){const file=await localGet('blobs',row.id);if(!file)throw Object.assign(Error('本机附件已丢失，请重新选择文件'),{status:400});const form=new FormData();form.append('conversationId',row.cid);form.append('clientId',row.id);form.append('file',file,row.file.name);if(body.kind==='voice'||body.kind==='video')form.append('mediaKind',body.kind);for(const [k,v]of Object.entries(row.metadata))form.append(k,String(v));
     row.attachment=await request('/api/files',{method:'POST',body:form},g,key);if(!alive(g,key))return;await update(row.id,{attachment:row.attachment});
    }
    if(row.attachment){body.attachmentId=row.attachment.id;if(body.kind==='auto')body.kind=/^image\/(png|jpeg|gif|webp)$/.test(row.attachment.mime)?'image':'file'}
    if(!(await localGet('queue',row.id)))return;
    const message=await request('/api/conversations/'+row.cid+'/messages',{method:'POST',body},g,key);if(!alive(g,key))return;
    await remove(row.id);if(S.active===row.cid&&!S.historyMode&&!S.messages.some(m=>m.id===message.id)){S.messages.push(message);S.messages.sort((a,b)=>a.seq-b.seq)}queueRefresh();
   }catch(error){if(!alive(g,key))return;const permanent=error.status>=400&&error.status<500&&error.status!==408&&error.status!==429;await update(row.id,{state:permanent?'failed':'waiting',error:permanent?error.message:'网络异常，等待重试',next:Date.now()+(error.status===429?60000:Math.min(30000,2000*2**Math.min(row.attempts,4)))});}
  }finally{if(alive(g,key)){working=false;await refreshRows(g,key);timer=setTimeout(()=>work().catch(storageError),1000)}}
 }
 const status=row=>row.state==='sending'?'正在发送…':row.state==='failed'?row.error:row.error||'已保存，等待发送';
 function item(row,panel=false){const content=row.file?`<b>${esc(row.body.kind==='voice'?'语音':row.file.name)}</b><small>${bytes(row.file.size)}</small>`:esc(row.body.text);
  return `<article class="${panel?'outbox-row':'message mine pending-message'}" data-outbox="${row.id}">${panel?'':av(S.user)}<div class="message-body">${panel?'<b>'+esc(S.conversations.find(c=>c.id===row.cid)?.name||'原会话已不可访问')+'</b>':''}<div class="bubble">${content}</div><div class="outbox-status ${row.state==='failed'?'failed':''}" role="status">${esc(status(row))}</div><div class="outbox-actions">${row.state!=='sending'?'<button data-outbox-retry="'+row.id+'">重试</button>':''}<button data-outbox-remove="${row.id}">移除待发送</button></div></div></article>`;
 }
 function html(cid){return S.historyMode?'':rows.filter(r=>r.cid===cid&&!S.messages.some(m=>m.clientId===r.id&&m.sender===S.user?.id)).map(r=>item(r)).join('')}
 function updatePanel(){const panel=$('#outbox-list');if(panel)panel.innerHTML=rows.map(r=>item(r,true)).join('')||'<p class="empty-list">没有待发送消息</p>'}
 function show(){modal('待发送消息','<p class="hint">保存在此设备，登录同一服务器和账号后继续发送。每个会话依次发送；失败消息需重试或移除。</p><div id="outbox-list"></div>','',true);updatePanel()}
 document.addEventListener('click',async event=>{const button=event.target.closest('[data-outbox-open],[data-outbox-retry],[data-outbox-remove]');if(!button||!scope)return;const g=generation,key=scope;try{
  if(button.hasAttribute('data-outbox-open')){show();return}const id=button.dataset.outboxRetry||button.dataset.outboxRemove,row=rows.find(r=>r.id===id);if(!row)return;
  if(button.dataset.outboxRetry){await update(id,{state:'waiting',next:0,error:''});await refreshRows(g,key);kick();return}
  modal('移除待发送消息','<p class="hint">只移除此设备的待发送副本。如果服务器已经收到，这条消息仍会保留在聊天记录中，可在聊天里撤回。</p>','<button class="secondary" data-action="close-modal">保留</button><button class="primary" id="outbox-confirm-remove">移除</button>');
  $('#outbox-confirm-remove').onclick=async()=>{if(!alive(g,key))return;await remove(id);closeModal();await refreshRows(g,key);kick()};
 }catch(error){toast(error.message)}});
 window.addEventListener('online',kick);
 return {start,stop,kick,ack,html,saveDraft,restoreReply,enqueue,replyPlaceholder:cid=>drafts.get(cid)?.replyId?{id:drafts.get(cid).replyId,name:'原消息',text:'正在恢复引用…',kind:'text'}:null,scope:()=>scope,settingsRow:()=>'<div class="prefs-row"><span>本机待发送消息</span><button class="secondary" data-outbox-open>管理</button></div>'};
}
