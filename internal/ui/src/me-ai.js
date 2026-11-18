export function createMe({S,api,action,esc,icon,modal,closeModal,toast,refresh,selectConversation,renderSidebar,remote}){
 const $=s=>document.querySelector(s),localDesktop=()=>['windows','darwin'].includes(S.config.platform)&&config?.localTasks!==false;let config=null,local={workspace:'',available:false,linkmeTools:false},handledLinkMe=new Set(),generation=0,timer,task=null,seen=new Set(),starting=false;
 const active=()=>S.conversations.find(c=>c.id===S.active),live=g=>g===generation&&S.user&&!S.signingOut;
 async function start(){stop();const g=generation;try{const value=await api('/api/ai/config');if(!live(g))return;config=value;if(!value.enabled)return;if(localDesktop()){try{const prefs=await api('/local/ai/config');if(live(g))local=prefs}catch{}}if(live(g)){renderSidebar();poll()}}catch{}}
 function stop(){generation++;clearTimeout(timer);task=null;config=null;local={workspace:'',available:false};seen.clear();starting=false;$('#me-panel')?.remove()}
 function sidebar(){return config?.enabled&&!S.conversations.some(c=>c.peer?.id===config.user.id)?'<button class="conversation-row me-entry" data-me-open><span class="me-avatar">M</span><div class="row-text"><b>Me <em class="ai-label">AI</em></b><div class="row-preview">你的 AI 助手</div></div></button>':''}
 function render(){const panel=$('#me-panel');if(!panel||!active()?.peer?.ai)return;panel.classList.remove('hidden');
  if(!panel.querySelector('.me-config'))panel.innerHTML='<div class="me-config"><span class="ai-label">AI</span><span data-me-workspace></span><button class="text-btn" data-me-workspace-button>工作目录</button></div><div class="me-progress" role="status"><span data-me-status></span><button class="text-btn hidden" data-me-cancel>停止</button></div><div class="me-approvals"></div>';
  panel.querySelector('[data-me-workspace]').textContent=config?.localTasks===false?'对话模式 · 当前模型不支持本机任务':localDesktop()?(local.workspace?'本机：'+local.workspace:'对话模式 · 选择目录后可处理本机任务'):'记住本会话上下文 · 本机任务请在桌面端执行';
  panel.querySelector('[data-me-workspace-button]').classList.toggle('hidden',!localDesktop());
  const current=task?.conversationId===S.active?task:null,busy=starting||current?.state==='running';panel.querySelector('[data-me-status]').textContent=starting?'正在交给 Me…':current?.error||(current?.state==='running'?(()=>{const e=[...(current.events||[])].reverse().find(e=>e.type==='tool'&&e.details?.type==='linkmeTool');return e?'Me 正在操作 LinkMe：'+(toolNames[e.details.tool]||e.details.tool):'Me 正在处理…'})():current?.state==='completed'?'已完成':current?.state==='cancelled'?'已停止':'');
  panel.querySelector('[data-me-cancel]').classList.toggle('hidden',!current||!busy);
  const area=$('#messages'),near=area&&area.scrollHeight-area.clientHeight-area.scrollTop<100;let stream=$('#me-stream');if(current?.state==='running'&&current.text&&area){if(!stream){stream=document.createElement('article');stream.id='me-stream';stream.className='message me-stream';stream.innerHTML='<span class="avatar me-avatar">M</span><div class="message-body"><span class="message-name">Me · AI</span><div class="bubble"></div></div>';area.append(stream)}stream.querySelector('.bubble').textContent=current.text;if(near)area.scrollTop=area.scrollHeight}else stream?.remove();
  const approvals=panel.querySelector('.me-approvals'),pending=(current?.events||[]).filter(e=>e.type==='approval');
  for(const node of approvals.children)if(!pending.some(e=>e.id===node.dataset.approvalId))node.remove();
  for(const e of pending){if([...approvals.children].some(n=>n.dataset.approvalId===e.id))continue;const d=e.details||{},node=document.createElement('section');node.className='me-approval';node.dataset.approvalId=e.id;const question=e.method==='item/tool/requestUserInput';
   node.innerHTML='<b>'+esc(question?'Me 需要补充信息':'Me 请求执行操作')+'</b><p>'+esc(d.reason||'请查看以下内容后决定')+'</p>'+(question?(d.questions||[]).map(q=>'<label>'+esc(q.question||q.header)+'<textarea data-me-answer="'+esc(q.id)+'" maxlength="4000" placeholder="'+esc((q.options||[]).map(o=>o.label).join(' / '))+'"></textarea></label>').join(''):'<pre>'+esc(d.command||JSON.stringify(d.item||d.permissions||d,null,2)).slice(0,8000)+'</pre>')+'<div><button class="primary" data-me-approve>'+ (question?'提交回答':'允许这一次')+'</button><button class="secondary" data-me-deny>拒绝</button></div>';
   approvals.append(node);
  }
 }
 async function poll(){const g=generation;if(!config?.enabled||!live(g))return;try{if(task?.mode==='chat'){const result=await api('/api/ai/runs/'+task.id);if(live(g)){const text=task.text,version=task.version;Object.assign(task,result);if(version>(result.version||0)&&task.state==='running'){task.text=text;task.version=version}}}else if(localDesktop()){const result=await api('/local/ai/status');if(live(g)&&result.id){task={...result,mode:'local'};linkmeActions(task)}}if(live(g))render()}catch{}finally{if(live(g))timer=setTimeout(poll,task?.state==='running'?700:3000)}}
 // linkme-AIdex asks the open app to start remote assistance (the remote
 // screen lives in this window); each request is handled once.
 function linkmeActions(t){for(const e of t.events||[]){if(e.type!=='linkme'||handledLinkMe.has(e.id))continue;handledLinkMe.add(e.id);if(e.method==='remote'&&remote)remote(e.details||{}).catch(err=>toast(err.message))}}
 const toolNames={linkme_send_message:'发送消息',linkme_send_file:'发送文件',linkme_schedule_message:'设置定时消息',linkme_cancel_schedule:'取消定时消息',linkme_read_messages:'查看聊天',linkme_list_contacts:'查看联系人',linkme_list_schedules:'查看定时消息',linkme_remote_assist:'发起远程协助'};
 async function onSent(message){if(!config?.enabled||message.sender!==S.user?.id||seen.has(message.id))return;const c=S.conversations.find(c=>c.id===message.conversationId);if(!c?.peer?.ai)return;seen.add(message.id);if(seen.size>200)seen.delete(seen.values().next().value);const g=generation;starting=true;render();
  try{let result;if(localDesktop()&&local.workspace){if(!local.available)throw Error('本机任务组件未下载，请点“工作目录”下载；普通对话仍可使用。');result=await action('/local/ai/start',{messageId:message.id});if(live(g))task={...result,state:'running',mode:'local'}}else{result=await action('/api/ai/runs',{messageId:message.id,mode:'chat'});if(live(g))task={...(task?.id===result.id?task:{}),id:result.id,conversationId:result.conversationId,state:'running',mode:'chat'}}
  }catch(error){if(live(g)){task={conversationId:message.conversationId,state:'failed',error:error.message};toast(error.message)}}finally{if(live(g)){starting=false;render();clearTimeout(timer);poll()}}
 }
 async function workspace(){
  modal('Me 的本地工作目录','<p class="hint">Me 可以在此目录内读写文件和运行任务。需要额外权限时，会在聊天中向你确认。</p><label>工作目录<input id="me-workspace" placeholder="例如 E:\\工作文件" value="'+esc(local.workspace)+'"></label><p class="hint">清空目录后恢复为对话模式。</p><label class="me-allow"><input type="checkbox" id="me-linkme-tools" '+(local.linkmeTools?'checked':'')+'><span><b>允许 linkme-AIdex 代我操作 LinkMe</b><small>以你的身份查看好友和聊天、发消息、发送工作目录中的文件和图片、设置定时消息、发起远程协助邀请（对方仍需接受）。定时消息可在“设置 → 定时消息”中查看和取消。</small></span></label><div class="me-codex" id="me-codex" aria-live="polite"></div>','<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="me-save-workspace">保存</button>');
  codexRow();
  $('#me-save-workspace').onclick=async()=>{try{const value=await action('/local/ai/config',{workspace:$('#me-workspace').value.trim(),linkmeTools:$('#me-linkme-tools').checked});local.workspace=value.workspace;local.linkmeTools=!!value.linkmeTools;closeModal();render()}catch(error){toast(error.message)}};
 }
 // Me's local task component, shown to users as linkme-AIdex (OpenAI
 // Codex, Apache-2.0, notice in licenses.txt), is not in the installer; it is
 // downloaded from the user's own LinkMe server on demand, and updated
 // automatically when the server publishes a newer signed version.
 const mb=n=>(n/1048576).toFixed(n>=10485760?0:1)+' MB';let codexTimer;
 async function codexRow(){clearTimeout(codexTimer);const row=$('#me-codex');if(!row)return;let st;try{st=await api('/local/ai/codex')}catch{row.innerHTML='';return}if(!$('#me-codex'))return;
  if(st.installed&&!local.available){local.available=true;render()}
  let html='<b>本机任务组件</b>';
  if(!st.supported)html+='<p>当前系统暂不支持本机任务，普通对话仍可使用。</p>';
  else if(st.state==='downloading'){const pct=st.total?Math.floor(st.done*100/st.total):0;html+='<p>正在下载 linkme-AIdex '+esc(st.version)+'… '+mb(st.done)+' / '+mb(st.total)+'</p><progress max="100" value="'+pct+'"></progress><button class="text-btn" data-me-codex="cancel">取消下载</button>'}
  else if(st.state==='installed')html+='<p>已就绪'+(st.source==='downloaded'?' · linkme-AIdex '+esc(st.current):' · 使用本机已安装的组件')+'</p>';
  else if(st.state==='unavailable')html+='<p>'+esc(st.error||'服务器尚未提供 linkme-AIdex')+'</p>';
  else if(st.state==='outdated')html+='<p>已安装 linkme-AIdex '+esc(st.current)+'，可更新到 '+esc(st.version)+'（'+mb(st.size)+'）</p><button class="secondary" data-me-codex="install">更新</button>';
  else html+='<p>'+(st.state==='failed'?esc(st.error||'下载失败'):'处理本机文件需要先下载 linkme-AIdex '+esc(st.version)+'（约 '+mb(st.size)+'），之后自动更新。')+'</p><button class="secondary" data-me-codex="install">'+(st.state==='failed'?'重试':'下载')+'</button>';
  row.innerHTML=html;if(st.state==='downloading')codexTimer=setTimeout(codexRow,500)}
 document.addEventListener('click',async e=>{const c=e.target.closest('[data-me-codex]');if(!c)return;c.disabled=true;try{await action('/local/ai/codex/'+c.dataset.meCodex,{})}catch(error){toast(error.message)}codexRow()});
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-me-open],[data-me-workspace-button],[data-me-cancel],[data-me-approve],[data-me-deny]');if(!b)return;try{
  if(b.hasAttribute('data-me-open')){if(!config?.user)return;const c=await action('/api/conversations',{kind:'direct',members:[config.user.id]});await refresh();await selectConversation(c.id)}
  else if(b.hasAttribute('data-me-workspace-button'))await workspace();
  else if(b.hasAttribute('data-me-cancel')&&task){await action(task.mode==='local'?'/local/ai/cancel':'/api/ai/runs/'+task.id+'/cancel');task.state='cancelled';render()}
  else{const node=b.closest('.me-approval');if(!node||!task)return;const answers={};for(const input of node.querySelectorAll('[data-me-answer]'))answers[input.dataset.meAnswer]={answers:[input.value]};b.disabled=true;await action('/local/ai/approve',{taskId:task.id,id:node.dataset.approvalId,accept:b.hasAttribute('data-me-approve'),answers});node.remove()}
 }catch(error){toast(error.message);b.disabled=false}});
 function changed(type,d){if(!config?.enabled||!S.conversations.some(c=>c.id===d.conversationId&&c.peer?.ai))return;if(task?.id!==d.id)task={id:d.id,conversationId:d.conversationId,state:'running',mode:'chat',text:'',version:0};if(type==='ai-delta'){if(d.version<=(task.version||0))return;task.text=(task.text||'')+d.delta;task.version=d.version}else{task.state=d.state;task.error=d.error}render()}
 return {changed,start,stop,sidebar,mount:render,onSent,busy:()=>active()?.peer?.ai&&(starting||task?.state==='running'&&task?.conversationId===S.active)};
}
