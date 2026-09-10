export function createForwarding({S,api,action,modal,closeModal,toast,esc,icon,av,preview,fullTime,bytes,fileURL,randomID,renderMessages,queueRefresh,mediaBubble}) {
  const $=(s,r=document)=>r.querySelector(s);
  let selection=null,chooser=null,viewer=null;
  function selected(message){return selection?.cid===S.active&&selection.ids.has(message.id)}
  function checkbox(message){return selection?.cid===S.active?`<button class="message-check" role="checkbox" aria-checked="${selected(message)}" aria-label="选择消息">${selected(message)?icon('check'):''}</button>`:''}
  function reset(render=true){selection=null;if(render)renderMessages(true)}
  function sync(){
    if(selection&&(selection.cid!==S.active||S.tab!=='messages'||!S.user))selection=null;
    const area=$('#messages'),composer=$('.composer');if(!area)return;
    area.classList.toggle('selecting-messages',!!selection);
    if(composer)composer.classList.toggle('selection-hidden',!!selection);
    $('#message-selection-toolbar')?.remove();
    if(!selection)return;
    const selectedMessages=S.messages.filter(m=>selection.ids.has(m.id));
    selection.ids=new Set(selectedMessages.map(m=>m.id));
    const count=selection.ids.size,unavailable=selectedMessages.some(m=>m.recalled);
    area.insertAdjacentHTML('afterend',`<section class="message-selection-toolbar" id="message-selection-toolbar"><div><b>已选择 ${count} 条消息</b><button data-fw="cancel-select">取消</button></div><nav><button data-fw="selected-forward" ${!count||unavailable?'disabled':''} title="${unavailable?'已撤回消息不能转发':'转发所选消息'}">${icon('send')}<span>转发</span></button><button data-fw="selected-delete" ${count?'':'disabled'}>${icon('trash')}<span>删除</span></button></nav></section>`);
  }
  function start(id){selection={cid:S.active,ids:new Set([id])};renderMessages(true)}
  function toggle(id){if(selection.ids.has(id))selection.ids.delete(id);else if(selection.ids.size<100)selection.ids.add(id);else{toast('一次最多选择 100 条消息');return}renderMessages(true)}
  function removed(id){if(selection){selection.ids.delete(id);sync()}invalidate(id)}
  function invalidate(id){if(viewer?.id===id&&($('.forward-record-dialog')||$('.forward-record-image'))){viewer=null;closeModal();toast('这条聊天记录已删除或撤回')}}
  function deleteSelected(){
    const state=selection;if(!state?.ids.size)return;
    const ids=[...state.ids];modal('删除所选消息',`<p class="hint">删除这 ${ids.length} 条消息？它们将从你所有设备的聊天记录中移除，对方的记录和已保存的收藏会保留。</p>`,'<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="selection-delete-confirm">删除</button>');
    $('#selection-delete-confirm').onclick=async e=>{e.target.disabled=true;try{await action(`/api/conversations/${state.cid}/messages/delete`,{messageIds:ids});if(S.active===state.cid)S.messages=S.messages.filter(m=>!ids.includes(m.id));reset();closeModal();queueRefresh();toast('已删除所选消息')}catch(error){$('#modal-error').textContent=error.message;e.target.disabled=false}};
  }
  function targets(tab){
    const recent=S.conversations.map(c=>({key:c.id,cid:c.id,name:c.name,kind:c.kind,avatar:c.peer?.avatar||'group'}));
    if(tab==='groups')return recent.filter(c=>c.kind==='group');
    if(tab==='friends')return S.friends.map(u=>{const existing=S.conversations.find(c=>c.kind==='direct'&&c.peer?.id===u.id);return {key:existing?.id||'user:'+u.id,cid:existing?.id,userId:u.id,name:u.remark||u.name,number:u.number,avatar:u.avatar}});
    return recent;
  }
  function renderTargets(){
    const state=chooser;if(!state||!$('#forward-recipients'))return;
    const query=$('#forward-search').value.toLowerCase();
    const items=targets(state.tab).filter(c=>(c.name+(c.number||'')).toLowerCase().includes(query));
    $('#forward-recipients').innerHTML=items.map(c=>`<label class="forward-recipient">${av(c)}<span>${esc(c.name)}${c.number?`<small>${esc(c.number)}</small>`:''}</span><input type="checkbox" value="${esc(c.key)}" ${state.targets.has(c.key)?'checked':''} aria-label="选择 ${esc(c.name)}"></label>`).join('')||'<p class="empty-list">没有匹配的会话</p>';
    $('#forward-recipients').onchange=e=>{const target=items.find(c=>c.key===e.target.value);if(!target)return;if(e.target.checked){if(state.targets.size>=9){e.target.checked=false;toast('最多选择 9 个会话');return}state.targets.set(target.key,target)}else state.targets.delete(target.key);renderChosen()};
    document.querySelectorAll('[data-forward-tab]').forEach(b=>b.classList.toggle('active',b.dataset.forwardTab===state.tab));
  }
  function renderChosen(){
    const state=chooser;$('#forward-selected-count').textContent=`已选择 ${state.targets.size} 个会话`;
    $('#forward-selected').innerHTML=[...state.targets.values()].map(c=>`<button class="forward-chip" data-forward-remove="${esc(c.key)}">${esc(c.name)}<span>×</span></button>`).join('')||'<p class="hint">选择好友或群聊</p>';
    $('#forward-submit').disabled=!state.targets.size;
  }
  function open(ids){
    const messages=S.messages.filter(m=>ids.includes(m.id));if(!messages.length||messages.some(m=>m.recalled)||messages.length!==ids.length){toast('所选消息已删除或撤回');return}
    const state=chooser={cid:S.active,ids,tab:'recent',targets:new Map(),mode:ids.length>1?'merge':'each',messages,signature:'',clientId:''};
    modal('发送给',`<div class="forward-chooser"><section class="forward-people"><input id="forward-search" aria-label="搜索接收人" placeholder="搜索好友或群聊"><nav class="forward-tabs"><button data-forward-tab="recent" class="active">最近</button><button data-forward-tab="friends">好友</button><button data-forward-tab="groups">群聊</button></nav><div id="forward-recipients"></div></section><section class="forward-confirm"><b id="forward-selected-count"></b><div id="forward-selected"></div>${ids.length>1?'<div class="forward-mode"><label><input type="radio" name="forward-mode" value="merge" checked>合并转发</label><label><input type="radio" name="forward-mode" value="each">逐条转发</label></div>':''}<div class="forward-send-preview"><b>${ids.length>1?'聊天记录':esc(preview(messages[0]).slice(0,60))}</b>${ids.length>1?messages.slice(0,3).map(m=>`<p>${esc(m.name+'：'+preview(m))}</p>`).join(''):''}<small>${ids.length} 条消息</small></div><textarea id="forward-note" placeholder="给对方留言（可选）" aria-label="转发留言" maxlength="600"></textarea></section></div>`,'<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="forward-submit" disabled>发送</button>',true);
    $('.modal').classList.add('forward-dialog');renderTargets();renderChosen();
    $('#forward-search').oninput=renderTargets;
    $('#forward-selected').onclick=e=>{const button=e.target.closest('[data-forward-remove]');if(button){state.targets.delete(button.dataset.forwardRemove);renderTargets();renderChosen()}};
    $('.forward-tabs').onclick=e=>{const b=e.target.closest('[data-forward-tab]');if(b){state.tab=b.dataset.forwardTab;renderTargets()}};
    document.querySelectorAll('[name=forward-mode]').forEach(input=>input.onchange=()=>{state.mode=input.value});
    $('#forward-submit').onclick=async()=>{
      const button=$('#forward-submit');button.disabled=true;
      const chosen=[...state.targets.values()].map(target=>({...target})),mode=state.mode,note=$('#forward-note').value;
      try{
        const destinations=[];
        for(const target of chosen){
          if(!target.cid){const created=await action('/api/conversations',{kind:'direct',members:[target.userId]});target.cid=created.id}
          destinations.push(target.cid);
        }
        const body={conversationId:state.cid,messageIds:state.ids,targets:destinations,mode,note};
        const signature=JSON.stringify(body);if(signature!==state.signature){state.signature=signature;state.clientId=randomID()}
        await action('/api/messages/forward',{...body,clientId:state.clientId});
        closeModal();reset();queueRefresh();toast(`已转发到 ${destinations.length} 个会话`);
      }catch(error){if($('#modal-error'))$('#modal-error').textContent=error.message;button.disabled=false}
    };
  }
  function card(m){let card;try{card=JSON.parse(m.text)}catch{return esc('[聊天记录]')};return `<button class="forward-card" data-forward-view="${m.id}"><b>${esc(card.title)}</b>${(card.preview||[]).slice(0,3).map(line=>`<p>${esc(line)}</p>`).join('')}<small>聊天记录 · ${Number(card.count)||0} 条</small></button>`}
  function previewRecord(record){return `<b>${esc(record.title)}</b>${record.items.slice(0,3).map(item=>`<p>${esc(item.name+'：'+preview(item))}</p>`).join('')}<small>聊天记录 · ${record.items.length} 条</small>`}
  function showDocument(){
    const record=viewer.stack[viewer.stack.length-1];
    modal(record.title,`<div class="forward-record">${record.items.map((item,index)=>{
      let content=esc(item.text);
      if(item.kind==='image')content=`<img loading="lazy" src="${fileURL(item.attachmentId)}" alt="${esc(item.fileName||'图片')}" data-forward-image="${item.attachmentId}">`;
      else if(item.kind==='file')content=`<button class="file-card" data-download="${item.attachmentId}" data-filename="${esc(item.fileName)}">${icon('file')}<span><b>${esc(item.fileName)}</b><small>${bytes(item.fileSize)} · 点击下载</small></span></button>`;
      else if(item.kind==='voice'||item.kind==='video')content=mediaBubble(item,viewer.id);
      else if(item.record)content=`<button class="forward-card" data-forward-nested="${index}">${previewRecord(item.record)}</button>`;
      else if(item.kind==='meeting')content=esc('[会议]');
      return `<article class="forward-record-item">${av(item)}<div><header><b>${esc(item.name)}</b><time>${fullTime(item.created)}</time></header><div class="forward-record-content">${content}</div>${item.quote?`<p class="forward-record-quote">${esc(item.quote.name+'：'+item.quote.text)}</p>`:''}</div></article>`;
    }).join('')}</div>`,viewer.stack.length>1?'<button class="secondary" data-fw="record-back">返回上一层</button>':'',true);
    $('.modal').classList.add('forward-record-dialog');
  }
  async function view(id){try{const document=await api(`/api/messages/${id}/forward`);viewer={id,stack:[document]};showDocument()}catch(e){toast(e.message)}}
  document.addEventListener('click',e=>{
    if(!selection)return;
    const message=e.target.closest('[data-message]');if(message&&$('#messages')?.contains(message)){e.preventDefault();e.stopImmediatePropagation();toggle(message.dataset.message)}
  },true);
  document.addEventListener('contextmenu',e=>{if(selection&&e.target.closest('[data-message]')){e.preventDefault();e.stopImmediatePropagation()}},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&selection&&!$('.modal'))reset()});
  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-fw],[data-forward-view],[data-forward-nested],[data-forward-image]');if(!button)return;
    $('.context-menu')?.remove();
    if(button.dataset.forwardView){view(button.dataset.forwardView);return}
    if(button.dataset.forwardNested!==undefined){const record=viewer?.stack[viewer.stack.length-1].items[Number(button.dataset.forwardNested)]?.record;if(record){viewer.stack.push(record);showDocument()};return}
    if(button.dataset.forwardImage){modal('图片',`<img class="forward-record-image" src="${fileURL(button.dataset.forwardImage)}" alt="图片预览">`,'<button class="secondary" data-fw="image-back">返回聊天记录</button>',true);return}
    switch(button.dataset.fw){
      case 'single':open([button.dataset.mid]);break;
      case 'select':start(button.dataset.mid);break;
      case 'cancel-select':reset();break;
      case 'selected-forward':if(selection)open([...selection.ids]);break;
      case 'selected-delete':deleteSelected();break;
      case 'record-back':viewer?.stack.pop();showDocument();break;
      case 'image-back':case 'record-return':showDocument();break;
    }
  });
  return {checkbox,selected,sync,reset,removed,invalidate,open,card};
}
