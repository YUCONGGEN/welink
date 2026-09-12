export function createTransfers({S,api,esc,av,bytes,randomID,renderMessages,queueRefresh,toast}) {
 let generation=0,entries=[];const requests=new Set();
 const active=(owner,g)=>S.user&&S.token===owner&&generation===g&&!S.signingOut;
 function stop(){generation++;for(const xhr of requests)xhr.abort();requests.clear();entries=[]}
 function upload(path,file,fields={},onProgress=()=>{}) {
  const owner=S.token,g=generation;if(!S.user)return Promise.reject(Error('请先登录'));
  return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest(),form=new FormData();for(const [key,value]of Object.entries(fields))form.append(key,String(value));form.append('file',file,file.name);requests.add(xhr);
   const finish=(error,result)=>{requests.delete(xhr);if(error)reject(error);else if(!active(owner,g))reject(Object.assign(Error('账号已切换'),{name:'AbortError'}));else resolve(result)};
   xhr.open('POST',path);xhr.setRequestHeader('Authorization','Bearer '+owner);xhr.upload.onprogress=e=>{if(active(owner,g))onProgress(e.lengthComputable?Math.min(99,Math.floor(e.loaded/e.total*100)):null)};
   xhr.onload=()=>{let result;try{result=JSON.parse(xhr.responseText)}catch{return finish(Error('上传响应无效'))}if(xhr.status<200||xhr.status>=300)return finish(Object.assign(Error(result.error||'上传失败'),{status:xhr.status}));onProgress(100);finish(null,result)};
   xhr.onerror=()=>finish(Error('上传连接中断，请重新选择文件重试'));xhr.onabort=()=>finish(Object.assign(Error('上传已取消'),{name:'AbortError'}));xhr.send(form);
  });
 }
 async function chat(cid,body,file,metadata={}) {
  const owner=S.token,g=generation,id=randomID(),entry={id,cid,name:file.name,size:file.size,progress:0};entries.push(entry);renderMessages(true);
  try{const attachment=await upload('/api/files',file,{conversationId:cid,clientId:id,...(['voice','video'].includes(body.kind)?{mediaKind:body.kind}:{}),...metadata},percent=>{entry.progress=percent;renderMessages(true)});if(!active(owner,g))return;
   const payload={...body,clientId:id,attachmentId:attachment.id};if(payload.kind==='auto')payload.kind=/^image\/(png|jpeg|gif|webp)$/.test(attachment.mime)?'image':'file';const message=await api('/api/conversations/'+cid+'/messages',{method:'POST',body:payload});if(!active(owner,g))return;if(S.active===cid&&!S.historyMode&&!S.messages.some(m=>m.id===message.id))S.messages.push(message);queueRefresh(true);
  }catch(error){if(active(owner,g)&&error.name!=='AbortError'){entry.error=error.message;toast(error.message);throw error}}
  finally{if(active(owner,g)){if(!entry.error)entries=entries.filter(x=>x!==entry);renderMessages(true)}}
 }
 function html(cid){return entries.filter(e=>e.cid===cid).map(e=>`<article class="message mine pending-message">${av(S.user)}<div class="message-body"><div class="bubble"><b>${esc(e.name)}</b><small>${bytes(e.size)}</small></div><div class="outbox-status">${e.error?esc(e.error):e.progress===100?'正在生成消息…':'正在上传 '+(e.progress===null?'':e.progress+'%')}</div><small>大文件直接上传，请保持客户端运行</small></div></article>`).join('')}
 return {upload,chat,html,stop};
}
