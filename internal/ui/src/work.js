import {confirmDialog} from './dialogs.js';

// 工作台, after DingTalk and Feishu: to-dos that can be assigned, a calendar
// with invitations and online meetings, and messages flagged to handle later.
// Also the quick filters above the chat list (未读, @我, 单聊, 群聊).

const DAY=86400000;
const pad=n=>String(n).padStart(2,'0');
export const localInput=t=>{const d=new Date(t);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`};
const dayKey=t=>{const d=new Date(t);return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`};
const startOfDay=t=>{const d=new Date(t);d.setHours(0,0,0,0);return d.getTime()};
const hm=t=>{const d=new Date(t);return pad(d.getHours())+':'+pad(d.getMinutes())};
export function whenText(t){if(!t)return '';const d=new Date(t),today=startOfDay(Date.now()),day=startOfDay(t);const label=day===today?'今天':day===today+DAY?'明天':day===today-DAY?'昨天':`${d.getMonth()+1}月${d.getDate()}日`;return label+' '+hm(t)}

export function createWork({S,api,esc,av,icon,modal,closeModal,toast,renderSidebar,openMessage,preview,meetingButton}){
 const $=s=>document.querySelector(s);
 let view='tasks',taskScope='mine',tasks=null,events=null,flags=null,month=startOfDay(Date.now()),selected=startOfDay(Date.now());
 const flagged=new Set();
 const me=()=>S.user?.id;
 const peopleHTML=list=>list.slice(0,4).map(p=>`<span class="mini-av" title="${esc(p.name)}">${av(p)}</span>`).join('')+(list.length>4?`<span class="mini-more">+${list.length-4}</span>`:'');

 // Data ---------------------------------------------------------------------
 async function loadTasks(){try{tasks=await api('/api/tasks?scope='+taskScope)}catch(e){tasks=[];toast(e.message)}if(S.tab==='work'&&view==='tasks')draw()}
 async function loadEvents(){const from=startOfDay(month)-7*DAY,to=from+50*DAY;try{events=await api(`/api/events?from=${Math.min(from,Date.now()-DAY)}&to=${Math.max(to,Date.now()+14*DAY)}`)}catch(e){events=[];toast(e.message)}if(S.tab==='work'&&view==='calendar')draw()}
 async function loadFlags(){try{flags=await api('/api/flags');flagged.clear();for(const m of flags)flagged.add(m.id)}catch(e){flags=[]}if(S.tab==='work'&&view==='flags')draw()}

 // Page -----------------------------------------------------------------------
 function render(){draw();if(view==='tasks')loadTasks();else if(view==='calendar')loadEvents();else loadFlags()}
 function draw(){
  const main=$('#main-content');if(!main||S.tab!=='work')return;
  const tabs=[['tasks','待办'],['calendar','日历'],['flags','标记']];
  main.innerHTML=`<section class="work-page"><header class="work-head"><h2>工作台</h2><nav class="docs-tabs">${tabs.map(([k,l])=>`<button class="${view===k?'active':''}" data-work-view="${k}">${l}</button>`).join('')}</nav><span class="spacer"></span>${view==='tasks'?'<button class="primary" data-work="new-task">新建待办</button>':view==='calendar'?'<button class="primary" data-work="new-event">新建日程</button>':''}</header><div class="work-body">${view==='tasks'?tasksHTML():view==='calendar'?calendarHTML():flagsHTML()}</div></section>`;
  const quick=$('#task-quick');if(quick)quick.onkeydown=e=>{if(e.key==='Enter'&&quick.value.trim()&&!e.isComposing){e.preventDefault();quickTask(quick.value.trim())}};
 }
 function tasksHTML(){
  const list=tasks||[];
  return `<div class="task-quick"><input id="task-quick" maxlength="200" placeholder="添加待办，按 Enter 保存（可写“明天下午三点”之类的时间，打开详情再调整）"></div>
   <nav class="work-subtabs">${[['mine','我负责的'],['created','我分配的'],['done','已完成']].map(([k,l])=>`<button class="${taskScope===k?'active':''}" data-task-scope="${k}">${l}</button>`).join('')}</nav>
   <div class="task-list">${tasks===null?'<p class="hint">正在加载…</p>':list.length?list.map(taskRow).join(''):`<div class="docs-empty"><b>${taskScope==='done'?'还没有完成的待办':'没有待办'}</b><p>在聊天里右键消息“转为待办”，或者对 Me 说“提醒我周五交报告”。</p></div>`}</div>`;
 }
 function taskRow(t){
  const overdue=t.due&&!t.done&&t.due<Date.now(),soon=t.due&&!t.done&&!overdue&&t.due-Date.now()<DAY;
  const from=t.creator.id!==me()?`${esc(t.creator.name)} 分配`:t.assignees.length&&!(t.assignees.length===1&&t.assignees[0].id===me())?'我分配给 '+esc(t.assignees.map(a=>a.name).join('、')):'';
  return `<div class="task-row${t.done?' done':''}" data-task="${t.id}"><input type="checkbox" class="task-check" data-task-done="${t.id}" ${t.done?'checked':''} aria-label="完成"><div class="task-main"><b>${esc(t.title)}</b><small>${t.due?`<span class="${overdue?'overdue':soon?'soon':''}">${overdue?'已逾期 · ':''}截止 ${whenText(t.due)}</span>`:'无截止时间'}${from?' · '+from:''}${t.messageId?' · 来自聊天':''}</small></div><span class="task-people">${peopleHTML(t.assignees)}</span></div>`;
 }
 function quickTask(text){
  // A due time written in the title ("明天下午三点") is picked up.
  const due=parseWhen(text);api('/api/tasks',{method:'POST',body:{title:text,due:due||0,assignees:[]}}).then(()=>{toast(due?'已添加，截止 '+whenText(due):'已添加待办');loadTasks()}).catch(e=>toast(e.message));
 }
 function calendarHTML(){
  const m=new Date(month);m.setDate(1);const first=new Date(m),startDay=new Date(m);startDay.setDate(1-((first.getDay()+6)%7));
  const byDay=new Map();for(const e of events||[]){for(let d=startOfDay(e.start);d<=e.end;d+=DAY){const k=dayKey(d);if(!byDay.has(k))byDay.set(k,[]);byDay.get(k).push(e);if(byDay.get(k).length>50)break}}
  const cells=[];for(let i=0;i<42;i++){const d=new Date(startDay);d.setDate(startDay.getDate()+i);const t=d.getTime(),k=dayKey(t),n=(byDay.get(k)||[]).length;cells.push(`<button class="cal-day${d.getMonth()!==first.getMonth()?' other':''}${k===dayKey(Date.now())?' today':''}${k===dayKey(selected)?' selected':''}" data-cal-day="${t}">${d.getDate()}${n?`<i>${n>3?'•••':'•'.repeat(n)}</i>`:''}</button>`)}
  const day=(byDay.get(dayKey(selected))||[]).slice().sort((a,b)=>a.start-b.start);
  const upcoming=(events||[]).filter(e=>e.end>=Date.now()).sort((a,b)=>a.start-b.start).slice(0,8);
  return `<div class="cal-wrap"><div class="cal-month"><div class="cal-nav"><button class="icon-btn" data-cal-move="-1" aria-label="上个月">‹</button><b>${first.getFullYear()} 年 ${first.getMonth()+1} 月</b><button class="icon-btn" data-cal-move="1" aria-label="下个月">›</button><button class="link" data-cal-today>今天</button></div><div class="cal-grid">${['一','二','三','四','五','六','日'].map(w=>`<span class="cal-week">${w}</span>`).join('')}${cells.join('')}</div></div>
   <div class="cal-agenda"><h4>${whenText(selected).split(' ')[0]} 的日程</h4>${events===null?'<p class="hint">正在加载…</p>':day.length?day.map(eventRow).join(''):`<p class="hint">这天没有日程 · <button class="link" data-work="new-event">新建</button></p>`}<h4>接下来</h4>${upcoming.length?upcoming.map(eventRow).join(''):'<p class="hint">没有即将开始的日程</p>'}</div></div>`;
 }
 function eventRow(e){
  const mine=e.creator.id===me(),att=e.attendees.find(a=>a.id===me()),resp={accept:'已接受',decline:'已拒绝',tentative:'待定','':'待回复'}[att?.response??''];
  return `<button class="event-row${att?.response==='decline'?' declined':''}" data-event="${e.id}"><span class="event-time">${e.allDay?'全天':hm(e.start)+'–'+hm(e.end)}</span><span class="event-main"><b>${esc(e.title)}</b><small>${startOfDay(e.start)!==startOfDay(Date.now())?whenText(e.start).split(' ')[0]+' · ':''}${e.location?esc(e.location)+' · ':''}${e.meeting?'线上会议 · ':''}${mine?'我组织':esc(e.creator.name)+' 邀请 · '+resp}</small></span></button>`;
 }
 function flagsHTML(){
  if(flags===null)return '<p class="hint">正在加载…</p>';
  if(!flags.length)return '<div class="docs-empty"><b>没有标记的消息</b><p>在聊天里右键消息选“标记”，稍后在这里集中处理。</p></div>';
  return `<div class="flag-list">${flags.map(m=>`<div class="flag-row">${av({id:m.sender,name:m.name,avatar:m.avatar})}<div class="flag-main"><small>${esc(m.conversationName)} · ${esc(m.name)} · ${whenText(m.created)}</small><p>${esc(preview(m))}</p></div><div class="flag-actions"><button class="secondary" data-flag-open="${m.id}" data-cid="${m.conversationId}">查看</button><button class="secondary" data-flag-task="${m.id}">转为待办</button><button class="secondary" data-flag-done="${m.id}">完成</button></div></div>`).join('')}</div>`;
 }

 // Task and event dialogs ---------------------------------------------------------
 function peoplePicker(selectedIds,id='people'){
  const friends=(S.friends||[]).filter(f=>!f.ai);
  return `<div class="people-picker" id="${id}"><input class="people-filter" placeholder="搜索好友"><div class="people-list">${friends.map(f=>`<label data-name="${esc((f.remark||'')+f.name+(f.number||''))}">${av(f)}<span>${esc(f.remark||f.name)}</span><input type="checkbox" value="${f.id}" ${selectedIds.includes(f.id)?'checked':''}></label>`).join('')||'<p class="hint">还没有好友</p>'}</div></div>`;
 }
 function bindPicker(id='people'){const box=document.getElementById(id);if(!box)return;box.querySelector('.people-filter').oninput=e=>{const q=e.target.value.trim().toLowerCase();box.querySelectorAll('label').forEach(l=>l.classList.toggle('hidden',!!q&&!l.dataset.name.toLowerCase().includes(q)))}}
 const picked=(id='people')=>[...document.querySelectorAll(`#${id} input[type=checkbox]:checked`)].map(i=>i.value);
 function newTask(prefill={}){
  modal('新建待办',`<div class="poll-form"><input id="task-title" maxlength="200" placeholder="要做什么" value="${esc(prefill.title||'')}"><label>截止时间<input type="datetime-local" id="task-due" value="${prefill.due?localInput(prefill.due):''}"></label><label>负责人（不选就是自己）</label>${peoplePicker(prefill.assignees||[])}<textarea id="task-note" rows="3" maxlength="2000" placeholder="说明（可选）">${esc(prefill.note||'')}</textarea></div>`,'<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="task-save">创建</button>');
  bindPicker();$('#task-title').focus();
  $('#task-save').onclick=async()=>{const due=$('#task-due').value?new Date($('#task-due').value).getTime():0;try{await api('/api/tasks',{method:'POST',body:{title:$('#task-title').value,note:$('#task-note').value,due,assignees:picked(),messageId:prefill.messageId||''}});closeModal();toast('已创建待办');if(S.tab==='work')loadTasks()}catch(e){toast(e.message)}};
 }
 async function openTask(id){
  let list=tasks||[];let t=list.find(x=>x.id===id);if(!t){try{t=(await api('/api/tasks?scope=all')).find(x=>x.id===id)}catch{}}if(!t){toast('待办不存在');return}
  const mine=t.creator.id===me();
  modal(mine?'编辑待办':'待办详情',`<div class="poll-form">${mine?`<input id="task-title" maxlength="200" value="${esc(t.title)}"><label>截止时间<input type="datetime-local" id="task-due" value="${t.due?localInput(t.due):''}"></label><label>负责人</label>${peoplePicker(t.assignees.map(a=>a.id))}<textarea id="task-note" rows="3" maxlength="2000" placeholder="说明">${esc(t.note)}</textarea>`:`<h3>${esc(t.title)}</h3><p class="hint">${esc(t.creator.name)} 分配 · ${t.due?'截止 '+whenText(t.due):'无截止时间'}</p>${t.note?`<p>${esc(t.note).replace(/\n/g,'<br>')}</p>`:''}<p>负责人：${esc(t.assignees.map(a=>a.name).join('、')||'—')}</p>`}${t.messageId?`<button class="link" data-task-message="${t.messageId}" data-cid="${t.conversationId}">查看原消息</button>`:''}</div>`,
   `${mine?'<button class="secondary danger" id="task-delete">删除</button>':''}<button class="secondary" id="task-toggle">${t.done?'标为未完成':'完成'}</button>${mine?'<button class="primary" id="task-update">保存</button>':''}`);
  if(mine){bindPicker();$('#task-update').onclick=async()=>{try{await api('/api/tasks/'+id,{method:'PATCH',body:{title:$('#task-title').value,note:$('#task-note').value,due:$('#task-due').value?new Date($('#task-due').value).getTime():0,assignees:picked()}});closeModal();loadTasks()}catch(e){toast(e.message)}};
   $('#task-delete').onclick=async()=>{if(!await confirmDialog('删除后无法恢复。',{title:'删除待办',ok:'删除',danger:true}))return;try{await api('/api/tasks/'+id,{method:'DELETE'});closeModal();loadTasks()}catch(e){toast(e.message)}}}
  $('#task-toggle').onclick=async()=>{try{await api('/api/tasks/'+id,{method:'PATCH',body:{done:!t.done}});closeModal();loadTasks()}catch(e){toast(e.message)}};
 }
 function newEvent(prefill={}){
  const start=prefill.start||(()=>{const d=new Date(Math.max(selected,startOfDay(Date.now())));const n=new Date();d.setHours(Math.max(9,n.getHours()+1),0,0,0);return d.getTime()})();
  const end=prefill.end||start+3600000;
  modal('新建日程',eventForm({title:prefill.title||'',start,end,location:'',note:'',meeting:!!prefill.meeting,remind:15,attendees:(prefill.attendees||[]).map(id=>({id}))}),'<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="event-save">创建</button>');
  bindPicker('event-people');$('#event-title').focus();
  $('#event-save').onclick=async()=>{try{await api('/api/events',{method:'POST',body:eventValues()});closeModal();toast('已创建日程，已通知参与人');loadEvents()}catch(e){toast(e.message)}};
 }
 function eventForm(e){return `<div class="poll-form"><input id="event-title" maxlength="200" placeholder="日程主题" value="${esc(e.title)}"><div class="form-row"><label>开始<input type="datetime-local" id="event-start" value="${localInput(e.start)}"></label><label>结束<input type="datetime-local" id="event-end" value="${localInput(e.end)}"></label></div><div class="form-row"><label>地点<input id="event-location" maxlength="200" value="${esc(e.location)}" placeholder="会议室或地址"></label><label>提醒<select id="event-remind">${[[0,'不提醒'],[5,'提前 5 分钟'],[15,'提前 15 分钟'],[30,'提前 30 分钟'],[60,'提前 1 小时'],[1440,'提前 1 天']].map(([v,l])=>`<option value="${v}" ${e.remind===v?'selected':''}>${l}</option>`).join('')}</select></label></div><label class="check-row"><input type="checkbox" id="event-meeting" ${e.meeting?'checked':''}> 线上会议（到时一键发起）</label><label>参与人</label>${peoplePicker(e.attendees.map(a=>a.id),'event-people')}<textarea id="event-note" rows="2" maxlength="2000" placeholder="说明（可选）">${esc(e.note)}</textarea></div>`}
 const eventValues=()=>({title:$('#event-title').value,start:new Date($('#event-start').value).getTime(),end:new Date($('#event-end').value).getTime(),location:$('#event-location').value,note:$('#event-note').value,meeting:$('#event-meeting').checked,remind:+$('#event-remind').value,attendees:picked('event-people')});
 async function openEvent(id){
  let e=(events||[]).find(x=>x.id===id);if(!e){try{e=(await api(`/api/events?from=${Date.now()-60*DAY}&to=${Date.now()+300*DAY}`)).find(x=>x.id===id)}catch{}}if(!e){toast('日程不存在或已取消');return}
  const mine=e.creator.id===me(),att=e.attendees.find(a=>a.id===me());
  const live=e.meeting&&Date.now()>e.start-15*60000&&Date.now()<e.end;
  modal(mine?'编辑日程':'日程详情',mine?eventForm(e):`<div class="event-detail"><h3>${esc(e.title)}</h3><p>${e.allDay?'全天':whenText(e.start)+' – '+hm(e.end)}</p>${e.location?`<p>地点：${esc(e.location)}</p>`:''}${e.meeting?'<p>线上会议</p>':''}<p>组织者：${esc(e.creator.name)}</p>${e.note?`<p>${esc(e.note).replace(/\n/g,'<br>')}</p>`:''}</div>`+`<div class="event-people"><b>参与人</b>${e.attendees.map(a=>`<span>${av(a)}${esc(a.name)}<small>${{accept:'接受',decline:'拒绝',tentative:'待定','':'未回复'}[a.response]}</small></span>`).join('')||'<span class="hint">只有组织者</span>'}</div>`,
   (mine?'<button class="secondary danger" id="event-delete">取消日程</button>':att?['accept','tentative','decline'].map(r=>`<button class="${att.response===r?'primary':'secondary'}" data-event-response="${r}">${{accept:'接受',tentative:'待定',decline:'拒绝'}[r]}</button>`).join(''):'')+(e.meeting?`<button class="${live?'primary':'secondary'}" id="event-meet">${live?'发起 / 加入会议':'发起会议'}</button>`:'')+(mine?'<button class="primary" id="event-update">保存</button>':''));
  if(mine){bindPicker('event-people');$('#event-update').onclick=async()=>{try{await api('/api/events/'+id,{method:'PATCH',body:eventValues()});closeModal();loadEvents()}catch(err){toast(err.message)}};$('#event-delete').onclick=async()=>{if(!await confirmDialog('参与人会收到通知。',{title:'取消日程',ok:'取消日程',cancel:'不取消',danger:true}))return;try{await api('/api/events/'+id,{method:'DELETE'});closeModal();loadEvents()}catch(err){toast(err.message)}}}
  document.querySelectorAll('[data-event-response]').forEach(b=>b.onclick=async()=>{try{await api('/api/events/'+id,{method:'PATCH',body:{response:b.dataset.eventResponse}});closeModal();loadEvents()}catch(err){toast(err.message)}});
  const meet=$('#event-meet');if(meet)meet.onclick=async()=>{closeModal();try{const room=await api('/api/meetings',{method:'POST',body:{title:e.title.slice(0,60),members:[e.creator.id,...e.attendees.map(a=>a.id)].filter(x=>x!==me())}});meetingButton(room.code)}catch(err){toast(err.message)}};
 }

 // Natural-language times in a quick to-do ----------------------------------------------
 function parseWhen(text){
  const now=new Date();let d=null;
  const day=/(今天|明天|后天|大后天)/.exec(text),week=/(下)?(周|星期)([一二三四五六日天])/.exec(text),date=/(\d{1,2})月(\d{1,2})[日号]/.exec(text);
  if(day){d=new Date(now);d.setDate(now.getDate()+{今天:0,明天:1,后天:2,大后天:3}[day[1]])}
  else if(week){d=new Date(now);const target='一二三四五六日天'.indexOf(week[3])%7+1;let diff=(target%7)-now.getDay();if(diff<=0||week[1])diff+=7;if(week[1]&&diff<=7&&(target%7)>now.getDay())diff+=0;d.setDate(now.getDate()+diff)}
  else if(date){d=new Date(now.getFullYear(),+date[1]-1,+date[2]);if(d<startOfDay(Date.now()))d.setFullYear(d.getFullYear()+1)}
  const time=/(上午|早上|中午|下午|晚上)?\s*(\d{1,2})(?:[:：点](\d{1,2})?|点半)/.exec(text);
  if(!d&&!time)return 0;if(!d)d=new Date(now);
  let h=18,m=0;if(time){h=+time[2];m=time[0].includes('半')?30:+(time[3]||0);if(/下午|晚上/.test(time[1]||'')&&h<12)h+=12;if(time[1]==='中午'&&h<6)h+=12}
  d.setHours(h,m,0,0);if(d.getTime()<Date.now()&&!day&&!week&&!date)d.setDate(d.getDate()+1);
  return d.getTime();
 }

 // Chat list filters ----------------------------------------------------------------------
 const FILTERS=[['all','全部'],['unread','未读'],['mention','@我'],['direct','单聊'],['group','群聊']];
 function chips(){if(S.tab!=='messages')return '';const f=S.chatFilter||'all';return `<div class="chat-filters" role="tablist">${FILTERS.map(([k,l])=>{const n=k==='unread'?S.conversations.filter(c=>c.unread>0).length:k==='mention'?S.conversations.filter(c=>c.mentionCount>0).length:0;return `<button role="tab" class="${f===k?'active':''}" data-chat-filter="${k}">${l}${n?`<i>${n}</i>`:''}</button>`}).join('')}</div>`}
 function filter(list){switch(S.chatFilter){case 'unread':return list.filter(c=>c.unread>0||c.mentionCount>0);case 'mention':return list.filter(c=>c.mentionCount>0);case 'direct':return list.filter(c=>c.kind==='direct');case 'group':return list.filter(c=>c.kind==='group');default:return list}}

 // Events ------------------------------------------------------------------------------------
 document.addEventListener('click',e=>{
  const t=e.target;let b;
  if((b=t.closest('[data-work-view]'))){view=b.dataset.workView;render();return}
  if((b=t.closest('[data-task-scope]'))){taskScope=b.dataset.taskScope;tasks=null;draw();loadTasks();return}
  if((b=t.closest('[data-task-done]'))){e.stopPropagation();const id=b.dataset.taskDone;api('/api/tasks/'+id,{method:'PATCH',body:{done:b.checked}}).then(()=>{toast(b.checked?'已完成':'已恢复');setTimeout(loadTasks,300)}).catch(err=>{b.checked=!b.checked;toast(err.message)});return}
  if((b=t.closest('[data-task]'))&&!t.closest('input')){openTask(b.dataset.task);return}
  if((b=t.closest('[data-task-message]'))){closeModal();openMessage(b.dataset.cid,b.dataset.taskMessage);return}
  if((b=t.closest('[data-work]'))){if(b.dataset.work==='new-task')newTask();else newEvent();return}
  if((b=t.closest('[data-cal-day]'))){selected=+b.dataset.calDay;const d=new Date(selected);if(d.getMonth()!==new Date(month).getMonth()){month=selected;loadEvents()}draw();return}
  if((b=t.closest('[data-cal-move]'))){const d=new Date(month);d.setDate(1);d.setMonth(d.getMonth()+(+b.dataset.calMove));month=d.getTime();events=null;draw();loadEvents();return}
  if(t.closest('[data-cal-today]')){month=selected=startOfDay(Date.now());draw();loadEvents();return}
  if((b=t.closest('[data-event]'))){openEvent(b.dataset.event);return}
  if((b=t.closest('[data-flag-open]'))){openMessage(b.dataset.cid,b.dataset.flagOpen);return}
  if((b=t.closest('[data-flag-done]'))){setFlag(b.dataset.flagDone,false).then(loadFlags);return}
  if((b=t.closest('[data-flag-task]'))){const m=(flags||[]).find(x=>x.id===b.dataset.flagTask);if(m)newTask({title:preview(m).slice(0,200),messageId:m.id});return}
  if((b=t.closest('[data-chat-filter]'))){S.chatFilter=b.dataset.chatFilter;renderSidebar();return}
  if((b=t.closest('[data-work-msg]'))){const m=S.messages.find(x=>x.id===b.dataset.mid);if(m)messageAction(b.dataset.workMsg,m);return}
 });
 function messageAction(kind,m){if(kind==='task')newTask({title:preview(m).slice(0,200),messageId:m.id});else setFlag(m.id,kind==='flag')}
 async function setFlag(id,on){try{await api(`/api/messages/${id}/flag`,{method:on?'POST':'DELETE'});if(on)flagged.add(id);else flagged.delete(id);toast(on?'已标记，可在工作台 → 标记中处理':'已取消标记')}catch(e){toast(e.message)}}

 return {
  render,newTask,newEvent,openTask,openEvent,chips,filter,parseWhen,
  menuItems(m){if(m.recalled)return '';return `<button data-work-msg="task" data-mid="${m.id}">${icon('check')}转为待办</button><button data-work-msg="${flagged.has(m.id)?'unflag':'flag'}" data-mid="${m.id}">${icon('star')}${flagged.has(m.id)?'取消标记':'标记'}</button>`},
  messageAction,setView(v){view=v},
  start(){loadFlags()},
  tasks:()=>tasks,events:()=>events,
  async fetchSoon(){const [t,e]=await Promise.all([api('/api/tasks').catch(()=>[]),api(`/api/events?from=${Date.now()-DAY}&to=${Date.now()+2*DAY}`).catch(()=>[])]);return {tasks:t,events:e}},
  event(type,d){
   if(type==='task'){if(S.tab==='work'&&view==='tasks')loadTasks()}
   if(type==='event'){if(S.tab==='work'&&view==='calendar')loadEvents()}
   if(type==='flags'){if(d.flagged)flagged.add(d.messageId);else flagged.delete(d.messageId);if(S.tab==='work'&&view==='flags')loadFlags()}
  },
  reset(){tasks=events=flags=null;flagged.clear();view='tasks';taskScope='mine'},
 };
}
