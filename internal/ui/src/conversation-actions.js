import {bindLongPress} from './long-press.js';
export function createConversationActions({S,api,modal,closeModal,toast,esc,icon,contextMenu,refresh}) {
 const find=id=>S.conversations.find(c=>c.id===id);
 function menu(id,x,y){const c=find(id);if(!c)return;contextMenu(x,y,`${c.kind==='direct'?'<button data-create-group-user="'+c.peer.id+'">创建群聊</button>':''}<button data-conversation-action="pin" data-cid="${id}">${icon('pin')}${c.pinned?'取消置顶':'置顶聊天'}</button><button data-conversation-action="mute" data-cid="${id}">${icon('mute')}${c.muted?'开启消息提醒':'消息免打扰'}</button>${c.unread?`<button data-conversation-action="read" data-cid="${id}">${icon('check')}标为已读</button>`:''}<button class="destructive" data-conversation-action="remove" data-cid="${id}">${icon('trash')}从消息列表移除</button>`)}
 const removing=new Set();
 async function remove(id){if(!find(id)||removing.has(id))return;removing.add(id);try{await api('/api/conversations/'+id,{method:'DELETE'});closeModal();await refresh()}catch(error){toast(error.message)}finally{removing.delete(id)}}
 document.addEventListener('click',async event=>{const button=event.target.closest('[data-conversation-menu],[data-conversation-action]');if(!button||!S.user)return;if(button.dataset.conversationMenu){const r=button.getBoundingClientRect();menu(button.dataset.conversationMenu,r.right-180,r.bottom);return}const id=button.dataset.cid,c=find(id);if(!c)return;try{const action=button.dataset.conversationAction;if(action==='remove'){remove(id);return}button.disabled=true;if(action==='read')await api('/api/conversations/'+id+'/read',{method:'POST',body:{}});else await api('/api/conversations/'+id,{method:'PATCH',body:action==='pin'?{pinned:!c.pinned}:{muted:!c.muted}});await refresh()}catch(error){toast(error.message)}finally{button.disabled=false}});
 document.addEventListener('contextmenu',event=>{const row=event.target.closest('[data-conversation]');if(row){event.preventDefault();menu(row.dataset.conversation,event.clientX,event.clientY)}});
 bindLongPress('[data-conversation]',(row,x,y)=>menu(row.dataset.conversation,x,y));
 return {menu,remove};
}
