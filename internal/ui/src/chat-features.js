import {replyHTML} from './docs-text.js';

// Feishu-style chat features: reactions, editing, pinned messages, urgent
// reminders, threads, polls and sign-ups, translation, AI summaries of unread
// messages, scheduled sending, file preview and personal status. app.js keeps
// the message list; this module adds to each message and handles the rest.

const REACTIONS=['👍','👌','❤️','😂','🎉','🙏','👏','💪','😮','😢','收到','赞','OK','辛苦了'];
const DAY=86400000;
const PREVIEW_TEXT=/\.(txt|md|markdown|csv|tsv|json|log|xml|ya?ml|ini|conf|js|ts|go|py|java|kt|c|h|cpp|cs|rb|php|sh|sql|css|html?)$/i;
const PREVIEW_MEDIA=/\.(png|jpe?g|gif|webp|bmp|mp4|webm|m4v|mov|mp3|wav|m4a|ogg)$/i;
const AS_DOC=/\.(docx|xlsx|csv|md|markdown)$/i;

export function createChatFeatures({S,api,esc,av,icon,modal,closeModal,toast,renderMessages,jumpMessage,messageMenu,Received,fileURL,download,Docs,shortTime,Mentions,queueRefresh,showPresence}){
 const $=s=>document.querySelector(s);
 const translations=new Map(),pins=new Map(),statuses=new Map();
 let aiEnabled=false,summary=null,thread=null,urgentQueue=[],urgentShowing=null,beep=null,autoStatus='',statusTimer=0;
 const me=()=>S.user?.id;
 const find=id=>S.messages.find(m=>m.id===id)||thread?.replies.find(m=>m.id===id)||(thread?.root?.id===id?thread.root:null);
 function nameOf(id){if(id===me())return '我';for(const m of S.messages)if(m.sender===id&&m.name)return m.name;const f=(S.friends||[]).find(u=>u.id===id);if(f)return f.remark||f.name;const c=(S.conversations||[]).find(c=>c.peer?.id===id);return c?.peer?.name||'成员'}
 const parse=t=>{try{return JSON.parse(t||'{}')}catch{return {}}};
 function replace(m){
  let hit=false;const i=S.messages.findIndex(x=>x.id===m.id);if(i>=0){S.messages[i]={...S.messages[i],...m};hit=true}
  if(thread){if(thread.root.id===m.id){thread.root={...thread.root,...m};hit=true}const j=thread.replies.findIndex(x=>x.id===m.id);if(j>=0){thread.replies[j]={...thread.replies[j],...m};hit=true}}
  Received.event('message',m).catch(()=>{});return hit;
 }
 const rerender=()=>{renderMessages(true);drawThread()};

 // Message parts -------------------------------------------------------------
 function pollCard(m){
  const spec=parse(m.text),poll=m.poll||{counts:[],votes:{}},mine=poll.votes?.[me()]||[],voters=Object.keys(poll.votes||{}).length,total=Math.max(1,poll.counts.reduce((a,b)=>a+b,0));
  const closed=!!spec.closed,voted=mine.length>0;
  return `<div class="poll-card" data-poll="${m.id}"><div class="card-kind">📊 投票 · ${spec.multi?'多选':'单选'}${closed?' · 已结束':''}</div><h4>${esc(spec.title||'')}</h4>
   ${(spec.options||[]).map((o,i)=>{const n=poll.counts[i]||0,pct=Math.round(n*100/total);return `<label class="poll-option${mine.includes(i)?' mine':''}"><input type="${spec.multi?'checkbox':'radio'}" name="poll-${m.id}" value="${i}" ${mine.includes(i)?'checked':''} ${closed?'disabled':''}><span class="poll-text">${esc(o)}</span>${voted||closed?`<span class="poll-count">${n} 票 · ${pct}%</span><i style="width:${pct}%"></i>`:''}</label>`}).join('')}
   <div class="card-foot"><span>${voters} 人已参与</span>${closed?'':`<button class="primary" data-cx="vote" data-mid="${m.id}">${voted?'修改投票':'投票'}</button>`}${voters?`<button data-cx="poll-detail" data-mid="${m.id}">详情</button>`:''}${m.sender===me()&&!closed?`<button data-cx="poll-close" data-mid="${m.id}">结束</button>`:''}</div></div>`;
 }
 function chainCard(m){
  const spec=parse(m.text),list=m.chain||[],mine=list.find(e=>e.userId===me());
  return `<div class="chain-card"><div class="card-kind">🐉 接龙</div><h4>${esc(spec.title||'')}</h4>${spec.note?`<p class="chain-note">${esc(spec.note)}</p>`:''}
   ${list.length?`<ol>${list.map(e=>`<li><b>${esc(e.name)}</b>${e.text?' '+esc(e.text):''}</li>`).join('')}</ol>`:'<p class="chain-note">还没有人参与，来做第一个</p>'}
   <div class="card-foot"><span>${list.length} 人已接龙</span><button class="primary" data-cx="chain-join" data-mid="${m.id}">${mine?'修改':'+ 参与接龙'}</button>${mine?`<button data-cx="chain-leave" data-mid="${m.id}">退出</button>`:''}</div></div>`;
 }
 function card(m){if(m.recalled)return '';if(m.kind==='poll')return pollCard(m);if(m.kind==='chain')return chainCard(m);return ''}
 function preview(m){if(m?.recalled)return null;if(m?.kind==='poll')return '[投票] '+(parse(m.text).title||'');if(m?.kind==='chain')return '[接龙] '+(parse(m.text).title||'');return null}
 function extras(m){
  if(m.recalled)return '';let html='';
  const t=translations.get(m.id);
  if(t?.open)html+=`<div class="translation">${t.loading?'<span class="hint">正在翻译…</span>':`<div>${esc(t.text).replace(/\n/g,'<br>')}</div><small>译文 · Me <button data-cx="translate-hide" data-mid="${m.id}">收起</button></small>`}</div>`;
  if(m.urgent){const pending=m.urgent.targets.includes(me())&&!m.urgent.acked.includes(me());const n=m.urgent.targets.length,done=m.urgent.acked.length;
   html+=`<div class="urgent-line"><span class="urgent-tag">❗ 加急</span>${m.sender===me()?`<span>${done}/${n} 人已确认</span>`:pending?`<button data-cx="urgent-ack" data-mid="${m.id}">知道了</button>`:'<span>已确认</span>'}</div>`}
  if(m.reactions?.length)html+=`<div class="reactions">${m.reactions.map(r=>`<button class="reaction${r.users.includes(me())?' mine':''}" data-cx="react" data-mid="${m.id}" data-reaction="${esc(r.emoji)}" title="${esc(r.users.map(nameOf).join('、'))}">${esc(r.emoji)}<span>${r.users.length}</span></button>`).join('')}<button class="reaction add" data-cx="react-pick" data-mid="${m.id}" title="添加表情回复">${icon('emoji')}</button></div>`;
  if(m.thread?.count&&!m.threadId)html+=`<button class="thread-link" data-cx="thread" data-mid="${m.id}">${icon('chat')}${m.thread.count} 条回复 · 最后回复 ${shortTime(m.thread.last)}</button>`;
  return html;
 }
 const timeTag=m=>m.edited&&!m.recalled?'<span class="edited-tag" title="'+new Date(m.edited).toLocaleString('zh-CN',{hour12:false})+' 编辑">已编辑</span>':'';
 function hoverTools(m){if(m.recalled)return '';return `<button class="icon-btn" title="表情回复" aria-label="表情回复" data-cx="react-pick" data-mid="${m.id}">${icon('emoji')}</button>${m.threadId?'':`<button class="icon-btn" title="回复话题" aria-label="回复话题" data-cx="thread" data-mid="${m.id}">${icon('chat')}</button>`}`}
 const moreTool=m=>`<button class="icon-btn" title="更多" aria-label="更多操作" data-cx="more" data-mid="${m.id}">${icon('more')}</button>`;
 function menuItems(m){
  if(m.recalled)return '';const mine=m.sender===me(),recent=Date.now()-m.created<DAY,pinned=(pins.get(m.conversationId)||[]).some(p=>p.id===m.id);
  return (m.kind==='image'?`<button data-cx="copy-image" data-mid="${m.id}">${icon('copy')}复制图片</button>`:'')+`<button data-cx="react-pick" data-mid="${m.id}">${icon('emoji')}表情回复</button>${m.threadId?'':`<button data-cx="thread" data-mid="${m.id}">${icon('chat')}回复话题</button>`}`+
   (mine&&recent&&m.kind==='text'&&!/\nlinkme-doc:/.test(m.text)?`<button data-cx="edit" data-mid="${m.id}">${icon('notebook')}编辑</button>`:'')+
   (m.threadId?'':`<button data-cx="${pinned?'unpin':'pin'}" data-mid="${m.id}">${icon('pin')}${pinned?'取消置顶':'置顶'}</button>`)+
   (mine&&recent?`<button data-cx="urgent" data-mid="${m.id}">${icon('bell')}加急</button>`:'')+
   (m.kind==='text'&&aiEnabled?`<button data-cx="translate" data-mid="${m.id}">${icon('refresh')}翻译</button>`:'');
 }

 // Reactions ------------------------------------------------------------------
 function picker(mid,anchor){
  document.querySelector('.reaction-picker')?.remove();const box=document.createElement('div');box.className='reaction-picker';
  box.innerHTML=REACTIONS.map(e=>`<button data-cx="react" data-mid="${mid}" data-reaction="${esc(e)}">${esc(e)}</button>`).join('');
  document.body.append(box);const r=anchor.getBoundingClientRect();box.style.left=Math.max(8,Math.min(r.left,innerWidth-box.offsetWidth-8))+'px';box.style.top=Math.max(8,r.top-box.offsetHeight-6)+'px';
  setTimeout(()=>document.addEventListener('mousedown',function off(e){if(!box.contains(e.target)){box.remove();document.removeEventListener('mousedown',off)}}),0);
 }
 async function react(mid,emoji){document.querySelector('.reaction-picker')?.remove();try{const r=await api(`/api/messages/${mid}/reactions`,{method:'POST',body:{emoji}});const m=find(mid);if(m){m.reactions=r.reactions;rerender()}}catch(e){toast(e.message)}}

 // Editing ---------------------------------------------------------------------
 function startEdit(m){
  S.editing={id:m.id,cid:m.conversationId};const input=$('#composer');if(!input)return;
  S.editing.draft=input.value;input.value=m.text;input.dispatchEvent(new Event('input'));input.focus();input.setSelectionRange(input.value.length,input.value.length);drawEditBar();
 }
 function drawEditBar(){const bar=$('#edit-draft');if(!bar)return;const on=!!S.editing&&S.editing.cid===S.active;bar.classList.toggle('hidden',!on);bar.closest('.composer')?.classList.toggle('has-reply',on||!!S.reply);bar.innerHTML=on?`<span>${icon('notebook')} 编辑消息 · 按 Enter 保存，Esc 取消</span><button class="icon-btn" data-cx="edit-cancel" aria-label="取消编辑">${icon('close')}</button>`:''}
 function cancelEdit(){if(!S.editing)return;const input=$('#composer');const draft=S.editing.draft||'';S.editing=null;if(input){input.value=draft;input.dispatchEvent(new Event('input'))}drawEditBar()}
 async function submitEdit(){
  const input=$('#composer'),edit=S.editing;if(!input||!edit)return;const text=input.value;
  if(!text.trim()){toast('消息不能为空');return}
  input.disabled=true;
  try{const m=await api('/api/messages/'+edit.id,{method:'PATCH',body:{text,mentions:Mentions.payload()}});replace(m);S.editing=null;input.value=edit.draft||'';input.dispatchEvent(new Event('input'));drawEditBar();rerender()}
  catch(e){toast(e.message)}finally{input.disabled=false;input.focus()}
 }

 // Pinned messages -------------------------------------------------------------------
 async function loadPins(cid){try{const list=await api(`/api/conversations/${cid}/pins`);pins.set(cid,list);if(cid===S.active)drawPins()}catch{}}
 function drawPins(){
  const box=$('#pinned-bar');if(!box)return;const list=pins.get(S.active)||[];
  if(!list.length){box.innerHTML='';box.className='';return}
  const p=list[0];box.className='pinned-bar';
  box.innerHTML=`<span class="pin-icon">${icon('pin')}</span><button class="pinned-text" data-cx="pin-jump" data-mid="${p.id}"><b>${esc(p.name)}：</b>${esc(previewText(p))}</button>${list.length>1?`<button class="pinned-more" data-cx="pins-open">${list.length} 条置顶</button>`:`<button class="pinned-more" data-cx="pins-open">管理</button>`}`;
 }
 function previewText(m){const p=preview(m)||Docs.preview(m.text);if(p)return p;return {image:'[图片]',file:'[文件] '+(m.fileName||''),voice:'[语音]',video:'[视频]',forward:'[聊天记录]',meeting:'[会议]',call:'[通话]'}[m.kind]||m.text}
 function pinList(){
  const list=pins.get(S.active)||[];
  modal('置顶消息',list.length?`<div class="pin-list">${list.map(p=>`<div class="pin-item"><button data-cx="pin-jump" data-mid="${p.id}"><b>${esc(p.name)}</b><span>${esc(previewText(p))}</span><small>${esc(p.pinnedByName||'')} 置顶于 ${shortTime(p.pinnedAt)}</small></button><button class="secondary" data-cx="unpin" data-mid="${p.id}">取消置顶</button></div>`).join('')}</div>`:'<p class="hint">没有置顶消息</p>','<button class="secondary" data-action="close-modal">关闭</button>');
 }
 async function pin(mid,on){try{await api(`/api/messages/${mid}/pin`,{method:on?'POST':'DELETE'});toast(on?'已置顶':'已取消置顶')}catch(e){toast(e.message)}}

 // Urgent reminders ------------------------------------------------------------------------
 async function urgent(m){
  const c=S.conversations.find(c=>c.id===m.conversationId);if(!c)return;
  if(c.kind==='direct'){if(!confirm(`加急提醒 ${c.name}？对方会收到强提醒，直到点“知道了”。`))return;send([]);return}
  let members=[];try{members=(await api('/api/conversations/'+c.id)).members||[]}catch(e){toast(e.message);return}
  const others=members.filter(u=>u.id!==me()&&!u.ai);
  modal('加急提醒',`<p class="hint">被加急的成员会收到弹窗和铃声提醒，直到点“知道了”。</p><label class="urgent-all"><input type="checkbox" id="urgent-all" checked> 全部成员（${others.length} 人）</label><div class="urgent-people">${others.map(u=>`<label>${av(u)}<span>${esc(u.nickname||u.name)}</span><input type="checkbox" class="urgent-user" value="${u.id}" checked></label>`).join('')}</div>`,'<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="urgent-send">加急</button>');
  $('#urgent-all').onchange=e=>document.querySelectorAll('.urgent-user').forEach(b=>b.checked=e.target.checked);
  $('#urgent-send').onclick=()=>{const ids=[...document.querySelectorAll('.urgent-user:checked')].map(b=>b.value);if(!ids.length){toast('请选择成员');return}closeModal();send(ids)};
  async function send(users){try{const updated=await api(`/api/messages/${m.id}/urgent`,{method:'POST',body:{users}});replace(updated);rerender();toast('已加急提醒')}catch(e){toast(e.message)}}
 }
 function ring(){
  try{const ctx=beep||(beep=new (window.AudioContext||window.webkitAudioContext)());const t=ctx.currentTime;for(const [f,at] of [[880,0],[660,.18],[880,.36]]){const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=f;g.gain.setValueAtTime(.0001,t+at);g.gain.exponentialRampToValueAtTime(.25,t+at+.02);g.gain.exponentialRampToValueAtTime(.0001,t+at+.16);o.connect(g).connect(ctx.destination);o.start(t+at);o.stop(t+at+.17)}}catch{}
 }
 function showUrgent(){
  if(urgentShowing||!urgentQueue.length)return;const {message:m,from}=urgentShowing=urgentQueue.shift();
  const layer=document.createElement('div');layer.className='urgent-layer';
  layer.innerHTML=`<div class="urgent-box" role="alertdialog" aria-label="加急消息"><div class="urgent-title">❗ 加急消息</div><div class="urgent-from">${av({id:m.sender,name:m.name,avatar:m.avatar})}<b>${esc(from||m.name)}</b><small>${esc((S.conversations.find(c=>c.id===m.conversationId)||{}).name||'')}</small></div><div class="urgent-text">${esc(previewText(m)).replace(/\n/g,'<br>')}</div><div class="urgent-actions"><button class="secondary" data-cx="urgent-open" data-mid="${m.id}" data-cid="${m.conversationId}">查看</button><button class="primary" data-cx="urgent-ack" data-mid="${m.id}">知道了</button></div></div>`;
  document.body.append(layer);ring();const timer=setInterval(ring,4000);setTimeout(()=>clearInterval(timer),60000);layer.dataset.timer=timer;
  if(document.hidden&&'Notification' in window&&Notification.permission==='granted')try{new Notification('加急：'+(from||m.name),{body:previewText(m).slice(0,120)})}catch{}
 }
 async function ack(mid){
  const layer=document.querySelector('.urgent-layer');if(layer&&urgentShowing?.message.id===mid){clearInterval(+layer.dataset.timer);layer.remove();urgentShowing=null}
  urgentQueue=urgentQueue.filter(x=>x.message.id!==mid);
  try{await api(`/api/messages/${mid}/urgent/ack`,{method:'POST',body:{}})}catch(e){toast(e.message)}
  setTimeout(showUrgent,300);
 }

 // Threads -----------------------------------------------------------------------------------
 async function openThread(mid){
  const root=find(mid);if(!root)return;
  thread={root,replies:[],cid:root.conversationId,loading:true};drawThread();
  try{const r=await api(`/api/messages/${mid}/thread`);if(thread?.root.id!==mid)return;thread.root=r.root;thread.replies=r.replies;thread.loading=false;drawThread(true)}catch(e){toast(e.message);closeThread()}
 }
 function closeThread(){thread=null;document.querySelector('.thread-panel')?.remove()}
 function bubbleText(m){if(m.recalled)return '<i class="hint">消息已撤回</i>';if(m.kind==='image')return `<img src="${fileURL(m.attachmentId)}" alt="" data-preview-image="${m.attachmentId}">`;const p=preview(m)||Docs.preview(m.text);if(p||m.kind!=='text')return esc(previewText(m));return Mentions.text(m)}
 function drawThread(scroll=false){
  if(!thread)return;if(thread.cid!==S.active){closeThread();return}
  let panel=document.querySelector('.thread-panel');const main=document.querySelector('.main');if(!main)return;
  if(!panel){panel=document.createElement('aside');panel.className='thread-panel';panel.setAttribute('aria-label','话题');main.append(panel);
   panel.innerHTML=`<header><b>话题</b><button class="icon-btn" data-cx="thread-close" aria-label="关闭话题">${icon('close')}</button></header><div class="thread-body"></div><form class="thread-compose"><textarea rows="2" maxlength="6000" placeholder="回复话题，Enter 发送"></textarea><button class="primary" type="submit">发送</button></form>`;
   const form=panel.querySelector('form'),ta=form.querySelector('textarea');
   form.addEventListener('submit',e=>{e.preventDefault();replyThread(ta)});
   ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();replyThread(ta)}});
  }
  const body=panel.querySelector('.thread-body'),line=m=>`<div class="thread-msg" data-message="${m.id}">${av({id:m.sender,name:m.name,avatar:m.avatar})}<div><div class="thread-meta"><b>${esc(m.name)}</b><small>${shortTime(m.created)}</small>${timeTag(m)}</div><div class="thread-text">${bubbleText(m)}</div>${extras({...m,thread:null})}</div></div>`;
  body.innerHTML=line(thread.root)+`<div class="thread-sep">${thread.loading?'正在加载…':thread.replies.length+' 条回复'}</div>`+thread.replies.map(line).join('');
  if(scroll)body.scrollTop=body.scrollHeight;
 }
 async function replyThread(ta){
  const text=ta.value.trim();if(!text||!thread)return;const root=thread.root;ta.disabled=true;
  try{const m=await api(`/api/conversations/${thread.cid}/messages`,{method:'POST',body:{kind:'text',text,threadId:root.id,clientId:'t'+Date.now().toString(36)+Math.random().toString(36).slice(2,10)}});ta.value='';if(thread?.root.id===root.id&&!thread.replies.some(x=>x.id===m.id)){thread.replies.push(m);drawThread(true)}}
  catch(e){toast(e.message)}finally{ta.disabled=false;ta.focus()}
 }

 // Polls and sign-ups ---------------------------------------------------------------------------
 function newPoll(){
  modal('发起投票',`<div class="poll-form"><input id="poll-title" maxlength="100" placeholder="投票主题"><div id="poll-options">${[1,2,3].map(i=>`<input class="poll-opt" maxlength="60" placeholder="选项 ${i}">`).join('')}</div><button class="link" id="poll-add">+ 添加选项</button><label><input type="checkbox" id="poll-multi"> 允许多选</label></div>`,'<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="poll-create">发起</button>');
  $('#poll-add').onclick=()=>{const n=document.querySelectorAll('.poll-opt').length;if(n>=20){toast('最多 20 个选项');return}$('#poll-options').insertAdjacentHTML('beforeend',`<input class="poll-opt" maxlength="60" placeholder="选项 ${n+1}">`)};
  $('#poll-create').onclick=async()=>{const options=[...document.querySelectorAll('.poll-opt')].map(i=>i.value.trim()).filter(Boolean);try{await api(`/api/conversations/${S.active}/polls`,{method:'POST',body:{title:$('#poll-title').value,options,multi:$('#poll-multi').checked}});closeModal()}catch(e){toast(e.message)}};
  $('#poll-title').focus();
 }
 function newChain(){
  modal('发起接龙',`<div class="poll-form"><input id="chain-title" maxlength="100" placeholder="接龙主题，例如：周五聚餐报名"><textarea id="chain-note" maxlength="500" rows="3" placeholder="说明（可选），例如：请写上人数和忌口"></textarea></div>`,'<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="chain-create">发起</button>');
  $('#chain-create').onclick=async()=>{try{await api(`/api/conversations/${S.active}/chains`,{method:'POST',body:{title:$('#chain-title').value,note:$('#chain-note').value}});closeModal()}catch(e){toast(e.message)}};
  $('#chain-title').focus();
 }
 async function vote(mid){const box=document.querySelector(`[data-poll="${mid}"]`);const options=[...box.querySelectorAll('input:checked')].map(i=>+i.value);if(!options.length){toast('请先选择选项');return}try{replace(await api(`/api/messages/${mid}/votes`,{method:'POST',body:{options}}));rerender()}catch(e){toast(e.message)}}
 function pollDetail(m){const spec=parse(m.text),votes=m.poll?.votes||{};modal('投票详情：'+esc(spec.title||''),`<div class="poll-detail">${(spec.options||[]).map((o,i)=>{const who=Object.entries(votes).filter(([,v])=>v.includes(i)).map(([u])=>nameOf(u));return `<div><b>${esc(o)}</b> · ${who.length} 票<p>${who.length?esc(who.join('、')):'<span class="hint">暂无</span>'}</p></div>`}).join('')}</div>`,'<button class="secondary" data-action="close-modal">关闭</button>')}
 async function joinChain(m){const mine=(m.chain||[]).find(e=>e.userId===me());const text=prompt('接龙内容（可留空，只写名字）',mine?.text||'');if(text===null)return;try{replace(await api(`/api/messages/${m.id}/chain`,{method:'POST',body:{text:text.trim()||'✓'}}));rerender()}catch(e){toast(e.message)}}

 // Translation and AI summary ------------------------------------------------------------------
 async function translate(m){
  const cjk=(m.text.match(/[一-鿿]/g)||[]).length,lang=cjk>m.text.length*0.3?'en':'zh';
  translations.set(m.id,{open:true,loading:true});rerender();
  try{const r=await api(`/api/messages/${m.id}/translate`,{method:'POST',body:{lang}});translations.set(m.id,{open:true,text:r.text})}catch(e){translations.delete(m.id);toast(e.message)}
  rerender();
 }
 function loaded(cid){
  summary=null;const c=S.conversations.find(x=>x.id===cid);const box=$('#unread-summary');if(box)box.innerHTML='';
  loadPins(cid);
  if(!aiEnabled||!c||c.peer?.ai)return;const unread=c.unread||0;if(unread<8)return;
  const list=S.messages.filter(m=>!m.threadId),i=list.length-unread;const afterSeq=i>0?list[i-1].seq:0;
  summary={cid,afterSeq,count:unread};if(box)box.innerHTML=`<button class="unread-summary" data-cx="summary">✦ ${unread} 条未读，让 Me 总结</button>`;
 }
 async function summarize(afterSeq,count){
  const cid=S.active;modal('✦ Me 总结',`<div class="summary-body"><div class="ai-loading"><span></span>正在阅读${count?count+' 条':'最近的'}消息…</div></div>`,'<button class="secondary" data-action="close-modal">关闭</button>',true);
  try{const r=await api(`/api/conversations/${cid}/summary`,{method:'POST',body:{afterSeq}});const body=document.querySelector('.summary-body');if(body)body.innerHTML=`<div class="ai-reply">${replyHTML(r.summary)}</div><p class="hint">根据 ${r.count} 条消息生成，仅你可见</p><button class="link" data-cx="summary-copy">复制</button>`;summary={...summary,text:r.summary};$('#unread-summary')&&($('#unread-summary').innerHTML='')}
  catch(e){const body=document.querySelector('.summary-body');if(body)body.innerHTML=`<p class="ai-error">${esc(e.message)}</p>`}
 }

 // Scheduled send --------------------------------------------------------------------------------
 function schedule(){
  const input=$('#composer');const text=input?.value||'';if(!text.trim()){toast('先输入要定时发送的内容');return}
  const d=new Date(Date.now()+3600000);d.setMinutes(0,0,0);const pad=n=>String(n).padStart(2,'0');const local=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  modal('定时发送',`<div class="poll-form"><p class="schedule-preview">${esc(text).replace(/\n/g,'<br>')}</p><label>发送时间<input type="datetime-local" id="schedule-at" value="${local}"></label><label>重复<select id="schedule-repeat"><option value="once">不重复</option><option value="daily">每天</option><option value="weekdays">工作日</option></select></label></div>`,'<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="schedule-ok">定时发送</button>');
  $('#schedule-ok').onclick=async()=>{const at=new Date($('#schedule-at').value).getTime();if(!at||at<Date.now()-60000){toast('请选择未来的时间');return}
   try{await api('/api/schedules',{method:'POST',body:{conversationId:S.active,kind:'text',text,at,repeat:$('#schedule-repeat').value,tzOffset:-new Date().getTimezoneOffset()}});closeModal();if(input){input.value='';input.dispatchEvent(new Event('input'))}toast('将在 '+new Date(at).toLocaleString('zh-CN',{hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+' 发送，可在设置 → 定时消息中管理')}catch(e){toast(e.message)}};
 }

 // File preview ---------------------------------------------------------------------------------
 function previewFile(id,name){
  const pdf=/\.pdf$/i.test(name),text=PREVIEW_TEXT.test(name),media=PREVIEW_MEDIA.test(name),asDoc=AS_DOC.test(name);
  if(!pdf&&!text&&!media&&!asDoc)return false;
  if(pdf&&window.WeLinkAndroid)return false;
  const url=fileURL(id);let body;
  if(pdf)body=`<iframe class="file-frame" src="${url}?inline=1" title="${esc(name)}"></iframe>`;
  else if(/\.(png|jpe?g|gif|webp|bmp)$/i.test(name))body=`<img class="file-image" src="${url}" alt="${esc(name)}">`;
  else if(/\.(mp3|wav|m4a|ogg)$/i.test(name))body=`<audio controls src="${url}"></audio>`;
  else if(media)body=`<video class="file-video" controls src="${url}"></video>`;
  else if(text)body='<pre class="file-text">正在加载…</pre>';
  else body=`<div class="file-doc"><p>${esc(name)}</p><p class="hint">可以在 LinkMe 云文档中打开，多人一起在线编辑。</p></div>`;
  modal(esc(name),`<div class="file-preview">${body}</div>`,`${asDoc?'<button class="secondary" data-cx="file-doc" data-file="'+id+'">在云文档中打开</button>':''}<button class="primary" data-cx="file-download" data-file="${id}" data-name="${esc(name)}">下载</button>`,true);
  if(text)fetch(url).then(r=>{if(!r.ok)throw Error('无法读取文件');return r.text()}).then(t=>{const pre=document.querySelector('.file-text');if(pre)pre.textContent=t.length>400000?t.slice(0,400000)+'\n…（文件较大，仅显示前一部分）':t}).catch(e=>{const pre=document.querySelector('.file-text');if(pre)pre.textContent=e.message});
  return true;
 }

 // Copy an image message as a picture others can paste anywhere.
 async function copyImage(m){
  try{
   const blob=await (await fetch(fileURL(m.attachmentId))).blob();
   const bitmap=await createImageBitmap(blob);const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);
   const png=await new Promise(r=>canvas.toBlob(r,'image/png'));
   if(typeof window.welinkScreenshotCopy==='function'){const url=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(png)});await window.welinkScreenshotCopy(url)}
   else if(navigator.clipboard?.write&&window.ClipboardItem)await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);
   else throw Error('此设备暂不支持复制图片，可以长按保存');
   toast('图片已复制');
  }catch(e){toast(e.message&&!/NotAllowed|denied/i.test(e.message)?e.message:'复制图片失败')}
 }

 // Personal status ------------------------------------------------------------------------------
 const STATUS_OPTIONS=[['','无状态'],['busy','忙碌'],['dnd','请勿打扰'],['away','暂时离开'],['leave','休假中']];
 async function loadStatuses(){const ids=[...new Set([me(),...(S.friends||[]).map(f=>f.id),...S.conversations.filter(c=>c.kind==='direct').map(c=>c.peer?.id)].filter(Boolean))];if(!ids.length)return;try{const r=await api('/api/statuses?ids='+ids.join(','));for(const [id,st] of Object.entries(r))statuses.set(id,st);S.myStatus=statuses.get(me())||null;refreshStatus()}catch{}}
 function statusLabel(userId){const st=statuses.get(userId);return st?.label||''}
 function refreshStatus(){try{showPresence()}catch{}const me_=$('.rail .self');if(me_)me_.dataset.status=S.myStatus?.status||''}
 function statusMenu(){
  const st=S.myStatus||{};
  modal('设置状态',`<div class="status-options">${STATUS_OPTIONS.map(([k,l])=>`<label><input type="radio" name="my-status" value="${k}" ${(st.manual||'')===k?'checked':''}> ${l}</label>`).join('')}<label><input type="radio" name="my-status" value="custom" ${st.manual==='custom'?'checked':''}> 自定义 <input id="status-text" maxlength="30" placeholder="例如：出差中" value="${esc(st.manual==='custom'?st.text||'':'')}"></label></div><label class="status-until">持续<select id="status-until"><option value="0">直到我清除</option><option value="3600000">1 小时</option><option value="14400000">4 小时</option><option value="today">今天</option></select></label><p class="hint">会议、通话和远程协助时会自动显示“会议中”等状态。“请勿打扰”时不再弹出普通消息提醒，加急消息除外。</p>`,'<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="status-save">保存</button>');
  $('#status-text').onfocus=()=>{document.querySelector('input[name=my-status][value=custom]').checked=true};
  $('#status-save').onclick=async()=>{const manual=document.querySelector('input[name=my-status]:checked')?.value||'';const u=$('#status-until').value;let until=0;if(u==='today'){const d=new Date();d.setHours(23,59,59,0);until=d.getTime()}else if(+u)until=Date.now()+(+u);
   try{const r=await api('/api/me/status',{method:'PUT',body:{manual,text:$('#status-text').value,until}});statuses.set(me(),r);S.myStatus=r;refreshStatus();closeModal();toast(r.label?'状态：'+r.label:'已清除状态')}catch(e){toast(e.message)}};
 }
 function watchAuto(){
  const now=document.querySelector('#call-layer')?'call':document.querySelector('#meeting-layer .meeting-room')?'meeting':S.remote&&!['pending','ended','closed'].includes(S.remote.state)?'remote':'';
  if(now===autoStatus||!S.user)return;autoStatus=now;api('/api/me/status',{method:'PUT',body:{auto:now}}).then(r=>{statuses.set(me(),r);S.myStatus=r;refreshStatus()}).catch(()=>{autoStatus=''});
 }

 // Events --------------------------------------------------------------------------------------
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-cx]');if(!b)return;const mid=b.dataset.mid,m=mid&&find(mid);
  switch(b.dataset.cx){
   case 'react-pick':e.preventDefault();e.stopPropagation();document.querySelector('.context-menu')?.remove();if(mid)picker(mid,b.closest('.message')?.querySelector('.bubble')||b);break;
   case 'react':e.preventDefault();react(mid,b.dataset.reaction);break;
   case 'more':{e.preventDefault();e.stopPropagation();if(m){const r=b.getBoundingClientRect();messageMenu(m,r.left,r.bottom)}break}
   case 'edit':if(m)startEdit(m);break;
   case 'edit-cancel':cancelEdit();break;
   case 'pin':pin(mid,true);break;case 'unpin':pin(mid,false);break;
   case 'pins-open':pinList();break;
   case 'pin-jump':closeModal();jumpMessage(S.active,mid);break;
   case 'urgent':if(m)urgent(m);break;
   case 'urgent-ack':ack(mid);break;
   case 'urgent-open':{const cid=b.dataset.cid;ack(mid);if(cid&&S.active!==cid)document.querySelector(`[data-conversation="${cid}"]`)?.click();setTimeout(()=>jumpMessage(cid,mid),600);break}
   case 'thread':if(mid)openThread(mid);break;
   case 'thread-close':closeThread();break;
   case 'vote':vote(mid);break;
   case 'poll-detail':if(m)pollDetail(m);break;
   case 'poll-close':if(confirm('结束后不能再投票，确定吗？'))try{replace(await api(`/api/messages/${mid}/close`,{method:'POST',body:{}}));rerender()}catch(err){toast(err.message)}break;
   case 'chain-join':if(m)joinChain(m);break;
   case 'chain-leave':try{replace(await api(`/api/messages/${mid}/chain`,{method:'POST',body:{text:''}}));rerender()}catch(err){toast(err.message)}break;
   case 'translate':if(m)translate(m);break;
   case 'translate-hide':translations.delete(mid);rerender();break;
   case 'summary':if(summary)summarize(summary.afterSeq,summary.count);break;
   case 'summary-copy':navigator.clipboard?.writeText(summary?.text||'').then(()=>toast('已复制'),()=>toast('复制失败'));break;
   case 'new-poll':newPoll();break;case 'new-chain':newChain();break;
   case 'ai-summary':summarize(0,0);break;
   case 'file-download':closeModal();download(b.dataset.file,b.dataset.name);break;
   case 'file-doc':try{const r=await api('/api/docs/import-attachment',{method:'POST',body:{attachmentId:b.dataset.file}});closeModal();Docs.open(r.id)}catch(err){toast(err.message)}break;
   case 'status':statusMenu();break;
   case 'copy-image':if(m)copyImage(m);break;
  }
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&S.editing&&e.target.id==='composer'){e.preventDefault();cancelEdit()}});

 return {
  card,extras,timeTag,hoverTools,moreTool,menuItems,preview,previewFile,statusLabel,
  editing:()=>!!S.editing&&S.editing.cid===S.active,submitEdit,drawEditBar,
  tools(c){return c&&!c.peer?.ai?`<button class="icon-btn" title="发起投票" aria-label="发起投票" data-cx="new-poll">${icon('check')}</button><button class="icon-btn chain-tool" title="发起接龙" aria-label="发起接龙" data-cx="new-chain">龙</button>`:''},
  headerButtons(c){return aiEnabled&&c&&!c.peer?.ai?`<button class="icon-btn" title="让 Me 总结最近消息" aria-label="AI 总结" data-cx="ai-summary">✦</button>`:''},
  mount(c){drawPins();drawEditBar();if(thread&&thread.cid!==c?.id)closeThread();else drawThread();refreshStatus();const send=$('#send-message');if(send)send.oncontextmenu=e=>{e.preventDefault();schedule()};const btn=$('#send-message');if(btn&&!btn.title)btn.title='右键可定时发送'},
  loaded,schedule,statusMenu,
  async start(){try{const c=await api('/api/ai/config');aiEnabled=!!c.enabled}catch{aiEnabled=false}loadStatuses();try{const list=await api('/api/urgent');for(const m of list)if(!urgentQueue.some(x=>x.message.id===m.id))urgentQueue.push({message:m,from:m.name});showUrgent()}catch{}clearInterval(statusTimer);statusTimer=setInterval(watchAuto,3000)},
  dnd:()=>!!S.myStatus?.dnd,
  event(type,d){
   if(type==='message-updated'){if(replace(d))rerender();if((pins.get(d.conversationId)||[]).some(p=>p.id===d.id))loadPins(d.conversationId);return true}
   if(type==='reaction'){const m=find(d.messageId);if(m){m.reactions=d.reactions;rerender()}return true}
   if(type==='pins'){loadPins(d.conversationId);return true}
   if(type==='urgent'){if(!urgentQueue.some(x=>x.message.id===d.message.id))urgentQueue.push(d);showUrgent();return true}
   if(type==='status'){statuses.set(d.userId,d.status);if(d.userId===me())S.myStatus=d.status;refreshStatus();return true}
   if(type==='meeting-minutes'){toast('会议纪要已生成：'+d.title);if(confirm('会议纪要“'+d.title+'”已生成，现在打开吗？'))Docs.open(d.docId);return true}
   if(type==='message'&&d.threadId){if(thread?.root.id===d.threadId&&!thread.replies.some(x=>x.id===d.id)){thread.replies.push(d);drawThread(true)}return false}
   return false;
  },
  reset(){translations.clear();pins.clear();statuses.clear();thread=null;urgentQueue=[];urgentShowing=null;summary=null;S.editing=null;clearInterval(statusTimer);autoStatus='';document.querySelector('.urgent-layer')?.remove()},
 };
}
