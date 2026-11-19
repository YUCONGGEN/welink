export function createMe({S,api,action,esc,icon,modal,closeModal,toast,refresh,selectConversation,renderSidebar,remote}){
 const $=s=>document.querySelector(s),localDesktop=()=>['windows','darwin'].includes(S.config.platform)&&config?.localTasks!==false;let config=null,local={workspace:'',available:false,linkmeTools:false,systemProxy:false},handledLinkMe=new Set(),generation=0,timer,task=null,seen=new Set(),starting=false;
 const active=()=>S.conversations.find(c=>c.id===S.active),live=g=>g===generation&&S.user&&!S.signingOut;
 async function start(){stop();const g=generation;try{const value=await api('/api/ai/config');if(!live(g))return;config=value;if(!value.enabled)return;if(localDesktop()){try{const prefs=await api('/local/ai/config');if(live(g))local=prefs}catch{}}if(live(g)){renderSidebar();poll()}}catch{}}
 function stop(){generation++;clearTimeout(timer);task=null;config=null;local={workspace:'',available:false};seen.clear();starting=false;$('#me-panel')?.remove()}
 function sidebar(){return config?.enabled&&!S.conversations.some(c=>c.peer?.id===config.user.id)?'<button class="conversation-row me-entry" data-me-open><span class="me-avatar">M</span><div class="row-text"><b>Me <em class="ai-label">AI</em></b><div class="row-preview">你的 AI 助手</div></div></button>':''}
 function render(){const panel=$('#me-panel');if(!panel||!active()?.peer?.ai)return;panel.classList.remove('hidden');
  if(!panel.querySelector('.me-config'))panel.innerHTML='<div class="me-config"><span class="ai-label">AI</span><span data-me-workspace></span><button class="text-btn" data-me-workspace-button>工作目录</button></div><div class="me-progress" role="status"><span data-me-status></span><button class="text-btn hidden" data-me-cancel>停止</button></div><div class="me-approvals"></div>';
  panel.querySelector('[data-me-workspace]').textContent=config?.localTasks===false?'对话模式 · 当前模型不支持本机任务':localDesktop()?(local.workspace?'本机：'+local.workspace:'对话模式 · 选择目录后可处理本机任务'):'记住本会话上下文 · 本机任务请在桌面端执行';
  panel.querySelector('[data-me-workspace-button]').classList.toggle('hidden',!localDesktop());
  const current=task?.conversationId===S.active?task:null,running=current?.state==='running',busy=starting||running,events=current?.events||[];
  const pending=events.filter(e=>e.type==='approval'),steps=events.map(stepView).filter(Boolean);
  panel.querySelector('[data-me-status]').textContent=starting||running?'':current?.error||(current?.state==='completed'?'已完成'+summary(current,steps):current?.state==='cancelled'?'已停止':'');
  panel.querySelector('[data-me-cancel]').classList.add('hidden'); // the live bubble has its own
  // While Me works, a live bubble in the chat shows what it is doing:
  // current activity and elapsed time, its plan, recent steps, the reply.
  const area=$('#messages'),near=area&&area.scrollHeight-area.clientHeight-area.scrollTop<120;let stream=$('#me-stream');
  if((starting||running)&&area){if(!stream){stream=document.createElement('article');stream.id='me-stream';stream.className='message me-stream';stream.innerHTML='<span class="avatar me-avatar">M</span><div class="message-body"><span class="message-name">Me · AI</span><div class="bubble me-live"><div class="me-live-head"><span class="me-dots"><i></i><i></i><i></i></span><span data-live-status></span><time data-live-time></time><button class="text-btn" data-me-cancel>停止</button></div><div class="me-thinking"></div><ol class="me-plan"></ol><ul class="me-steps"></ul><div class="me-approvals"></div><div class="me-reply"></div></div></div>';area.append(stream)}
   if(!current?.started&&running&&!current._t0)current._t0=Date.now();if(starting&&!startedAt)startedAt=Date.now();
   const t0=current?.started||current?._t0||startedAt,live=steps.filter(s=>s.status==='inProgress').pop(),text=current?.text||'',thinking=lastLine(current?.thinking);
   stream.querySelector('[data-live-status]').textContent=starting&&!running?'正在交给 Me…':pending.length?'等待你确认':live?live.text:text?'正在回复':'正在思考';
   stream.querySelector('[data-live-time]').textContent=t0?fmtTime(Date.now()-t0):'';
   const thinkingNode=stream.querySelector('.me-thinking');thinkingNode.textContent=text?'':thinking;thinkingNode.hidden=!thinkingNode.textContent;
   const plan=(events.find(e=>e.type==='plan')?.details?.plan)||[],planNode=stream.querySelector('.me-plan');planNode.hidden=!plan.length;planNode.innerHTML=plan.map(p=>'<li class="'+esc(p.status||'pending')+'">'+esc(p.step||'')+'</li>').join('');
   const shown=steps.slice(-6),stepsNode=stream.querySelector('.me-steps');stepsNode.hidden=!steps.length;stepsNode.innerHTML=(steps.length>shown.length?'<li class="more">前面还有 '+(steps.length-shown.length)+' 步</li>':'')+shown.map(s=>'<li class="'+esc(s.status||'completed')+'"><span>'+esc(s.text)+'</span>'+(s.code?'<code>'+esc(s.code)+'</code>':'')+(s.note?'<small>'+esc(s.note)+'</small>':'')+'</li>').join('');
   const reply=stream.querySelector('.me-reply');reply.textContent=text;reply.hidden=!text;
   stream.querySelector('[data-me-cancel]').hidden=!running;
   // Requests to approve appear in the same bubble, where the user is looking.
   const approvals=stream.querySelector('.me-approvals');let added=false;
   for(const node of approvals.children)if(!pending.some(e=>e.id===node.dataset.approvalId))node.remove();
   for(const e of pending){if([...approvals.children].some(n=>n.dataset.approvalId===e.id))continue;const node=document.createElement('section');node.className='me-approval';node.dataset.approvalId=e.id;node.innerHTML=approvalHTML(e);approvals.append(node);added=true}
   if(near||added)area.scrollTop=area.scrollHeight;if(added)approvals.querySelector('[data-me-approve]')?.focus({preventScroll:true})}else{stream?.remove();startedAt=0}
 }
 // shellCommand shows the command Me runs without the shell wrapper Codex
 // adds ("powershell.exe -Command '…'", "bash -lc '…'").
 function shellCommand(c){let s=String(Array.isArray(c)?c.join(' '):c||'').trim();const m=s.match(/^"?[^"\s]*?(?:powershell|pwsh|cmd|bash|zsh|sh)(?:\.exe)?"?\s+(?:-NoProfile\s+|-NoLogo\s+)*(?:-Command|-lc|-c|\/c)\s+([\s\S]+)$/i);if(m){s=m[1].trim();if(s.length>1&&(s[0]==="'"&&s.endsWith("'")))s=s.slice(1,-1).replace(/''/g,"'");else if(s.length>1&&s[0]==='"'&&s.endsWith('"'))s=s.slice(1,-1).replace(/\\"/g,'"')}return s}
 let startedAt=0;
 const fmtTime=ms=>{const s=Math.max(0,Math.floor(ms/1000));return s<60?s+' 秒':Math.floor(s/60)+' 分 '+String(s%60).padStart(2,'0')+' 秒'};
 const base=p=>String(p||'').split(/[\\/]/).pop();
 // The newest line of the model's reasoning summary, without markdown marks.
 const lastLine=t=>String(t||'').replace(/\*\*/g,'').split(/\n+/).map(s=>s.trim()).filter(Boolean).pop()||'';
 // stepView describes one step of a local task for people.
 function stepView(e){const d=e.details||{};
  if(e.type==='tool'&&d.type==='linkmeTool'){const p=d.params||{},who=[].concat(p.to||p.chat||[]).join('、');return {text:'LinkMe：'+(toolNames[d.tool]||d.tool)+(who?' → '+who:''),status:'completed',kind:'linkme'}}
  if(e.type!=='step')return null;
  const status=d.status==='inProgress'?'inProgress':d.status==='failed'||d.status==='declined'?'failed':'completed';
  switch(d.kind){
   case 'commandExecution':return {kind:d.kind,status:status==='completed'&&d.exitCode!=null&&d.exitCode!==0?'failed':status,text:'运行命令',code:shellCommand(d.command),note:d.status==='declined'?'已拒绝':d.exitCode!=null&&d.exitCode!==0?'退出码 '+d.exitCode:d.durationMs>=1000?fmtTime(d.durationMs):''};
   case 'fileChange':{const files=(d.files||[]).map(base);return {kind:d.kind,status,text:(status==='inProgress'?'正在修改 ':'修改了 ')+files.slice(0,3).join('、')+((d.count||files.length)>3?' 等 '+(d.count||files.length)+' 个文件':''),note:d.status==='declined'?'已拒绝':''}}
   case 'webSearch':return {kind:d.kind,status,text:'搜索网页'+(d.query?'：'+d.query:'')};
   case 'imageView':return {kind:d.kind,status,text:'查看图片 '+base(d.path)};
   case 'contextCompaction':return {kind:d.kind,status,text:'整理对话上下文'};
   default:return {kind:d.kind,status,text:'使用工具 '+(d.tool||'')}}}
 function summary(t,steps){const parts=[];const ms=(t.finished||0)-(t.started||0);if(t.started&&ms>0)parts.push('用时 '+fmtTime(ms));const n=k=>steps.filter(s=>s.kind===k).length;if(n('commandExecution'))parts.push('运行 '+n('commandExecution')+' 条命令');const files=steps.filter(s=>s.kind==='fileChange').length;if(files)parts.push('修改 '+files+' 处文件');if(n('linkme'))parts.push('操作 LinkMe '+n('linkme')+' 次');if(n('webSearch'))parts.push('搜索 '+n('webSearch')+' 次');return parts.length?' · '+parts.join(' · '):''}
 // approvalHTML shows what Me asks to do in plain words, with the details
 // underneath; commands and file edits can be allowed for the whole task.
 function approvalHTML(e){const d=e.details||{},item=d.item||{};
  if(e.method==='item/tool/requestUserInput')return '<b>Me 需要你补充信息</b>'+(d.reason?'<p>'+esc(d.reason)+'</p>':'')+(d.questions||[]).map(q=>'<label>'+esc(q.question||q.header)+'<textarea data-me-answer="'+esc(q.id)+'" maxlength="4000" placeholder="'+esc((q.options||[]).map(o=>o.label).join(' / '))+'"></textarea></label>').join('')+'<div><button class="primary" data-me-approve>提交回答</button><button class="secondary" data-me-deny>不回答</button></div>';
  let title='Me 请求执行操作',body='';
  if(e.method==='item/commandExecution/requestApproval'){title='Me 想运行一条命令';const command=d.command||item.command;body='<pre>'+esc(shellCommand(command).slice(0,4000))+'</pre>'+((d.cwd||item.cwd)?'<small>位置：'+esc(d.cwd||item.cwd)+'</small>':'')}
  else if(e.method==='item/fileChange/requestApproval'){title='Me 想修改文件';const files=(item.changes||[]).map(c=>c.path).filter(Boolean);body=files.length?'<ul class="me-files">'+files.slice(0,12).map(f=>'<li>'+esc(f)+'</li>').join('')+(files.length>12?'<li>等 '+files.length+' 个文件</li>':'')+'</ul>':''}
  else if(e.method==='item/permissions/requestApproval'){title='Me 需要额外权限';body='<pre>'+esc(JSON.stringify(d.permissions||d,null,2)).slice(0,4000)+'</pre>'}
  const always=/commandExecution|fileChange/.test(e.method);
  return '<b>'+esc(title)+'</b>'+(d.reason?'<p>'+esc(d.reason)+'</p>':'')+body+'<div><button class="primary" data-me-approve>允许</button>'+(always?'<button class="secondary" data-me-approve data-me-always title="本次任务中同类操作不再询问">本次任务都允许</button>':'')+'<button class="secondary" data-me-deny>拒绝</button></div>'}
 async function poll(){const g=generation;if(!config?.enabled||!live(g))return;try{if(task?.mode==='chat'){const result=await api('/api/ai/runs/'+task.id);if(live(g)){const text=task.text,version=task.version;Object.assign(task,result);if(version>(result.version||0)&&task.state==='running'){task.text=text;task.version=version}}}else if(localDesktop()){const result=await api('/local/ai/status');if(live(g)&&result.id){task={...result,mode:'local'};linkmeActions(task)}}if(live(g))render()}catch{}finally{if(live(g))timer=setTimeout(poll,task?.state==='running'?400:3000)}}
 // linkme-AIdex asks the open app to start remote assistance (the remote
 // screen lives in this window); each request is handled once.
 function linkmeActions(t){for(const e of t.events||[]){if(e.type!=='linkme'||handledLinkMe.has(e.id))continue;handledLinkMe.add(e.id);if(e.method==='remote'&&remote)remote(e.details||{}).catch(err=>toast(err.message))}}
 const toolNames={linkme_send_message:'发送消息',linkme_send_file:'发送文件',linkme_schedule_message:'设置定时消息',linkme_cancel_schedule:'取消定时消息',linkme_read_messages:'查看聊天',linkme_list_contacts:'查看联系人',linkme_list_schedules:'查看定时消息',linkme_remote_assist:'发起远程协助'};
 async function onSent(message){if(!config?.enabled||message.sender!==S.user?.id||seen.has(message.id))return;const c=S.conversations.find(c=>c.id===message.conversationId);if(!c?.peer?.ai)return;seen.add(message.id);if(seen.size>200)seen.delete(seen.values().next().value);
  // A picture or file sent with words arrives as two messages: wait briefly
  // for the words, then start one task that reads both.
  if(deferred){clearTimeout(deferred.timer);deferred=null}
  if(message.kind!=='text'){deferred={timer:setTimeout(()=>{deferred=null;run(message)},2000)};return}
  run(message);
 }
 let deferred=null;
 async function run(message){const g=generation;starting=true;render();
  try{let result;if(localDesktop()&&local.workspace){if(!local.available)throw Error('本机任务组件未下载，请点“工作目录”下载；普通对话仍可使用。');result=await action('/local/ai/start',{messageId:message.id});if(live(g))task={...result,state:'running',mode:'local'}}else{result=await action('/api/ai/runs',{messageId:message.id,mode:'chat'});if(live(g))task={...(task?.id===result.id?task:{}),id:result.id,conversationId:result.conversationId,state:'running',mode:'chat'}}
  }catch(error){if(live(g)){task={conversationId:message.conversationId,state:'failed',error:error.message};toast(error.message)}}finally{if(live(g)){starting=false;render();clearTimeout(timer);poll()}}
 }
 async function workspace(){
  modal('Me 的本地工作目录','<p class="hint">Me 可以在此目录内读写文件和运行任务。需要额外权限时，会在聊天中向你确认。</p><label>工作目录<input id="me-workspace" placeholder="例如 E:\\工作文件" value="'+esc(local.workspace)+'"></label><p class="hint">清空目录后恢复为对话模式。</p><label class="me-allow"><input type="checkbox" id="me-linkme-tools" '+(local.linkmeTools?'checked':'')+'><span><b>允许 linkme-AIdex 代我操作 LinkMe</b><small>以你的身份查看好友和聊天、发消息、发送工作目录中的文件和图片、设置定时消息、发起远程协助邀请（对方仍需接受）。定时消息可在“设置 → 定时消息”中查看和取消。</small></span></label><div class="me-codex" id="me-codex" aria-live="polite"></div><label class="me-allow me-proxy"><input type="checkbox" id="me-system-proxy" '+(local.systemProxy?'checked':'')+'><span><b>linkme-AIdex 通过系统代理连接服务器</b><small>默认直接连接服务器，开不开系统代理（如 127.0.0.1:7897）都能用。只有服务器必须经代理才能访问时才勾选。</small></span></label>','<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="me-save-workspace">保存</button>');
  codexRow();
  $('#me-save-workspace').onclick=async()=>{try{const value=await action('/local/ai/config',{workspace:$('#me-workspace').value.trim(),linkmeTools:$('#me-linkme-tools').checked,systemProxy:$('#me-system-proxy').checked});local.systemProxy=!!value.systemProxy;local.workspace=value.workspace;local.linkmeTools=!!value.linkmeTools;closeModal();render()}catch(error){toast(error.message)}};
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
  else{const node=b.closest('.me-approval');if(!node||!task)return;const answers={};for(const input of node.querySelectorAll('[data-me-answer]'))answers[input.dataset.meAnswer]={answers:[input.value]};for(const x of node.querySelectorAll('button'))x.disabled=true;await action('/local/ai/approve',{taskId:task.id,id:node.dataset.approvalId,accept:b.hasAttribute('data-me-approve'),always:b.hasAttribute('data-me-always'),answers});node.remove();render()}
 }catch(error){toast(error.message);b.disabled=false;for(const x of b.closest('.me-approval')?.querySelectorAll('button')||[])x.disabled=false}});
 function changed(type,d){if(!config?.enabled||!S.conversations.some(c=>c.id===d.conversationId&&c.peer?.ai))return;if(task?.id!==d.id)task={id:d.id,conversationId:d.conversationId,state:'running',mode:'chat',text:'',version:0};if(type==='ai-delta'){if(d.version<=(task.version||0))return;task.text=(task.text||'')+d.delta;task.version=d.version}else{task.state=d.state;task.error=d.error}render()}
 return {changed,start,stop,sidebar,mount:render,onSent,busy:()=>active()?.peer?.ai&&(starting||task?.state==='running'&&task?.conversationId===S.active)};
}
