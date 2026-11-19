// Read receipts on your own messages, as in Feishu: 未读 / 已读 in a direct
// chat, "N 人未读" / 全部已读 in a group, with the list of who has and has
// not read a message one click away. The server keeps how far each member has
// read; "read" events move those positions forward live.
export function createReceipts({S,api,esc,av,modal}) {
 const $=s=>document.querySelector(s);
 let state={cid:'',members:new Map()},loading=0,frame=0;
 const conversation=cid=>S.conversations.find(c=>c.id===cid);
 const applies=cid=>{const c=conversation(cid);return !!c&&!c.peer?.ai};
 // Members who were in the conversation when the message was sent.
 function audience(m){if(state.cid!==m.conversationId||!m.seq)return null;return [...state.members.values()].filter(x=>x.joined<m.seq)}
 function counts(m){const people=audience(m);if(!people?.length)return null;const unread=people.filter(x=>x.seq<m.seq);return {people,unread,read:people.filter(x=>x.seq>=m.seq)}}
 function text(m){const c=counts(m);if(!c)return null;const direct=conversation(m.conversationId)?.kind==='direct';
  if(direct)return {label:c.unread.length?'未读':'已读',done:!c.unread.length};
  return {label:c.unread.length?`${c.unread.length} 人未读`:'全部已读',done:!c.unread.length};
 }
 // label is placed in the message's time line; paint keeps it current.
 function label(m){if(m.sender!==S.user?.id||m.recalled||!m.seq)return '';const t=text(m);
  const group=conversation(m.conversationId)?.kind==='group';
  return `<button type="button" class="receipt${t?.done?' done':''}${t?'':' hidden'}" data-receipt="${esc(m.id)}" data-seq="${m.seq}" ${group?'':'tabindex="-1"'}>${t?esc(t.label):''}</button>`;
 }
 function paint(){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
  for(const node of document.querySelectorAll('#messages .receipt[data-receipt]')){const m=S.messages.find(x=>x.id===node.dataset.receipt);if(!m)continue;const t=text(m);
   node.classList.toggle('hidden',!t);node.classList.toggle('done',!!t?.done);if(t&&node.textContent!==t.label)node.textContent=t.label}
 })}
 async function load(cid=S.active){
  if(!cid||!applies(cid)){if(state.cid!==cid)state={cid:'',members:new Map()};return}
  const ticket=++loading;
  try{const list=await api('/api/conversations/'+cid+'/reads');if(ticket!==loading||S.active!==cid)return;state={cid,members:new Map(list.map(x=>[x.userId,x]))};paint()}catch{}
 }
 function event(d){if(!d||d.conversationId!==state.cid)return;const member=state.members.get(d.userId);if(!member){if(d.userId!==S.user?.id)load(state.cid);return}if(d.seq>member.seq){member.seq=d.seq;paint()}}
 function row(x){return `<div class="receipt-person">${av({id:x.userId,name:x.name,avatar:x.avatar})}<span>${esc(x.name)}</span></div>`}
 function open(id){const m=S.messages.find(x=>x.id===id);if(!m||conversation(m.conversationId)?.kind!=='group')return;const c=counts(m);if(!c)return;
  const column=(title,people,empty)=>`<section><h4>${title} · ${people.length}</h4>${people.length?people.map(row).join(''):`<p class="hint">${empty}</p>`}</section>`;
  modal('消息接收人',`<div class="receipt-lists">${column('未读',c.unread,'全部已读')}${column('已读',c.read,'暂时还没有人读')}</div>`,'<button class="primary" data-action="close-modal">知道了</button>');
 }
 document.addEventListener('click',e=>{const b=e.target.closest('#messages .receipt[data-receipt]');if(b){e.preventDefault();open(b.dataset.receipt)}});
 return {label,load,event,paint,reset(){loading++;state={cid:'',members:new Map()}}};
}
