// Files pasted, dropped, picked or captured wait above the message box until
// the user presses send, as in Feishu and WeChat, so a wrong file can be
// removed and a caption typed before anything leaves. Each chat keeps its own
// tray for this session; nothing is uploaded while a file only waits here.
export function createAttachments({S,esc,icon,bytes,toast}) {
 const $=s=>document.querySelector(s),pending=new Map(),limit=20;
 let next=0;
 const list=cid=>pending.get(cid)||[];
 const picture=file=>/^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type);
 const video=file=>/^video\//.test(file.type)||/\.(mp4|webm|m4v|mov)$/i.test(file.name);
 const release=items=>{for(const item of items)if(item.url)URL.revokeObjectURL(item.url)};
 function add(files,cid=S.active){
  files=[...files].filter(Boolean);if(!cid||!files.length)return 0;
  const box=$('.composer');if(cid===S.active&&box&&(box.classList.contains('group-muted')||box.classList.contains('contact-unavailable'))){toast('当前聊天无法发送文件');return 0}
  const items=list(cid).slice();let added=0;
  for(const file of files){if(items.length>=limit){toast(`一次最多添加 ${limit} 个文件`);break}items.push({id:++next,file,url:picture(file)?URL.createObjectURL(file):''});added++}
  pending.set(cid,items);
  if(cid===S.active){render();$('#composer')?.focus()}
  return added;
 }
 function remove(id){const cid=S.active,items=list(cid),gone=items.filter(item=>item.id===id);release(gone);const kept=items.filter(item=>item.id!==id);if(kept.length)pending.set(cid,kept);else pending.delete(cid);render();$('#composer')?.focus()}
 // take hands the waiting files to the sender and empties the tray; the
 // sender calls release once they are queued.
 function take(cid){const items=list(cid);pending.delete(cid);if(cid===S.active)render();return items}
 function sync(){const button=$('#send-message'),input=$('#composer');if(button&&input)button.disabled=!input.value.trim()&&!list(S.active).length}
 function item(entry){
  const {file}=entry,name=esc(file.name||'未命名文件');
  const body=entry.url?`<img src="${entry.url}" alt="">`:`<span class="attach-icon">${icon(video(file)?'video':'file')}</span><span class="attach-meta"><b>${name}</b><small>${bytes(file.size)}</small></span>`;
  return `<div class="attach-item${entry.url?' is-image':''}" title="${name} · ${bytes(file.size)}">${body}<button type="button" class="attach-remove" data-attach-remove="${entry.id}" aria-label="移除 ${name}">×</button></div>`;
 }
 function render(){
  const tray=$('#attach-draft');if(!tray)return;const items=list(S.active);
  tray.classList.toggle('hidden',!items.length);tray.closest('.composer')?.classList.toggle('has-attachments',items.length>0);
  tray.innerHTML=items.length?items.map(item).join('')+`<span class="attach-hint">${items.length} 个待发送，按发送一起发出</span>`:'';
  tray.onclick=e=>{const b=e.target.closest('[data-attach-remove]');if(b)remove(Number(b.dataset.attachRemove))};
  sync();
 }
 function reset(){for(const items of pending.values())release(items);pending.clear();render()}
 return {add,take,release,render,sync,reset,count:cid=>list(cid).length};
}
