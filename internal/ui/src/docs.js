import {createDocEditor,peerColor} from './doc-editor.js';
import {createSheetEditor} from './sheet-editor.js';
import {toHTML,plain,replyHTML} from './docs-text.js';
import {confirmDialog,inputDialog} from './dialogs.js';

// 云文档: the list of documents and the page that hosts one editor, after
// Feishu Docs. It keeps the live connection (operations in, operations out),
// who else is in the document, sharing and permissions, history and the AI
// assistant. The editors only know about their own content.

const ROLE_LABEL={owner:'所有者',manage:'可管理',edit:'可编辑',view:'可阅读'};
const RANK={view:1,edit:2,manage:3,owner:4};
const DOC_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v15H6Z"/><path d="M14 2v6h6M9 13h8M9 17h6"/></svg>';
const SHEET_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16v18H4ZM4 9h16M4 15h16M10 3v18"/></svg>';
export const docIcon=kind=>`<span class="docs-icon ${kind==='sheet'?'is-sheet':'is-doc'}">${kind==='sheet'?SHEET_ICON:DOC_ICON}</span>`;
const DOC_MARK=/^\[(文档|表格)\] ([^\n]*)\nlinkme-doc:([a-f0-9]{32})$/;

export function createDocs({S,api,esc,av,modal,closeModal,toast,downloadURL,showDocsTab,when}){
 const $=s=>document.querySelector(s);
 let scope='recent',query='',list=null,loading=0,current=null,listTimer=0;
 const clientId='d'+Math.random().toString(36).slice(2,10)+Date.now().toString(36);
 const newId=()=>Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-6);
 const timeText=t=>t?when(t):'';

 // List ------------------------------------------------------------------------
 async function loadList(){
  const ticket=++loading;
  try{const items=await api(`/api/docs?scope=${scope}${query?'&q='+encodeURIComponent(query):''}`);if(ticket!==loading)return;list=items;if(S.tab==='docs'&&!current)drawHome()}
  catch(e){if(ticket===loading){list=[];toast(e.message);if(S.tab==='docs'&&!current)drawHome()}}
 }
 function row(d){
  const mine=d.ownerId===S.user.id;
  return `<div class="docs-row" data-open-doc="${d.id}" role="button" tabindex="0">${docIcon(d.kind)}<span class="docs-name"><b>${esc(d.title)}</b><small>${mine?'我':esc(d.ownerName||'')} · ${scope==='recent'&&d.opened?'最近打开 '+timeText(d.opened):'更新于 '+timeText(d.updated)}${d.updatedByName&&d.updatedByName!==S.user.name?' · '+esc(d.updatedByName)+' 修改':''}</small></span><span class="docs-role role-${d.role}">${ROLE_LABEL[d.role]||''}</span><button class="icon-btn docs-more" data-docs-more="${d.id}" aria-label="更多操作">⋯</button></div>`;
 }
 function drawHome(){
  const main=$('#main-content');if(!main)return;
  const items=list||[];
  main.innerHTML=`<section class="docs-home">
   <header class="docs-head"><div><h2>云文档</h2><p>多人实时协作的文档和表格，可导入导出 Word、Excel 和 Markdown</p></div>
   <div class="docs-actions"><button class="primary" data-docs="new-doc">${DOC_ICON}新建文档</button><button class="secondary" data-docs="new-sheet">${SHEET_ICON}新建表格</button><button class="secondary" data-docs="import">导入</button><input type="file" id="docs-import" hidden accept=".md,.markdown,.txt,.docx,.xlsx,.csv"></div></header>
   <div class="docs-filter"><nav class="docs-tabs" role="tablist">${[['recent','最近'],['mine','我的'],['shared','与我共享']].map(([k,l])=>`<button role="tab" aria-selected="${scope===k}" class="${scope===k?'active':''}" data-docs-scope="${k}">${l}</button>`).join('')}</nav>
   <label class="docs-search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4"/></svg><input id="docs-search" placeholder="搜索文档标题" value="${esc(query)}" maxlength="100"></label></div>
   <div class="docs-list">${list===null?'<p class="docs-empty">正在加载…</p>':items.length?items.map(row).join(''):`<div class="docs-empty"><b>${query?'没有找到相关文档':scope==='shared'?'还没有人与你共享文档':'还没有文档'}</b><p>${scope==='shared'?'别人分享给你或分享到群里的文档会出现在这里':'新建一篇文档或表格，邀请同事一起编辑'}</p></div>`}</div>
  </section>`;
  const search=$('#docs-search');search.oninput=()=>{query=search.value.trim();clearTimeout(listTimer);listTimer=setTimeout(loadList,250)};
  $('#docs-import').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)importFile(f)};
 }
 async function create(kind){try{const {id}=await api('/api/docs',{method:'POST',body:{kind,title:''}});await open(id,{fresh:true})}catch(e){toast(e.message)}}
 async function importFile(file){
  if(file.size>20*1024*1024){toast('请选择 20 MB 以内的文件');return}
  const form=new FormData();form.append('file',file);toast('正在导入 '+file.name+'…');
  try{const {id}=await api('/api/docs/import',{method:'POST',body:form});toast('导入完成');await open(id)}catch(e){toast(e.message)}
 }
 function moreMenu(id,anchor){
  const d=(list||[]).find(x=>x.id===id);if(!d)return;document.querySelector('.doc-block-menu')?.remove();
  const box=document.createElement('div');box.className='doc-block-menu';
  box.innerHTML=`<button data-docs-op="open">打开</button>${RANK[d.role]>=2?'<button data-docs-op="rename">重命名</button>':''}${d.role==='owner'?'<button data-docs-op="delete" class="danger">删除</button>':'<button data-docs-op="leave" class="danger">移出我的列表</button>'}`;
  document.body.append(box);const r=anchor.getBoundingClientRect();box.style.left=Math.min(r.left,innerWidth-170)+'px';box.style.top=Math.min(r.bottom+4,innerHeight-box.offsetHeight-8)+'px';
  box.addEventListener('mousedown',async e=>{const b=e.target.closest('[data-docs-op]');if(!b)return;e.preventDefault();box.remove();const op=b.dataset.docsOp;
   try{if(op==='open')await open(id);
    else if(op==='rename'){const t=await inputDialog('文档标题',{value:d.title,max:100});if(t!==null&&t.trim()&&t.trim()!==d.title){await api('/api/docs/'+id,{method:'PATCH',body:{title:t.trim()}});await loadList()}}
    else if(op==='delete'){if(await confirmDialog('所有协作者都将无法再打开，且无法恢复。',{title:`删除“${d.title}”`,ok:'删除',danger:true})){await api('/api/docs/'+id,{method:'DELETE'});toast('已删除');await loadList()}}
    else if(op==='leave'){if(await confirmDialog('如果是直接分享给你的，你将失去访问权限。',{title:`将“${d.title}”移出列表`,ok:'移出'})){await api(`/api/docs/${id}/members/${S.user.id}`,{method:'DELETE'});await loadList()}}}catch(err){toast(err.message)}});
  setTimeout(()=>document.addEventListener('mousedown',function off(ev){if(!box.contains(ev.target)){box.remove();document.removeEventListener('mousedown',off)}}),0);
 }

 // Live connection -----------------------------------------------------------------
 function createSync(doc){
  let version=doc.version,inflight=null,timer=0,gap=0,batch=0,closed=false,retry=0;const buffer=new Map();
  const state=s=>{const el=$('.doc-save');if(el&&current?.sync===api_){el.textContent=s;el.dataset.state=s}};
  const api_={
   schedule(delay=120){if(closed&&!doc.editor.hasPending())return;clearTimeout(timer);timer=setTimeout(flush,delay);state('保存中…')},
   receive(msg){if(msg.clientId===clientId||msg.version<=version)return;buffer.set(msg.version,msg);drain()},
   close(){closed=true;if(doc.editor.hasPending())flush()},
   get version(){return version},
  };
  async function flush(){
   if(inflight||current?.sync!==api_&&!closed)return;const ops=doc.editor.collect();if(!ops.length){if(!inflight)state('已保存');return}
   inflight={batch:String(++batch),ops};send();
  }
  async function send(){
   const sending=inflight;
   try{const r=await api(`/api/docs/${doc.id}/ops`,{method:'POST',body:{clientId,batch:sending.batch,ops:sending.ops}});retry=0;buffer.set(r.version,{...r,own:true});drain()}
   catch(e){
    if(e.name==='AbortError')return;
    if(e.status&&e.status>=400&&e.status<500&&e.status!==429){inflight=null;doc.editor.discardInflight();toast(e.message);state('未保存');if(e.status===403)refreshAccess();else resync();return}
    state('网络异常，正在重试…');setTimeout(()=>{if(inflight===sending)send()},Math.min(10000,1000*2**retry++));
   }
  }
  function drain(){
   clearTimeout(gap);
   for(const v of [...buffer.keys()])if(v<=version)buffer.delete(v);
   while(buffer.has(version+1)){const m=buffer.get(version+1);buffer.delete(version+1);version++;doc.editor.apply(m,!!m.own);if(m.own){inflight=null;state(doc.editor.hasPending()?'保存中…':'已保存');api_.schedule(30)}}
   if(buffer.size)gap=setTimeout(()=>{if(buffer.size)resync()},2500);
  }
  async function resync(){
   if(inflight){gap=setTimeout(resync,1000);return}
   try{const fresh=await api('/api/docs/'+doc.id);if(current?.sync!==api_)return;version=fresh.version;for(const v of [...buffer.keys()])if(v<=version)buffer.delete(v);doc.editor.reset(fresh.content);drain();api_.schedule(30)}catch(e){toast(e.message)}
  }
  return api_;
 }

 // Presence ------------------------------------------------------------------------------
 let presenceTimer=0,where='';
 async function presence(leave=false){
  const doc=current;if(!doc)return;
  try{const r=await api(`/api/docs/${doc.id}/presence`,{method:'POST',body:{clientId,where:leave?'':where,leave}});if(!leave&&current===doc)viewers(r.viewers)}catch{}
 }
 function viewers(list){
  if(!current)return;const others=list.filter(v=>v.clientId!==clientId);current.viewers=others;
  const seen=new Map();for(const v of others)if(!seen.has(v.userId))seen.set(v.userId,v);
  const box=$('.doc-viewers');if(box)box.innerHTML=[...seen.values()].slice(0,6).map(v=>`<span class="doc-viewer" style="--peer:${peerColor(v.userId)}" title="${esc(v.name)} 正在${current.kind==='sheet'?'查看':'编辑'}">${av({id:v.userId,name:v.name,avatar:v.avatar})}</span>`).join('')+(seen.size>6?`<span class="doc-viewer more">+${seen.size-6}</span>`:'');
  current.editor.viewers(others);
 }
 let whereTimer=0;
 function setWhere(w){where=w;clearTimeout(whereTimer);whereTimer=setTimeout(()=>presence(),150)}

 // Document page --------------------------------------------------------------------------
 async function open(id,{fresh=false}={}){
  if(S.tab!=='docs'){showDocsTab(id);return}
  closeDoc();
  const main=$('#main-content');if(main)main.innerHTML='<section class="docs-home"><p class="docs-empty">正在打开文档…</p></section>';
  let doc;try{doc=await api('/api/docs/'+id)}catch(e){toast(e.message);current=null;drawHome();loadList();return}
  if(S.tab!=='docs')return;
  current={...doc,viewers:[],fresh};drawDoc();
 }
 function drawDoc(){
  const doc=current,main=$('#main-content');if(!main||!doc)return;
  const canEdit=RANK[doc.role]>=2,manage=RANK[doc.role]>=3;
  main.innerHTML=`<section class="doc-page kind-${doc.kind}">
   <header class="doc-bar">
    <button class="icon-btn" data-docs="back" title="返回文档列表" aria-label="返回文档列表"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
    ${docIcon(doc.kind)}<div class="doc-crumb"><span class="doc-bar-title">${esc(doc.title)}</span><small class="doc-save">已保存</small></div>
    <span class="doc-role-tag role-${doc.role}">${ROLE_LABEL[doc.role]}</span>
    <div class="doc-viewers"></div>
    ${doc.aiEnabled?'<button class="secondary doc-ai-btn" data-docs="ai" title="AI 检查、整理、分析和修改">✦ AI 助手</button>':''}
    <button class="primary" data-docs="share">${manage?'分享':'协作者'}</button>
    <button class="icon-btn" data-docs="more" aria-label="更多操作" title="导出、历史版本等">⋯</button>
   </header>
   <div class="doc-main">
    ${doc.kind==='doc'?'<nav class="doc-outline" aria-label="目录"></nav>':''}
    <div class="doc-scroll">${doc.kind==='doc'?`<article class="doc-paper"><h1 class="doc-title" ${canEdit?'contenteditable="plaintext-only"':''} data-placeholder="请输入标题" spellcheck="false">${esc(doc.title)}</h1><div class="doc-info">${av(doc.owner)}<span>${esc(doc.owner.name)} 创建 · 更新于 ${timeText(doc.updated)}</span></div><div class="doc-mount"></div></article>`:'<div class="doc-mount sheet-mount"></div>'}</div>
    <aside class="doc-ai hidden" aria-label="AI 助手"></aside>
   </div></section>`;
  const mount=main.querySelector('.doc-mount');
  const options={mount,content:doc.content,editable:canEdit,newId,onChange:()=>doc.sync?.schedule(),onWhere:setWhere,toast,esc,askAI:doc.aiEnabled?ids=>openAI(ids):null};
  doc.editor=doc.kind==='sheet'?createSheetEditor(options):createDocEditor({...options,outline:main.querySelector('.doc-outline')});
  doc.sync=createSync(doc);
  const title=main.querySelector('.doc-title');
  if(title){
   title.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();doc.kind==='doc'?doc.editor.focusStart():title.blur()}});
   title.addEventListener('blur',()=>saveTitle(title.textContent));
   title.addEventListener('paste',e=>{e.preventDefault();document.execCommand('insertText',false,(e.clipboardData.getData('text/plain')||'').replace(/\s+/g,' '))});
   if(doc.fresh&&canEdit){title.textContent='';title.focus()}
  }
  presence();clearInterval(presenceTimer);presenceTimer=setInterval(()=>presence(),15000);
 }
 async function saveTitle(text){
  const doc=current;if(!doc)return;const t=text.trim()||(doc.kind==='sheet'?'未命名表格':'未命名文档');if(t===doc.title){const el=$('.doc-title');if(el&&!el.textContent.trim())el.textContent=t;return}
  try{await api('/api/docs/'+doc.id,{method:'PATCH',body:{title:t}});doc.title=t;const bar=$('.doc-bar-title');if(bar)bar.textContent=t}catch(e){toast(e.message)}
 }
 function closeDoc(){
  if(!current)return;const doc=current;current=null;clearInterval(presenceTimer);
  doc.sync?.close();doc.editor?.destroy();
  api(`/api/docs/${doc.id}/presence`,{method:'POST',body:{clientId,where:'',leave:true}}).catch(()=>{});
 }
 async function refreshAccess(){
  const doc=current;if(!doc)return;
  try{const fresh=await api('/api/docs/'+doc.id);if(current!==doc)return;
   if(fresh.role!==doc.role){const before=doc.role;doc.role=fresh.role;doc.canExport=fresh.canExport;doc.editor.setEditable(RANK[fresh.role]>=2);const tag=$('.doc-role-tag');if(tag){tag.textContent=ROLE_LABEL[fresh.role];tag.className='doc-role-tag role-'+fresh.role}toast(`你的权限已变为“${ROLE_LABEL[fresh.role]}”`);if(RANK[before]>=3!==RANK[fresh.role]>=3){const b=$('[data-docs=share]');if(b)b.textContent=RANK[fresh.role]>=3?'分享':'协作者'}}
   doc.canExport=fresh.canExport;
  }catch(e){if(current!==doc)return;toast(e.status===404?'文档已被删除':'你已没有该文档的访问权限');closeDoc();drawHome();loadList()}
 }

 // Share ------------------------------------------------------------------------------------
 async function share(){
  const doc=current;if(!doc)return;let info;
  try{info=await api(`/api/docs/${doc.id}/members`)}catch(e){toast(e.message);return}
  const manage=RANK[info.role]>=3;
  const roleSelect=(value,attrs,allowManage=true)=>`<select ${attrs} ${manage?'':'disabled'}>${['view','edit',...(allowManage?['manage']:[])].map(r=>`<option value="${r}" ${r===value?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}</select>`;
  const chats=S.conversations.filter(c=>!c.peer?.ai);
  modal('分享“'+esc(doc.title)+'”',`<div class="share">
   ${manage?`<div class="share-add"><input id="share-search" placeholder="搜索好友或群聊，添加协作者" autocomplete="off"><select id="share-role"><option value="view">可阅读</option><option value="edit" selected>可编辑</option><option value="manage">可管理</option></select></div><div id="share-results" class="share-results"></div>`:'<p class="hint">只有所有者和“可管理”的协作者可以调整权限。</p>'}
   <h5>协作者</h5><div class="share-list">
    ${info.people.map(p=>`<div class="share-person">${av(p)}<span><b>${esc(p.name)}${p.id===S.user.id?'（我）':''}</b><small>${p.number?'LinkMe 号 '+esc(p.number):''}</small></span>${p.role==='owner'?'<em>所有者</em>':roleSelect(p.role,`data-share-user="${p.id}"`)+(manage||p.id===S.user.id?`<button class="icon-btn" data-share-remove="${p.id}" title="${p.id===S.user.id?'退出协作':'移除'}" aria-label="移除">×</button>`:'')}</div>`).join('')}
    ${info.chats.map(c=>`<div class="share-person"><span class="avatar">${docIcon('doc').replace('docs-icon is-doc','docs-icon is-chat')}</span><span><b>${esc(c.name)}</b><small>群聊 · ${c.count} 人</small></span>${roleSelect(c.role,`data-share-chat="${c.id}"`,false)}${manage?`<button class="icon-btn" data-share-unchat="${c.id}" aria-label="移除">×</button>`:''}</div>`).join('')}
   </div>
   <h5>链接分享</h5>
   <div class="share-row"><select id="share-link" ${manage?'':'disabled'}><option value="none" ${!info.linkRole?'selected':''}>关闭：仅协作者可访问</option><option value="view" ${info.linkRole==='view'?'selected':''}>获得链接的 LinkMe 用户可阅读</option><option value="edit" ${info.linkRole==='edit'?'selected':''}>获得链接的 LinkMe 用户可编辑</option></select><button class="secondary" id="share-copy">复制链接</button></div>
   <label class="share-check"><input type="checkbox" id="share-export" ${info.viewerExport?'checked':''} ${manage?'':'disabled'}> 允许“可阅读”的人导出和下载</label>
   <h5>发送到聊天</h5>
   <div class="share-row"><select id="share-chat">${chats.map(c=>`<option value="${c.id}">${esc(c.name)}${c.kind==='group'?'（群）':''}</option>`).join('')}</select>${manage?`<select id="share-grant"><option value="none">仅发送</option><option value="view" selected>并授予可阅读</option><option value="edit">并授予可编辑</option></select>`:''}<button class="primary" id="share-send" ${chats.length?'':'disabled'}>发送</button></div>
  </div>`,'<button class="secondary" data-action="close-modal">完成</button>');
  const root=document.querySelector('.modal .share');if(!root)return;
  const refresh=()=>{closeModal();share()};
  const run=async(work,msg)=>{try{await work();if(msg)toast(msg);refresh()}catch(e){toast(e.message)}};
  root.addEventListener('change',e=>{const t=e.target;
   if(t.dataset.shareUser)run(()=>api(`/api/docs/${doc.id}/members/${t.dataset.shareUser}`,{method:'PUT',body:{role:t.value}}),'权限已更新');
   else if(t.dataset.shareChat)run(()=>api(`/api/docs/${doc.id}/chats/${t.dataset.shareChat}`,{method:'PUT',body:{role:t.value}}),'权限已更新');
   else if(t.id==='share-link')run(()=>api('/api/docs/'+doc.id,{method:'PATCH',body:{linkRole:t.value}}),t.value==='none'?'已关闭链接分享':'已开启链接分享');
   else if(t.id==='share-export')run(()=>api('/api/docs/'+doc.id,{method:'PATCH',body:{viewerExport:t.checked}}));
  });
  root.addEventListener('click',e=>{
   const rm=e.target.closest('[data-share-remove]');if(rm){const me=rm.dataset.shareRemove===S.user.id;(async()=>{if(me&&!await confirmDialog('退出后你将无法再打开这篇文档。',{title:'退出协作',ok:'退出',danger:true}))return;run(async()=>{await api(`/api/docs/${doc.id}/members/${rm.dataset.shareRemove}`,{method:'DELETE'});if(me){closeModal();closeDoc();drawHome();loadList();throw Object.assign(Error('已退出协作'),{quiet:true})}},'已移除')})();return}
   const un=e.target.closest('[data-share-unchat]');if(un){run(()=>api(`/api/docs/${doc.id}/chats/${un.dataset.shareUnchat}`,{method:'DELETE'}),'已移除');return}
   const add=e.target.closest('[data-share-add]');if(add){const role=$('#share-role').value;const [kind,id]=add.dataset.shareAdd.split(':');run(()=>kind==='user'?api(`/api/docs/${doc.id}/members/${id}`,{method:'PUT',body:{role}}):api(`/api/docs/${doc.id}/chats/${id}`,{method:'PUT',body:{role:role==='manage'?'edit':role}}),'已添加协作者');return}
   if(e.target.id==='share-copy'){const text=`[${doc.kind==='sheet'?'表格':'文档'}] ${doc.title}\nlinkme-doc:${doc.id}`;navigator.clipboard?.writeText(text).then(()=>toast(info.linkRole?'已复制，粘贴到聊天里即可打开':'已复制。链接分享已关闭，只有协作者能打开'),()=>toast('复制失败'));return}
   if(e.target.id==='share-send'){const cid=$('#share-chat').value,grant=$('#share-grant')?.value||'none';run(()=>api(`/api/docs/${doc.id}/send`,{method:'POST',body:{conversationId:cid,grant,clientId:'doc-'+newId()+newId()}}),'已发送到聊天')}
  });
  const search=$('#share-search');
  if(search)search.addEventListener('input',()=>{
   const q=search.value.trim().toLowerCase(),out=$('#share-results');if(!q){out.innerHTML='';return}
   const have=new Set(info.people.map(p=>p.id)),haveChats=new Set(info.chats.map(c=>c.id));
   const people=(S.friends||[]).filter(f=>!have.has(f.id)&&((f.name||'').toLowerCase().includes(q)||String(f.number||'').includes(q))).slice(0,8);
   const groups=S.conversations.filter(c=>c.kind==='group'&&!haveChats.has(c.id)&&c.name.toLowerCase().includes(q)).slice(0,5);
   out.innerHTML=[...people.map(p=>`<button data-share-add="user:${p.id}">${av(p)}<span>${esc(p.name)}</span><small>${p.number?'LinkMe 号 '+esc(p.number):'好友'}</small></button>`),...groups.map(g=>`<button data-share-add="chat:${g.id}"><span class="avatar">#</span><span>${esc(g.name)}</span><small>群聊 · 成员都能访问</small></button>`)].join('')||'<p class="hint">没有匹配的好友或群聊</p>';
  });
 }

 // History -----------------------------------------------------------------------------------
 async function history(){
  const doc=current;if(!doc)return;let versions;try{versions=await api(`/api/docs/${doc.id}/versions`)}catch(e){toast(e.message);return}
  modal('历史版本',`<div class="doc-history"><div class="doc-history-list">${versions.length?versions.map(v=>`<button data-version="${v.id}"><b>${new Date(v.created).toLocaleString('zh-CN',{hour12:false})}</b><small>${esc(v.authorName||'')} 编辑前的内容 · ${esc(v.title)}</small></button>`).join(''):'<p class="hint">编辑一段时间后会自动保存历史版本（每 5 分钟最多一个）。</p>'}</div><div class="doc-history-view"><p class="hint">选择左侧的版本查看内容</p></div></div>`,'<button class="secondary" data-action="close-modal">关闭</button>',true);
  const box=document.querySelector('.doc-history');if(!box)return;
  box.addEventListener('click',async e=>{
   const b=e.target.closest('[data-version]');
   if(b){box.querySelectorAll('[data-version]').forEach(x=>x.classList.toggle('active',x===b));const view=box.querySelector('.doc-history-view');view.innerHTML='<p class="hint">正在加载…</p>';
    try{const v=await api(`/api/docs/${doc.id}/versions/${b.dataset.version}`);view.innerHTML=`<div class="doc-history-head"><b>${esc(v.title)}</b>${RANK[doc.role]>=2?`<button class="primary" data-restore="${b.dataset.version}">恢复此版本</button>`:''}</div><div class="doc-history-body">${previewHTML(doc.kind,v.content)}</div>`}catch(err){view.innerHTML=`<p class="hint">${esc(err.message)}</p>`}return}
   const r=e.target.closest('[data-restore]');
   if(r&&await confirmDialog('当前内容会先存为一个历史版本，可以再恢复回来。',{title:'恢复到这个版本',ok:'恢复'})){try{await api(`/api/docs/${doc.id}/versions/${r.dataset.restore}/restore`,{method:'POST',body:{}});closeModal();toast('已恢复到所选版本');await reopen()}catch(err){toast(err.message)}}
  });
 }
 function previewHTML(kind,content){
  if(kind==='sheet'){const p=content.sheets?.[0];if(!p)return '';const refs=Object.keys(p.cells||{});let mr=0,mc=0;for(const r of refs){const m=/^([A-Z]+)(\d+)$/.exec(r);if(m){let c=0;for(const ch of m[1])c=c*26+ch.charCodeAt(0)-64;mr=Math.max(mr,+m[2]);mc=Math.max(mc,c)}}mr=Math.min(mr,60);mc=Math.min(mc,15);
   const col=n=>{let s='';while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s};
   return `<p class="hint">${esc(p.name)}${content.sheets.length>1?` 等 ${content.sheets.length} 个工作表`:''}</p><table class="doc-preview-table">${Array.from({length:mr},(_,r)=>'<tr>'+Array.from({length:mc},(_,c)=>`<td>${esc(p.cells[col(c+1)+(r+1)]?.v||'')}</td>`).join('')+'</tr>').join('')}</table>`}
  let n=0;return (content.blocks||[]).map(b=>{n=b.type==='ordered'?n+1:0;const t=toHTML(b.text||'');switch(b.type){case 'h1':return `<h2>${t}</h2>`;case 'h2':return `<h3>${t}</h3>`;case 'h3':return `<h4>${t}</h4>`;case 'bullet':return `<p>• ${t}</p>`;case 'ordered':return `<p>${n}. ${t}</p>`;case 'todo':return `<p>${b.checked?'☑':'☐'} ${t}</p>`;case 'quote':return `<blockquote>${t}</blockquote>`;case 'code':return `<pre>${esc(b.text||'')}</pre>`;case 'divider':return '<hr>';case 'table':return `<table class="doc-preview-table">${(b.rows||[]).map(r=>'<tr>'+r.map(c=>`<td>${esc(c)}</td>`).join('')+'</tr>').join('')}</table>`;default:return `<p>${t||'&nbsp;'}</p>`}}).join('');
 }
 async function reopen(){const id=current?.id;if(id){closeDoc();await open(id)}}

 function more(anchor){
  const doc=current;if(!doc)return;document.querySelector('.doc-block-menu')?.remove();
  const box=document.createElement('div');box.className='doc-block-menu';
  const exports=doc.kind==='sheet'?[['xlsx','导出为 Excel (.xlsx)'],['csv','导出当前工作表为 CSV']]:[['docx','导出为 Word (.docx)'],['md','导出为 Markdown (.md)']];
  box.innerHTML=(doc.canExport?exports.map(([f,l])=>`<button data-doc-more="export:${f}">${l}</button>`).join(''):'<p class="hint">所有者已禁止导出</p>')+`<button data-doc-more="history">历史版本</button><button data-doc-more="copy">复制文档链接</button>${doc.role==='owner'?'<button data-doc-more="delete" class="danger">删除文档</button>':''}`;
  document.body.append(box);const r=anchor.getBoundingClientRect();box.style.left=Math.max(8,Math.min(r.right-200,innerWidth-210))+'px';box.style.top=(r.bottom+4)+'px';
  box.addEventListener('mousedown',async e=>{const b=e.target.closest('[data-doc-more]');if(!b)return;e.preventDefault();box.remove();const [op,arg]=b.dataset.docMore.split(':');
   if(op==='export'){if(doc.editor.hasPending())doc.sync.schedule(0);const sheet=doc.kind==='sheet'&&arg==='csv'?'&sheet='+encodeURIComponent(doc.editor.activeSheet()):'';setTimeout(()=>downloadURL(`/api/docs/${doc.id}/export?format=${arg}${sheet}`,doc.title+'.'+arg),doc.editor.hasPending()?800:0)}
   else if(op==='history')history();
   else if(op==='copy'){navigator.clipboard?.writeText(`[${doc.kind==='sheet'?'表格':'文档'}] ${doc.title}\nlinkme-doc:${doc.id}`).then(()=>toast('已复制，粘贴到聊天发送即可'),()=>toast('复制失败'))}
   else if(op==='delete'){if(await confirmDialog('所有协作者都将无法再打开，且无法恢复。',{title:`删除“${doc.title}”`,ok:'删除',danger:true})){try{await api('/api/docs/'+doc.id,{method:'DELETE'});closeDoc();toast('已删除');drawHome();loadList()}catch(err){toast(err.message)}}}});
  setTimeout(()=>document.addEventListener('mousedown',function off(ev){if(!box.contains(ev.target)){box.remove();document.removeEventListener('mousedown',off)}}),0);
 }

 // AI assistant ------------------------------------------------------------------------------
 let aiScope=[],aiBusy=false;
 function openAI(ids){
  const doc=current;if(!doc)return;const panel=$('.doc-ai');if(!panel)return;
  if(Array.isArray(ids))aiScope=ids.filter(Boolean);
  panel.classList.remove('hidden');$('.doc-page')?.classList.add('ai-open');
  if(!panel.dataset.ready){panel.dataset.ready='1';
   panel.innerHTML=`<header><b>✦ AI 助手</b><button class="icon-btn" data-ai-close aria-label="关闭 AI 助手">×</button></header>
    <div class="ai-quick"><button data-ai-mode="check">检查错误</button><button data-ai-mode="tidy">整理排版</button><button data-ai-mode="summary">总结分析</button></div>
    <div class="ai-scope"></div><div class="ai-results"><p class="hint">AI 会阅读${doc.kind==='sheet'?'表格（含公式计算结果）':'文档'}，找出问题并给出修改建议。建议不会自动写入，你确认后点“应用”才会修改，所有协作者实时看到，也可以在历史版本里恢复。</p></div>
    <form class="ai-ask"><textarea rows="3" maxlength="2000" placeholder="${doc.kind==='sheet'?'例如：给每一行加一列合计；找出销售额异常的月份':'例如：把这段改得更正式；补一段项目背景；翻译成英文'}"></textarea><button class="primary" type="submit">发送</button></form>`;
   panel.addEventListener('click',aiClick);
   panel.querySelector('.ai-ask').addEventListener('submit',e=>{e.preventDefault();const t=panel.querySelector('.ai-ask textarea');if(t.value.trim())runAI('ask',t.value.trim())});
   panel.querySelector('.ai-ask textarea').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();panel.querySelector('.ai-ask').requestSubmit()}});
  }
  drawScope();
 }
 function drawScope(){
  const doc=current,box=$('.doc-ai .ai-scope');if(!box||!doc)return;
  if(doc.kind==='sheet'){box.innerHTML=`范围：整个表格，当前选中 <b>${esc(doc.editor.selection())}</b>`;return}
  box.innerHTML=aiScope.length?`范围：选中的 <b>${aiScope.length}</b> 段 <button data-ai-scope-clear>改为全文</button>`:'范围：全文（选中文字后点工具条上的 ✦ AI 可只处理选中部分）';
 }
 async function runAI(mode,instruction=''){
  const doc=current;if(!doc||aiBusy)return;aiBusy=true;const panel=$('.doc-ai'),out=panel.querySelector('.ai-results');
  panel.querySelectorAll('.ai-quick button,.ai-ask button').forEach(b=>b.disabled=true);
  out.innerHTML=`<div class="ai-loading"><span></span>${{check:'正在检查错误',tidy:'正在整理排版',summary:'正在总结分析',ask:'正在处理你的要求'}[mode]}…</div>`;
  try{
   if(doc.editor.hasPending())doc.sync.schedule(0);
   const body={mode,instruction};
   if(doc.kind==='sheet'){body.range=doc.editor.selection();body.values=doc.editor.values()}else body.selection=aiScope;
   await new Promise(r=>setTimeout(r,doc.editor.hasPending()?600:0));
   const r=await api(`/api/docs/${doc.id}/ai`,{method:'POST',body});if(current!==doc)return;
   doc.aiEdits=r.edits.map((e,i)=>({...e,_i:i}));doc.aiCanApply=r.canApply;doc.aiReply=r.reply;drawAI();
   if(mode==='ask')panel.querySelector('.ai-ask textarea').value='';
  }catch(e){out.innerHTML=`<p class="ai-error">${esc(e.message)}</p>`}
  finally{aiBusy=false;panel.querySelectorAll('.ai-quick button,.ai-ask button').forEach(b=>b.disabled=false)}
 }
 function editHTML(e){
  const doc=current;let body='';
  if(e.op==='cell')body=`<div class="ai-cell"><code>${esc(e.sheet||'')}!${esc(e.ref||'')}</code>${e.original?`<del>${esc(e.original)}</del>`:''}<ins>${esc(e.v??'')}</ins></div>`;
  else if(e.op==='replace'){const cur=doc.editor.blocks().find(b=>b.id===e.id);body=`${e.original?`<del>${esc(e.original)}</del>`:cur?`<del>${esc(plain(cur.text))}</del>`:''}<ins>${toHTML(e.text||'')}</ins>`}
  else if(e.op==='insert')body=`<div class="ai-new">${(e.blocks||[]).map(b=>`<ins>${toHTML(b.text||'')}</ins>`).join('')}</div>`;
  else if(e.op==='delete'){const cur=doc.editor.blocks().find(b=>b.id===e.id);body=`<del>${esc(cur?plain(cur.text):'该段')}</del>`}
  const label={replace:'修改',insert:'新增',delete:'删除',cell:'单元格'}[e.op]||e.op;
  return `<div class="ai-edit${e.done?' done':''}" data-edit="${e._i}"><div class="ai-edit-head"><span class="tag">${label}</span>${e.reason?`<span>${esc(e.reason)}</span>`:''}</div>${body}${doc.aiCanApply?`<div class="ai-edit-actions">${e.done?`<span class="ok">${e.done==='applied'?'已应用':'已忽略'}</span>`:`<button class="primary" data-ai-apply="${e._i}">应用</button><button class="secondary" data-ai-skip="${e._i}">忽略</button>`}${e.op!=='cell'&&e.id?`<button class="link" data-ai-goto="${esc(e.id)}">定位</button>`:''}</div>`:''}</div>`;
 }
 function drawAI(){
  const doc=current,out=$('.doc-ai .ai-results');if(!out||!doc)return;const edits=doc.aiEdits||[];const open=edits.filter(e=>!e.done);
  out.innerHTML=`${doc.aiReply?`<div class="ai-reply">${replyHTML(doc.aiReply)}<div class="ai-reply-actions"><button class="link" data-ai-copy>复制</button>${doc.kind==='doc'&&RANK[doc.role]>=2?'<button class="link" data-ai-insert>插入到文档</button>':''}</div></div>`:''}
   ${edits.length?`<div class="ai-edits-head"><b>${edits.length} 条修改建议</b>${doc.aiCanApply&&open.length>1?'<button class="primary" data-ai-all>全部应用</button>':''}</div>${edits.map(editHTML).join('')}`:doc.aiReply?'':'<p class="hint">没有需要修改的地方。</p>'}
   ${!doc.aiCanApply&&edits.length?'<p class="hint">你只有阅读权限，可以把建议告诉文档的编辑者。</p>':''}`;
 }
 function applyOne(e){if(e.done)return true;const ok=current.editor.applyEdit(e);if(ok)e.done='applied';return ok}
 function aiClick(ev){
  const doc=current;if(!doc)return;const t=ev.target;
  if(t.closest('[data-ai-close]')){$('.doc-ai').classList.add('hidden');$('.doc-page')?.classList.remove('ai-open');return}
  const mode=t.closest('[data-ai-mode]');if(mode){runAI(mode.dataset.aiMode);return}
  if(t.closest('[data-ai-scope-clear]')){aiScope=[];drawScope();return}
  const a=t.closest('[data-ai-apply]');if(a){const e=doc.aiEdits[+a.dataset.aiApply];if(!applyOne(e))toast('这处内容已被修改或删除，无法应用');drawAI();return}
  const s=t.closest('[data-ai-skip]');if(s){doc.aiEdits[+s.dataset.aiSkip].done='skipped';drawAI();return}
  if(t.closest('[data-ai-all]')){let failed=0;for(const e of doc.aiEdits)if(!e.done&&!applyOne(e))failed++;if(failed)toast(`${failed} 条建议对应的内容已变化，未应用`);drawAI();return}
  const g=t.closest('[data-ai-goto]');if(g){doc.editor.scrollTo?.(g.dataset.aiGoto);return}
  if(t.closest('[data-ai-copy]')){navigator.clipboard?.writeText(doc.aiReply||'').then(()=>toast('已复制'),()=>toast('复制失败'));return}
  if(t.closest('[data-ai-insert]')){doc.editor.insertMarkdown(doc.aiReply||'');toast('已插入到文档')}
 }

 // Global wiring ------------------------------------------------------------------------------
 document.addEventListener('click',e=>{
  const more_=e.target.closest('[data-docs-more]');if(more_){e.preventDefault();e.stopPropagation();moreMenu(more_.dataset.docsMore,more_);return}
  const opener=e.target.closest('[data-open-doc]');if(opener){e.preventDefault();open(opener.dataset.openDoc);return}
  const scopeBtn=e.target.closest('[data-docs-scope]');if(scopeBtn){scope=scopeBtn.dataset.docsScope;list=null;drawHome();loadList();return}
  const b=e.target.closest('[data-docs]');if(!b)return;
  switch(b.dataset.docs){
   case 'new-doc':create('doc');break;case 'new-sheet':create('sheet');break;
   case 'import':$('#docs-import')?.click();break;
   case 'back':closeDoc();drawHome();loadList();break;
   case 'share':share();break;case 'more':more(b);break;
   case 'ai':{const panel=$('.doc-ai');if(panel&&!panel.classList.contains('hidden')){panel.classList.add('hidden');$('.doc-page')?.classList.remove('ai-open')}else openAI(current?.kind==='doc'?current.editor.selectedIds():undefined);break}
  }
 });
 document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches?.('.docs-row[data-open-doc]'))open(e.target.dataset.openDoc)});
 window.addEventListener('beforeunload',()=>{if(current)closeDoc()});

 return {
  render(){if(current&&$('.doc-page')){return}if(current){drawDoc();return}drawHome();loadList()},
  open,
  leave(){closeDoc()},
  isOpen:()=>!!current,
  event(type,d){
   if(type==='doc-ops'){if(current&&d.docId===current.id)current.sync.receive(d);else if(S.tab==='docs'&&!current){clearTimeout(listTimer);listTimer=setTimeout(loadList,800)}return}
   if(type==='doc-presence'){if(current&&d.docId===current.id)viewers(d.viewers||[]);return}
   if(type==='doc-meta'){if(current&&d.docId===current.id){current.title=d.title;const bar=$('.doc-bar-title');if(bar)bar.textContent=d.title;const t=$('.doc-title');if(t&&document.activeElement!==t)t.textContent=d.title}else if(S.tab==='docs')loadList();return}
   if(type==='doc-access'){if(current&&d.docId===current.id){if(d.deleted){toast('文档已被所有者删除');closeDoc();drawHome();loadList()}else refreshAccess()}else if(S.tab==='docs'&&!current)loadList();return}
   if(type==='doc-reload'){if(current&&d.docId===current.id){toast('文档已恢复到历史版本');reopen()}}
  },
  // A document shared in a chat shows as a card.
  card(m){if(m.kind!=='text')return '';const x=DOC_MARK.exec(m.text||'');if(!x)return '';return `<button class="file-card doc-card" data-open-doc="${x[3]}">${docIcon(x[1]==='表格'?'sheet':'doc')}<span><b>${esc(x[2])}</b><small>LinkMe 云${x[1]} · 点击打开</small></span></button>`},
  preview(text){const x=DOC_MARK.exec(text||'');return x?`[${x[1]}] ${x[2]}`:null},
  reset(){closeDoc();list=null;scope='recent';query=''},
 };
}
