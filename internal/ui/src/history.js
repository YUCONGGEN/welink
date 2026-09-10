export function createHistory({S,api,modal,toast,esc,preview,fullTime,jump}) {
  let current=null;
  const $=s=>document.querySelector(s);
  function render() {
    const state=current, list=$('#history-results');
    if(!list||!state)return;
    list.innerHTML=state.items.map(m=>`<button class="history-item" data-history-id="${m.id}"><small>${esc(m.name)} · ${fullTime(m.created)}</small><p>${esc(preview(m))}</p><span>查看上下文</span></button>`).join('')||'<div class="empty-list">未找到相关消息</div>';
    if(state.more)list.insertAdjacentHTML('beforeend','<button class="history-more secondary">加载更早记录</button>');
    list.querySelectorAll('[data-history-id]').forEach(button=>button.onclick=()=>jump(state.cid,button.dataset.historyId).catch(e=>toast(e.message)));
    const more=list.querySelector('.history-more');if(more)more.onclick=()=>load(true);
  }
  async function load(older=false) {
    const state=current;if(!state||!$('#history-search'))return;
    const revision=++state.revision;
    const params=new URLSearchParams({q:$('#history-search').value,kind:$('#history-kind').value,sender:$('#history-sender').value});
    for(const field of ['from','to']){
      const value=$('#history-'+field).value;
      if(value){const day=new Date(value+'T00:00:00');if(field==='to')day.setDate(day.getDate()+1);params.set(field,String(day.getTime()))}
    }
    if($('#history-mentions')?.checked)params.set('mentions','me');
    if(older&&state.items.length)params.set('before',String(state.items[state.items.length-1].seq));
    if(!older)$('#history-results').innerHTML='<p class="hint">正在查找…</p>';
    else $('.history-more').disabled=true;
    try {
      const items=await api(`/api/conversations/${state.cid}/messages?${params}`);
      if(current!==state||state.revision!==revision||!$('#history-results'))return;
      state.items=older?[...state.items,...items.reverse()]:items.reverse();state.more=items.length===60;render();
    } catch(e) { if(current===state&&state.revision===revision){toast(e.message);render()} }
  }
  async function open() {
    const state=current={cid:S.active,items:[],more:false,revision:0};
    modal('聊天记录',`<div class="history-search-box"><input id="history-search" maxlength="200" placeholder="搜索消息内容或文件名" aria-label="搜索聊天记录"></div><div class="history-filters"><label>消息类型<select id="history-kind"><option value="">全部消息</option value="text">文字</option><option value="image">图片</option><option value="voice">语音</option><option value="video">视频</option><option value="file">文件</option><option value="meeting">会议</option><option value="forward">聊天记录</option></select></label><label>发送人<select id="history-sender"><option value="">所有人</option></select></label><label>开始日期<input type="date" id="history-from"></label><label>结束日期<input type="date" id="history-to"></label></div>${S.conversations.find(c=>c.id===state.cid)?.kind==='group'?'<label class="history-mention-filter"><input type="checkbox" id="history-mentions">只看 @我的消息</label>':''}<div id="history-results" class="history-results" aria-live="polite"></div>`,'',true);
    let timer;
    $('#history-search').oninput=()=>{clearTimeout(timer);++state.revision;state.items=[];state.more=false;$('#history-results').innerHTML='<p class="hint">正在查找…</p>';timer=setTimeout(()=>load(),250)};
    for(const id of ['kind','sender','from','to'])$('#history-'+id).onchange=()=>{clearTimeout(timer);load()};
    if($('#history-mentions'))$('#history-mentions').onchange=()=>load();
    load();
    try {const detail=await api('/api/conversations/'+state.cid);if(current===state&&$('#history-sender'))$('#history-sender').innerHTML='<option value="">所有人</option>'+detail.members.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}catch(e){toast(e.message)}
  }
  function changed(id,recalled=false) {
    if(!current||!$('#history-results'))return;
    current.revision++;current.items=current.items.filter(m=>m.id!==id);
    if(recalled)for(const item of current.items)if(item.reply?.id===id)item.reply={...item.reply,text:'',fileName:'',recalled:true};
    render();
  }
  return {open,changed};
}
