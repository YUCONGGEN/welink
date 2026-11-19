// One search over contacts, group chats, chat history and documents, as in
// DingTalk and Feishu. Ctrl+K anywhere, or Enter in the sidebar search box.
export function createGlobalSearch({S,api,esc,av,icon,modal,closeModal,toast,openMessage,openChat,startChat,Docs,preview,whenText}){
 const $=s=>document.querySelector(s);
 let ticket=0,timer=0;
 const mark=(text,q)=>{const t=esc(text);if(!q)return t;const i=t.toLowerCase().indexOf(esc(q).toLowerCase());return i<0?t:t.slice(0,i)+'<mark>'+t.slice(i,i+esc(q).length)+'</mark>'+t.slice(i+esc(q).length)};
 function open(query=''){
  modal('搜索',`<div class="global-search"><label class="docs-search">${icon('search')}<input id="global-q" placeholder="搜索联系人、群聊、聊天记录、文档" maxlength="100" value="${esc(query)}" autocomplete="off"></label><div id="global-results" class="global-results"><p class="hint">输入关键词开始搜索 · Ctrl + K 随时打开</p></div></div>`,'<button class="secondary" data-action="close-modal">关闭</button>',true);
  const input=$('#global-q');input.focus();input.setSelectionRange(input.value.length,input.value.length);
  input.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>run(input.value.trim()),250)};
  if(query)run(query);
 }
 async function run(q){
  const box=$('#global-results');if(!box)return;if(!q){box.innerHTML='<p class="hint">输入关键词开始搜索</p>';return}
  const t=++ticket;box.innerHTML='<p class="hint">正在搜索…</p>';
  let r;try{r=await api('/api/search?q='+encodeURIComponent(q))}catch(e){if(t===ticket)box.innerHTML=`<p class="hint">${esc(e.message)}</p>`;return}
  if(t!==ticket||!$('#global-results'))return;
  const section=(title,items)=>items.length?`<h5>${title}</h5>${items.join('')}`:'';
  const html=section('联系人',r.contacts.map(c=>`<button class="search-hit" data-hit-user="${c.id}" data-cid="${c.conversationId||''}">${av(c)}<span><b>${mark(c.name,q)}</b><small>LinkMe 号 ${esc(c.number)}</small></span></button>`))+
   section('群聊',r.chats.map(c=>`<button class="search-hit" data-hit-chat="${c.id}"><span class="avatar">${icon('contacts')}</span><span><b>${mark(c.name,q)}</b><small>${c.count} 人</small></span></button>`))+
   section('聊天记录',r.messages.map(m=>`<button class="search-hit" data-hit-message="${m.id}" data-cid="${m.conversationId}">${av({id:m.sender,name:m.name,avatar:m.avatar})}<span><b>${esc(m.conversationName)} · ${esc(m.name)}</b><small>${mark(preview(m),q)} · ${whenText(m.created)}</small></span></button>`))+
   section('云文档',r.docs.map(d=>`<button class="search-hit" data-hit-doc="${d.id}"><span class="docs-icon ${d.kind==='sheet'?'is-sheet':'is-doc'}">${icon('doc')}</span><span><b>${mark(d.title,q)}</b><small>${esc(d.ownerName)} · ${whenText(d.updated)}</small></span></button>`));
  box.innerHTML=html||'<p class="hint">没有找到相关内容</p>';
 }
 document.addEventListener('click',e=>{
  const b=e.target.closest('.search-hit');if(!b)return;closeModal();
  if(b.dataset.hitUser){if(b.dataset.cid)openChat(b.dataset.cid);else startChat(b.dataset.hitUser)}
  else if(b.dataset.hitChat)openChat(b.dataset.hitChat);
  else if(b.dataset.hitMessage)openMessage(b.dataset.cid,b.dataset.hitMessage);
  else if(b.dataset.hitDoc)Docs.open(b.dataset.hitDoc);
 });
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==='k'&&S.user){e.preventDefault();open(window.getSelection()?.toString().trim().slice(0,100)||'')}});
 return {open};
}
