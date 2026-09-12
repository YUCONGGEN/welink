import {bindLongPress} from './long-press.js';
export function createDirectorySearch({S,api,esc,av,icon,renderSidebar,contextMenu}){
 let key='',version=0,timer,data=null,loading=false,error='';
 const matches=(u,q)=>(u.name+' '+(u.remark||'')+' '+u.number).toLowerCase().includes(q.toLowerCase());
 const group=g=>g.group?{id:g.id,name:g.name,...g.group,joined:true}:g;
 const unique=items=>[...new Map(items.map(u=>[u.id,u])).values()];
 function render(query){
  const q=query.trim(),next=S.token+'\n'+q;
  const users=unique([S.user,...S.friends].filter(u=>u&&matches(u,q))),groups=unique([...(S.myGroups||[]),...S.conversations.filter(c=>c.kind==='group').map(group)].filter(g=>matches(g,q)));
  if(next!==key){key=next;data=null;loading=true;error='';clearTimeout(timer);const v=++version;timer=setTimeout(async()=>{try{const [people,rooms]=await Promise.all([api('/api/users?q='+encodeURIComponent(q)),api('/api/groups?q='+encodeURIComponent(q))]);if(v!==version||key!==next)return;data={users:people,groups:rooms}}catch(e){if(v!==version)return;error=e.message}finally{if(v===version){loading=false;if(S.search.trim()===q)renderSidebar()}}},180)}
  const foundUsers=unique([...users,...(data?.users||[])]),foundGroups=unique([...groups,...(data?.groups||[])]);
  return '<div class="directory-results">'+(foundUsers.length?'<div class="search-section-label">用户</div>'+foundUsers.map(u=>`<div class="user-search-result" data-search-user="${u.id}"><button class="conversation-row" ${u.id===S.user.id?'data-profile':'data-start-chat'}="${u.id}">${av(u,'',true)}<div class="row-text"><div class="row-title"><b>${esc(u.remark||u.name)}${u.id===S.user.id?'（我）':''}</b></div><div class="row-preview">${esc(u.number)}</div></div></button>${u.id!==S.user.id?'<div class="user-search-actions"><button data-user-call="'+u.id+'" data-user-call-mode="audio" title="语音通话">'+icon('phone')+'</button><button data-user-call="'+u.id+'" data-user-call-mode="video" title="视频通话">'+icon('video')+'</button></div>':''}</div>`).join(''):'')+(foundGroups.length?'<div class="search-section-label">群聊</div>'+foundGroups.map(g=>`<button class="conversation-row directory-group" data-group-join="${g.id}" data-joined="${g.joined===true}" data-mode="${esc(g.joinMode)}" data-name="${esc(g.name)}" ${!g.joined&&g.joinMode==='closed'?'disabled':''}>${av({kind:'group',avatar:g.avatar})}<div class="row-text"><div class="row-title"><b>${esc(g.name)}</b></div><div class="row-preview">${esc(g.number)} · ${g.count||0} 人 · ${g.joined?'发消息':g.joinMode==='closed'?'暂不开放':g.joinMode==='approval'?'申请加入':'加入群聊'}</div></div></button>`).join(''):'')+(loading?'<div class="directory-status">正在搜索…</div>':error?'<div class="directory-status" role="status">'+esc(error)+'</div>':!foundUsers.length&&!foundGroups.length?'<div class="empty-list">没有找到用户或群聊</div>':'')+'</div>';
 }
 function userMenu(id,x,y){if(id===S.user?.id)return;contextMenu(x,y,'<button data-start-chat="'+id+'">发消息</button><button data-create-group-user="'+id+'">创建群聊</button>')}
 document.addEventListener('contextmenu',e=>{const row=e.target.closest('[data-search-user]');if(row){e.preventDefault();userMenu(row.dataset.searchUser,e.clientX,e.clientY)}});
 bindLongPress('[data-search-user]',(row,x,y)=>userMenu(row.dataset.searchUser,x,y));
 return {render,changed(){key='';version++;clearTimeout(timer)},reset(){key='';version++;clearTimeout(timer);data=null}};
}
