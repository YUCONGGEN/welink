// In-app confirm and input dialogs. The browser's confirm()/prompt() show a
// system window titled with the local address ("127.0.0.1:18746 显示"); these
// look like the rest of LinkMe and never block the page.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function open({title,message,input,ok,cancel,danger}){
 return new Promise(resolve=>{
  const layer=document.createElement('div');layer.className='lm-dialog-layer';
  layer.innerHTML=`<div class="lm-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">${title?`<h3>${esc(title)}</h3>`:''}${message?`<p>${esc(message).replace(/\n/g,'<br>')}</p>`:''}${input?`<input class="lm-dialog-input" maxlength="${input.max||200}" placeholder="${esc(input.placeholder||'')}" value="${esc(input.value||'')}">`:''}<div class="lm-dialog-actions"><button class="secondary" data-dialog="cancel">${esc(cancel||'取消')}</button><button class="primary${danger?' danger-fill':''}" data-dialog="ok">${esc(ok||'确定')}</button></div></div>`;
  document.body.append(layer);
  const field=layer.querySelector('.lm-dialog-input'),okBtn=layer.querySelector('[data-dialog=ok]');
  const done=value=>{document.removeEventListener('keydown',key,true);layer.remove();resolve(value)};
  const accept=()=>done(input?field.value:true),reject=()=>done(input?null:false);
  const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();reject()}else if(e.key==='Enter'&&!e.isComposing&&(document.activeElement===field||document.activeElement===okBtn||!input)){e.preventDefault();e.stopPropagation();accept()}};
  document.addEventListener('keydown',key,true);
  layer.addEventListener('mousedown',e=>{if(e.target===layer)reject()});
  okBtn.onclick=accept;layer.querySelector('[data-dialog=cancel]').onclick=reject;
  setTimeout(()=>{if(field){field.focus();field.select()}else okBtn.focus()},0);
 });
}

// confirmDialog resolves true when the user agrees.
export const confirmDialog=(message,options={})=>open({title:options.title||'请确认',message,ok:options.ok,cancel:options.cancel,danger:options.danger});
// inputDialog resolves the text, or null when cancelled.
export const inputDialog=(message,options={})=>open({title:options.title||message,message:options.title?message:'',input:{value:options.value,placeholder:options.placeholder,max:options.max},ok:options.ok,cancel:options.cancel});
