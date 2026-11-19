import {replyHTML} from './docs-text.js';
import {whenText} from './work.js';

// Me 管家: an assistant that looks after the whole app, like a phone's
// floating helper. A small orb (in the rail on the desktop, floating on
// phones) carries a count of things that need attention and pops up bubbles
// when something happens: a meeting about to start, a new invitation or
// assignment, a deadline. Its panel holds the AI daily brief, the list of
// things to look at, and a box to ask Me to do things; every action is shown
// first and runs only when the user taps 执行. The user can switch it off.

const DAY=86400000;
const SUGGESTIONS=['总结一下我的未读消息','明天上午十点和同事开个会','提醒我周五下午交周报','把状态设为请勿打扰两小时','今天有什么需要我处理的？'];

export function createAssistant({S,api,esc,av,icon,toast,openChat,openMessage,startChat,showWork,showTab,Docs,Work,closeModal}){
 const $=s=>document.querySelector(s);
 let prefs={enabled:false,brief:true,nudges:true,ai:false},notices=[],brief=null,briefing=false,asking=false,answer=null,timer=0,bubbleTimer=0,started=false;
 const bubbles=[],shown=new Set();
 const me=()=>S.user?.id;
 const today=()=>new Date().toDateString();
 const store=(k,v)=>{try{if(v===undefined)return JSON.parse(localStorage.getItem('welink_me_'+k)||'null');localStorage.setItem('welink_me_'+k,JSON.stringify(v))}catch{return null}};
 const dismissed=()=>{const d=store('dismissed');return d?.date===today()?new Set(d.keys):new Set()};
 const tz=()=>-new Date().getTimezoneOffset();
 const quiet=()=>!!S.myStatus?.dnd;

 // Orb, bubble and panel ---------------------------------------------------------
 function orb(){
  let el=$('#me-orb');
  if(!prefs.enabled||!S.user){el?.remove();$('#me-bubble')?.remove();$('#me-assist')?.remove();return null}
  if(!el){el=document.createElement('button');el.id='me-orb';el.className='me-orb';el.setAttribute('aria-label','Me 管家');el.title='Me 管家';el.innerHTML='<span class="orb-core">M</span><span class="orb-badge hidden"></span>';document.body.append(el);
   el.onclick=()=>{if(el.dataset.dragged){delete el.dataset.dragged;return}togglePanel()};dragOrb(el)}
  const n=notices.length;const badge=el.querySelector('.orb-badge');badge.textContent=n>99?'99+':n;badge.classList.toggle('hidden',!n);
  el.classList.toggle('alert',notices.some(x=>x.level==='high'));
  return el;
 }
 // Phones: drag the orb up or down along the right edge.
 function dragOrb(el){
  let start=null;
  el.addEventListener('touchstart',e=>{start={y:e.touches[0].clientY,top:el.getBoundingClientRect().top}},{passive:true});
  el.addEventListener('touchmove',e=>{if(!start)return;const dy=e.touches[0].clientY-start.y;if(Math.abs(dy)<6)return;el.dataset.dragged='1';const top=Math.max(70,Math.min(innerHeight-140,start.top+dy));el.style.top=top+'px';el.style.bottom='auto';e.preventDefault()},{passive:false});
  el.addEventListener('touchend',()=>{if(el.dataset.dragged)store('orb',el.style.top);start=null});
  const saved=store('orb');if(saved&&innerWidth<=700){el.style.top=saved;el.style.bottom='auto'}
 }
 // Important bubbles (assignments, invitations, meetings, @me) cut in ahead
 // of routine ones such as the daily brief.
 function bubble(text,open,urgent=true){
  if(!prefs.enabled||!prefs.nudges)return;const b={text,open,urgent};
  const cur=$('#me-bubble');
  if(urgent&&cur&&cur.dataset.urgent!=='1'){bubbles.unshift(b,current);cur.remove();clearTimeout(bubbleTimer);nextBubble();return}
  if(urgent){const i=bubbles.findIndex(x=>!x.urgent);bubbles.splice(i<0?bubbles.length:i,0,b)}else bubbles.push(b);
  if(!cur)nextBubble();
 }
 let current=null;
 function nextBubble(){
  // The open panel already lists everything; no bubble on top of it.
  if($('#me-assist')){bubbles.length=0;return}
  const b=bubbles.shift();if(!b)return;const o=orb();if(!o)return;current=b;
  const el=document.createElement('div');el.id='me-bubble';el.className='me-bubble';el.setAttribute('role','status');el.dataset.urgent=b.urgent?'1':'';
  el.innerHTML=`<span>${esc(b.text)}</span><button class="icon-btn" aria-label="关闭">${icon('close')}</button>`;document.body.append(el);
  const r=o.getBoundingClientRect();if(innerWidth>700){el.style.left=(r.right+10)+'px';el.style.bottom=(innerHeight-r.bottom)+'px'}else{el.style.right='76px';el.style.top=Math.max(8,r.top)+'px'}
  el.onclick=e=>{const close=e.target.closest('button');el.remove();clearTimeout(bubbleTimer);if(!close){if(b.open)b.open();else openPanel()}setTimeout(nextBubble,300)};
  o.classList.add('speaking');clearTimeout(bubbleTimer);bubbleTimer=setTimeout(()=>{el.remove();o.classList.remove('speaking');setTimeout(nextBubble,400)},8000);
 }
 function togglePanel(){if($('#me-assist'))closePanel();else openPanel()}
 function closePanel(){$('#me-assist')?.remove()}
 function openPanel(){
  if(!prefs.enabled)return;let p=$('#me-assist');
  if(!p){p=document.createElement('aside');p.id='me-assist';p.className='me-assist';p.setAttribute('aria-label','Me 管家');document.body.append(p);p.addEventListener('click',panelClick);
   p.innerHTML=`<header><b>✦ Me 管家</b><label class="assist-switch" title="关闭后不再提醒，可在设置里重新打开"><input type="checkbox" id="assist-enabled" checked> 管理应用</label><button class="icon-btn" data-me="close" aria-label="关闭">${icon('close')}</button></header><div class="assist-body"></div><form class="assist-ask"><div class="assist-chips">${SUGGESTIONS.map(s=>`<button type="button" data-me-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div><textarea rows="2" maxlength="2000" placeholder="让 Me 帮你：发消息、建待办、约日程、改状态、打开文档…"></textarea><button class="primary" type="submit">发送</button></form>`;
   p.querySelector('#assist-enabled').onchange=e=>{if(!e.target.checked)setEnabled(false)};
   const form=p.querySelector('form'),ta=form.querySelector('textarea');form.onsubmit=e=>{e.preventDefault();ask(ta.value)};ta.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();ask(ta.value)}};
   if(!prefs.ai)form.classList.add('hidden');
  }
  draw();if(prefs.ai&&prefs.brief&&!brief&&!briefing)loadBrief();
 }
 function draw(){
  const body=$('#me-assist .assist-body');if(!body)return;
  const hour=new Date().getHours(),hello=hour<6?'夜深了':hour<11?'早上好':hour<14?'中午好':hour<18?'下午好':'晚上好';
  const facts=brief?.facts;
  body.innerHTML=`<section class="assist-hello"><h3>${hello}，${esc(S.user?.name||'')}</h3>${facts?`<div class="assist-facts"><span><b>${facts.unread||0}</b>未读</span><span><b>${facts.mentions||0}</b>@我</span><span><b>${facts.tasks||0}</b>待办</span><span><b>${facts.events||0}</b>日程</span></div>`:''}</section>
   ${prefs.ai&&prefs.brief?`<section class="assist-brief"><h4>今日简报${brief?.text?'<button class="link" data-me="rebrief">刷新</button>':''}</h4>${briefing?'<div class="ai-loading"><span></span>Me 正在整理今天的情况…</div>':brief?.text?`<div class="ai-reply">${replyHTML(brief.text)}</div>`:'<button class="secondary" data-me="rebrief">生成今日简报</button>'}</section>`:''}
   <section class="assist-notices"><h4>需要关注${notices.length?` · ${notices.length}`:''}</h4>${notices.length?notices.map(noticeHTML).join(''):'<p class="hint">暂时没有需要你处理的事 🎉</p>'}</section>
   ${answer?`<section class="assist-answer"><h4>Me 的回复</h4>${answer.loading?'<div class="ai-loading"><span></span>Me 正在想…</div>':`${answer.reply?`<div class="ai-reply">${replyHTML(answer.reply)}</div>`:''}${answer.actions.length?`<div class="assist-actions">${answer.actions.map(actionHTML).join('')}${answer.actions.filter(a=>!a.done).length>1?'<button class="primary" data-me="run-all">全部执行</button>':''}</div>`:''}`}</section>`:''}
   ${!prefs.ai?'<p class="hint">服务器未开启 AI，Me 管家只做提醒。</p>':''}`;
 }
 function noticeHTML(n,i){return `<div class="notice ${n.level||''}"><span class="notice-icon">${n.icon||'•'}</span><div class="notice-text">${esc(n.text)}${n.sub?`<small>${esc(n.sub)}</small>`:''}</div><div class="notice-actions">${(n.actions||[]).map((a,j)=>`<button class="${j===0?'primary':'secondary'}" data-notice="${i}" data-notice-action="${j}">${esc(a.label)}</button>`).join('')}<button class="icon-btn" data-notice-dismiss="${i}" title="忽略" aria-label="忽略">${icon('close')}</button></div></div>`}

 // Notices ---------------------------------------------------------------------------
 async function refresh(){
  if(!prefs.enabled||!S.user)return;
  const skip=dismissed(),list=[];
  const conv=S.conversations||[];
  for(const c of conv.filter(c=>c.mentionCount>0).slice(0,3))list.push({key:'mention:'+c.id+':'+c.mentionCount,icon:'@',level:'high',text:`${c.name} 里有 ${c.mentionCount} 条消息 @你`,actions:[{label:'查看',run:()=>openChat(c.id)}]});
  const unread=conv.filter(c=>c.unread>0&&!c.muted&&!c.peer?.ai),total=unread.reduce((n,c)=>n+c.unread,0);
  if(total)list.push({key:'unread:'+total,icon:'💬',text:`${unread.length} 个聊天共 ${total} 条未读`,sub:unread.slice(0,3).map(c=>c.name).join('、'),actions:[{label:'去看看',run:()=>{S.chatFilter='unread';showTab('messages')}}]});
  try{
   const {tasks,events}=await Work.fetchSoon();
   const now=Date.now();
   const overdue=tasks.filter(t=>t.due&&t.due<now),soon=tasks.filter(t=>t.due&&t.due>=now&&t.due-now<6*3600000);
   if(overdue.length)list.push({key:'overdue:'+overdue.map(t=>t.id).join(),icon:'⏰',level:'high',text:`${overdue.length} 个待办已逾期`,sub:overdue.slice(0,3).map(t=>t.title).join('、'),actions:[{label:'处理',run:()=>showWork('tasks')}]});
   for(const t of soon.slice(0,3))list.push({key:'due:'+t.id+':'+t.due,icon:'📌',text:`待办“${t.title}”将在 ${whenText(t.due)} 截止`,actions:[{label:'完成',run:()=>api('/api/tasks/'+t.id,{method:'PATCH',body:{done:true}}).then(()=>{toast('已完成');refresh()})},{label:'查看',run:()=>{showWork('tasks');setTimeout(()=>Work.openTask(t.id),200)}}]});
   for(const e of events.filter(e=>e.start>now-10*60000&&e.start-now<3*3600000&&e.attendees.find(a=>a.id===me())?.response!=='decline').slice(0,3)){
    const mins=Math.round((e.start-now)/60000);
    list.push({key:'event:'+e.id+':'+e.start,icon:'📅',level:mins<=15?'high':'',text:mins>0?`“${e.title}”${mins<60?mins+' 分钟后':'将在 '+whenText(e.start)}开始`:`“${e.title}”正在进行`,sub:e.location||(e.meeting?'线上会议':''),actions:[{label:'查看',run:()=>{showWork('calendar');setTimeout(()=>Work.openEvent(e.id),200)}}]});
    const remind=e.remind||15;if(mins<=remind&&mins>=-1&&!shown.has('remind:'+e.id+e.start)){shown.add('remind:'+e.id+e.start);if(!quiet())bubble(`“${e.title}”${mins>0?mins+' 分钟后开始':'开始了'}${e.meeting?'，点我查看会议':''}`,()=>{showWork('calendar');setTimeout(()=>Work.openEvent(e.id),200)})}
   }
   for(const t of soon.filter(t=>t.due-now<30*60000))if(!shown.has('due:'+t.id)){shown.add('due:'+t.id);if(!quiet())bubble(`待办“${t.title}”快到截止时间了`,()=>showWork('tasks'))}
  }catch{}
  notices=list.filter(n=>!skip.has(n.key)).concat(extra.filter(n=>!skip.has(n.key)));
  orb();draw();
 }
 const extra=[];
 document.addEventListener('change',e=>{if(e.target.matches?.('[data-assistant-toggle]'))setEnabled(e.target.checked)});
 function remember(n){if(extra.some(x=>x.key===n.key))return;extra.unshift(n);if(extra.length>20)extra.pop()}
 function dismiss(i){const n=notices[i];if(!n)return;const d=dismissed();d.add(n.key);store('dismissed',{date:today(),keys:[...d]});const j=extra.indexOf(n);if(j>=0)extra.splice(j,1);notices.splice(i,1);orb();draw()}

 // Brief and requests ------------------------------------------------------------------
 async function loadBrief(force=false){
  const cached=store('brief');if(!force&&cached?.date===today()){brief=cached;draw();return}
  briefing=true;draw();
  try{const r=await api('/api/assistant/brief?tz='+tz(),{method:'POST',body:{}});brief={date:today(),text:r.brief,facts:r.facts};store('brief',brief)}
  catch(e){brief={date:today(),text:'',facts:null};if(e.status!==429)toast(e.message)}
  finally{briefing=false;draw()}
 }
 async function ask(text){
  text=(text||'').trim();if(!text||asking)return;asking=true;const ta=$('#me-assist textarea');if(ta)ta.value='';
  answer={loading:true,actions:[]};draw();
  try{const r=await api('/api/assistant/ask?tz='+tz(),{method:'POST',body:{text}});answer={reply:r.reply,actions:r.actions.map(a=>({...a,done:false}))}}
  catch(e){answer={reply:'⚠️ '+e.message,actions:[]}}
  finally{asking=false;draw();$('#me-assist .assist-answer')?.scrollIntoView({block:'nearest'})}
 }
 const convName=id=>S.conversations.find(c=>c.id===id)?.name||'某个聊天';
 const userName=id=>id===me()?'我':(S.friends||[]).find(f=>f.id===id)?.name||'成员';
 const parseTime=s=>{if(!s)return 0;const t=new Date(String(s).replace(' ','T')).getTime();return isNaN(t)?0:t};
 function describe(a){
  switch(a.type){
   case 'send_message':return [`发消息给 ${convName(a.conversationId)}`,a.text];
   case 'schedule_message':return [`定时发消息给 ${convName(a.conversationId)}`,`${whenText(parseTime(a.at))}：${a.text}`];
   case 'create_task':return ['新建待办',`${a.title}${a.due?' · 截止 '+whenText(parseTime(a.due)):''}${a.assignees?.length?' · 负责人 '+a.assignees.map(userName).join('、'):''}`];
   case 'complete_task':return ['完成待办',(Work.tasks()||[]).find(t=>t.id===a.taskId)?.title||a.taskId];
   case 'create_event':return ['新建日程',`${a.title} · ${whenText(parseTime(a.start))}${a.end?' – '+whenText(parseTime(a.end)).split(' ')[1]:''}${a.attendees?.length?' · 邀请 '+a.attendees.map(userName).join('、'):''}${a.meeting?' · 线上会议':''}`];
   case 'set_status':return ['设置状态',a.status==='clear'?'清除状态':({busy:'忙碌',dnd:'请勿打扰',away:'暂时离开',leave:'休假中',custom:a.text}[a.status]||a.status)+(a.hours?` · ${a.hours} 小时`:'')];
   case 'open':return ['打开',{chat:convName(a.id),doc:'云文档',tasks:'待办',calendar:'日历',flags:'标记的消息',docs:'云文档列表'}[a.target]||a.target];
   case 'create_doc':return ['新建文档',a.title];
   case 'summarize_chat':return ['总结聊天',convName(a.conversationId)];
  }
  return [a.type,''];
 }
 function actionHTML(a,i){const [title,detail]=describe(a);return `<div class="assist-action${a.done?' done':''}"><div><b>${esc(title)}</b>${detail?`<small>${esc(detail)}</small>`:''}</div>${a.done?`<span class="ok">${a.done===true?'已完成':esc(a.done)}</span>`:`<button class="primary" data-me-run="${i}">执行</button><button class="secondary" data-me-skip="${i}">取消</button>`}</div>`}
 async function run(a){
  const clientId='me-'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
  switch(a.type){
   case 'send_message':await api(`/api/conversations/${a.conversationId}/messages`,{method:'POST',body:{kind:'text',text:String(a.text||''),clientId}});return '已发送';
   case 'schedule_message':await api('/api/schedules',{method:'POST',body:{conversationId:a.conversationId,kind:'text',text:String(a.text||''),at:parseTime(a.at),repeat:'once',tzOffset:tz()}});return '已设置';
   case 'create_task':await api('/api/tasks',{method:'POST',body:{title:a.title,due:parseTime(a.due),assignees:a.assignees||[]}});return '已创建';
   case 'complete_task':await api('/api/tasks/'+a.taskId,{method:'PATCH',body:{done:true}});return '已完成';
   case 'create_event':{const start=parseTime(a.start);await api('/api/events',{method:'POST',body:{title:a.title,start,end:parseTime(a.end)||start+3600000,attendees:a.attendees||[],meeting:!!a.meeting,location:a.location||''}});return '已创建'}
   case 'set_status':{const r=await api('/api/me/status',{method:'PUT',body:{manual:a.status==='clear'?'':a.status,text:a.text||'',until:a.hours?Date.now()+a.hours*3600000:0}});S.myStatus=r;return '已设置'}
   case 'open':closePanel();if(a.target==='chat'&&a.id)openChat(a.id);else if(a.target==='doc'&&a.id)Docs.open(a.id);else if(a.target==='docs')showTab('docs');else showWork(a.target==='calendar'?'calendar':a.target==='flags'?'flags':'tasks');return '已打开';
   case 'create_doc':{const form=new FormData();form.append('file',new File([String(a.markdown||'')],(a.title||'新文档').replace(/[\\/:*?"<>|]/g,'_')+'.md',{type:'text/markdown'}));const r=await api('/api/docs/import',{method:'POST',body:form});closePanel();Docs.open(r.id);return '已创建'}
   case 'summarize_chat':closePanel();await openChat(a.conversationId);setTimeout(()=>document.querySelector('[data-cx=ai-summary]')?.click(),500);return '已打开';
  }
  throw Error('Me 不支持这个操作');
 }
 async function runAt(i){const a=answer?.actions[i];if(!a||a.done)return;try{a.done=await run(a)}catch(e){toast(e.message);return}draw();setTimeout(refresh,500)}
 function panelClick(e){
  const t=e.target;let b;
  if(t.closest('[data-me=close]')){closePanel();return}
  if(t.closest('[data-me=rebrief]')){loadBrief(true);return}
  if(t.closest('[data-me=run-all]')){(async()=>{for(let i=0;i<answer.actions.length;i++)await runAt(i)})();return}
  if((b=t.closest('[data-me-run]'))){runAt(+b.dataset.meRun);return}
  if((b=t.closest('[data-me-skip]'))){answer.actions[+b.dataset.meSkip].done='已取消';draw();return}
  if((b=t.closest('[data-me-suggest]'))){const ta=$('#me-assist textarea');ta.value=b.dataset.meSuggest;ta.focus();return}
  if((b=t.closest('[data-notice-action]'))){const n=notices[+b.dataset.notice];const a=n?.actions?.[+b.dataset.noticeAction];if(a){Promise.resolve(a.run()).catch(err=>toast(err.message));if(!/查看|去看看|处理/.test(a.label))dismiss(+b.dataset.notice)}return}
  if((b=t.closest('[data-notice-dismiss]'))){dismiss(+b.dataset.noticeDismiss);return}
 }
 async function setEnabled(on){
  try{prefs=await api('/api/assistant/prefs',{method:'PUT',body:{enabled:on}})}catch(e){toast(e.message);return}
  if(!on){closePanel();orb();toast('已关闭 AI 管家，可在设置里重新打开')}else{toast('Me 管家已开启');boot()}
 }
 async function boot(){
  orb();refresh();clearInterval(timer);timer=setInterval(refresh,60000);
  if(prefs.ai&&prefs.brief){const cached=store('brief');if(cached?.date===today())brief=cached;else{await loadBrief();if(brief?.text&&!quiet())bubble('今日简报已准备好，点我看看今天要处理的事',openPanel,false)}}
 }

 return {
  async start(){started=true;try{prefs=await api('/api/assistant/prefs')}catch{prefs={enabled:false}}if(prefs.enabled)boot();else orb()},
  settingsRow(){return `<div class="prefs-row"><span>AI 管家 Me<small class="hint" style="display:block">悬浮助手、主动提醒和今日简报</small></span><label class="switch"><input type="checkbox" data-assistant-toggle ${prefs.enabled?'checked':''}><span></span></label></div>`},
  toggle(on){setEnabled(on)},
  open:openPanel,
  event(type,d){
   if(!prefs.enabled)return;
   if(type==='task'&&d.created&&d.by!==me()){const t=d.task;remember({key:'assigned:'+t.id,icon:'📌',level:'high',text:`${t.creator.name} 给你分配了待办“${t.title}”`,sub:t.due?'截止 '+whenText(t.due):'',actions:[{label:'查看',run:()=>{showWork('tasks');setTimeout(()=>Work.openTask(t.id),200)}}]});if(!quiet())bubble(`${t.creator.name} 给你分配了待办：${t.title}`,()=>{showWork('tasks');setTimeout(()=>Work.openTask(t.id),200)})}
   if(type==='event'&&d.created&&d.by!==me()){const e=d.event;remember({key:'invite:'+e.id,icon:'📅',level:'high',text:`${e.creator.name} 邀请你参加“${e.title}”`,sub:whenText(e.start),actions:[{label:'接受',run:()=>api('/api/events/'+e.id,{method:'PATCH',body:{response:'accept'}}).then(()=>toast('已接受'))},{label:'拒绝',run:()=>api('/api/events/'+e.id,{method:'PATCH',body:{response:'decline'}}).then(()=>toast('已拒绝'))}]});if(!quiet())bubble(`${e.creator.name} 邀请你参加“${e.title}”（${whenText(e.start)}）`,openPanel)}
   if(type==='event'&&d.deleted&&d.by!==me())remember({key:'cancel:'+d.event.id,icon:'📅',text:`日程“${d.event.title||''}”已取消`});
   if(type==='doc-access'&&!d.deleted)remember({key:'doc:'+d.docId,icon:'📄',text:'有文档的协作权限有变化，可能有人与你分享了文档',actions:[{label:'打开',run:()=>Docs.open(d.docId)}]});
   if(type==='message'&&d.sender!==me()&&d.mentionRecipients?.includes(me())&&S.active!==d.conversationId&&!quiet())bubble(`${d.name} 在“${convName(d.conversationId)}”里 @了你`,()=>openMessage(d.conversationId,d.id));
   if(type==='assistant-prefs'){const was=prefs.enabled;prefs={...prefs,...d};if(was!==prefs.enabled){if(prefs.enabled)boot();else{closePanel();orb()}}return}
   clearTimeout(this._t);this._t=setTimeout(refresh,800);
  },
  changed(){if(started&&prefs.enabled){orb();clearTimeout(this._c);this._c=setTimeout(refresh,1500)}},
  reset(){clearInterval(timer);prefs={enabled:false};notices=[];brief=null;answer=null;extra.length=0;bubbles.length=0;$('#me-orb')?.remove();$('#me-bubble')?.remove();$('#me-assist')?.remove()},
 };
}
