export function createMentions({S,api,esc,av,toast,jump}) {
 const $=s=>document.querySelector(s),drafts=new Map();
 let popup=null,revision=0,pending=null,cache=null;
 const group=()=>S.conversations.find(c=>c.id===S.active)?.kind==='group';
 const input=()=>$('#composer');
 function state(){const cid=S.active,text=input()?.value||'';if(!drafts.has(cid))drafts.set(cid,{text,spans:[]});return drafts.get(cid)}
 function reconcile(){const d=state(),text=input()?.value||'';if(text===d.text)return d;
  let left=0;while(left<text.length&&left<d.text.length&&text[left]===d.text[left])left++;
  let oldEnd=d.text.length,newEnd=text.length;while(oldEnd>left&&newEnd>left&&d.text[oldEnd-1]===text[newEnd-1]){oldEnd--;newEnd--}
  const delta=newEnd-oldEnd;
  d.spans=d.spans.reduce((kept,m)=>{if(m.end<=left)kept.push(m);else if(m.start>=oldEnd)kept.push({...m,start:m.start+delta,end:m.end+delta});return kept},[]);d.text=text;return d;
 }
 function hide(){revision++;popup=null;$('#mention-picker')?.remove();input()?.setAttribute('aria-expanded','false');input()?.removeAttribute('aria-activedescendant')}
 async function members(){if(cache?.cid===S.active&&Date.now()-cache.at<10000)return cache.value;const cid=S.active,value=await api('/api/conversations/'+cid);if(cid===S.active)cache={cid,at:Date.now(),value};return value}
 function render(){const p=popup;if(!p)return;$('#mention-picker')?.remove();const node=document.createElement('div');node.id='mention-picker';node.className='mention-picker';node.setAttribute('role','listbox');node.setAttribute('aria-label','选择要提醒的成员');
  node.innerHTML='<div class="mention-picker-title">选择要提醒的成员</div>'+p.items.map((u,i)=>`<button type="button" id="mention-option-${i}" role="option" aria-selected="${i===p.index}" data-mention-index="${i}" class="${i===p.index?'selected':''}">${u.id==='all'?'<span class="mention-all-avatar">@</span>':av(u)}<span><b>${esc(u.nickname||u.name)}</b><small>${u.id==='all'?'提醒群内所有成员':esc(u.number)}</small></span></button>`).join('')+(p.items.length?'':'<p class="hint">没有找到成员</p>');
  node.onpointerdown=e=>e.preventDefault();node.onclick=e=>{const b=e.target.closest('[data-mention-index]');if(b)choose(p.items[Number(b.dataset.mentionIndex)])};$('.composer')?.append(node);input()?.setAttribute('aria-expanded','true');if(p.items.length){input()?.setAttribute('aria-activedescendant','mention-option-'+p.index);node.querySelector('.selected')?.scrollIntoView({block:'nearest'})}
 }
 async function show(start,end,query='') {if(!group()||input()?.disabled)return;const request=++revision,cid=S.active;
  try{const c=await members();if(request!==revision||cid!==S.active||!input())return;const q=query.toLocaleLowerCase();const all=c.group?.role==='owner'||c.group?.role==='admin';let users=c.members.filter(u=>u.id!==S.user.id);if(all)users.unshift({id:'all',name:'全体成员'});users=users.filter(u=>[u.name,u.nickname,u.number].some(v=>(v||'').toLocaleLowerCase().includes(q)));popup={start,end,items:users,index:0};render()}catch(e){if(request===revision){hide();toast(e.message)}}
 }
 function changed(){reconcile();if(!group()||input()?.disabled){hide();return}const el=input(),caret=el.selectionStart;if(caret!==el.selectionEnd){hide();return}const d=state();if(d.spans.some(m=>m.start<caret&&m.end>=caret)){hide();return}const match=el.value.slice(0,caret).match(/@([^@\s]{0,32})$/u);if(match)show(caret-match[0].length,caret,match[1]);else hide()}
 function choose(user){const el=input(),p=popup;if(!el||!p||!user)return;const label='@'+(user.nickname||user.name),start=p.start,end=p.end;el.value=el.value.slice(0,start)+label+' '+el.value.slice(end);reconcile();state().spans.push({userId:user.id,start,end:start+label.length});state().spans.sort((a,b)=>a.start-b.start);hide();el.focus();el.setSelectionRange(start+label.length+1,start+label.length+1);el.oninput?.();hide()}
 function key(e){if(!popup||e.isComposing)return false;if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();if(popup.items.length)popup.index=(popup.index+(e.key==='ArrowDown'?1:-1)+popup.items.length)%popup.items.length;render();return true}if(e.key==='Enter'){e.preventDefault();choose(popup.items[popup.index]);return true}if(e.key==='Escape'){e.preventDefault();hide();return true}return false}
 function open(){const el=input();if(!el||el.disabled)return;show(el.selectionStart,el.selectionEnd)}
 async function mentionUser(id){try{const c=await members(),u=c.members.find(u=>u.id===id);if(!u)throw Error('该成员已离开群聊');const el=input();if(!el||el.disabled)return;popup={start:el.selectionStart,end:el.selectionEnd,items:[u],index:0};choose(u)}catch(e){toast(e.message)}}
 function text(m){if(!m.mentions?.length)return esc(m.text);let at=0,out='';for(const span of m.mentions){if(span.start<at||span.end>m.text.length)continue;out+=esc(m.text.slice(at,span.start))+`<span class="message-mention">${esc(m.text.slice(span.start,span.end))}</span>`;at=span.end}return out+esc(m.text.slice(at))}
 function applies(m){return m.sender!==S.user?.id&&!m.recalled&&(m.mentionRecipients||[]).includes(S.user?.id)}
 function mount(){hide();reconcile();const el=input();el?.setAttribute('aria-controls','mention-picker');el?.addEventListener('compositionend',()=>changed());const target=$('#mention-jump');if(target&&pending?.cid===S.active){target.innerHTML='<button data-mention="jump">有人 @我 · 查看消息 ↑</button>'} }
 function select(cid){hide();cache=null;const c=S.conversations.find(x=>x.id===cid);pending=c?.firstMentionId?{cid,id:c.firstMentionId}:null}
 function clear(cid){drafts.delete(cid);hide()}
 function reset(){drafts.clear();pending=null;cache=null;hide()}
 function invalidated(id){if(pending?.id===id){pending=null;$('#mention-jump')?.replaceChildren()}}
 document.addEventListener('click',e=>{const b=e.target.closest('[data-mention],[data-mention-user]');if(b){if(b.dataset.mention==='open')open();if(b.dataset.mentionUser)mentionUser(b.dataset.mentionUser);if(b.dataset.mention==='jump'&&pending){const p=pending;pending=null;$('#mention-jump')?.replaceChildren();jump(p.cid,p.id).catch(e=>toast(e.message))}}else if(!e.target.closest('#mention-picker,#composer'))hide()});
 return {restore:(cid,text,spans=[])=>drafts.set(cid,{text,spans:spans.map(m=>({...m}))}),changed,key,mount,select,clear,reset,invalidated,text,applies,failed:()=>{cache=null},payload:()=>reconcile().spans,tool:()=>group()?'<button type="button" class="icon-btn mention-tool" title="@成员" aria-label="@成员" data-mention="open">@</button>':'',menu:m=>group()&&m.sender!==S.user.id?`<button data-mention-user="${m.sender}">@TA</button>`:''};
}
