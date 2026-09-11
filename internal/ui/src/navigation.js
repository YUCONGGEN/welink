// Preserve real controls and their handlers when moving between dialog pages.
export function createNavigation({getHandler,setHandler,beforeOpen,esc,icon,onPageBack,beforeBack}) {
 const stack=[];
 const host=()=>document.getElementById('overlays');
 const dialog=()=>host().querySelector('.modal');
 const focus=node=>{if(node?.isConnected)node.focus({preventScroll:true})};
 function clear(){stack.length=0;host().innerHTML='';setHandler(null)}
 function open(title,body,footer='',wide=false){
  beforeOpen();
  const current=dialog(),previousFocus=document.activeElement;
  // Live media/capture/incoming prompts own resources; don't restore dead views.
  const transient=/截图|录音|视频预览|语音消息|远程协助|邀请|来电|登录 Windows/.test(title)||current?.querySelector('canvas,video,audio,.qr-confirm,.remote-invite');
  if(transient)stack.length=0;
  else if(current){
   const previous=stack.findIndex(item=>item.title===title);
   if(previous>=0)stack.splice(previous);
   else if(current.getAttribute('aria-label')!==title){
    stack.push({title:current.getAttribute('aria-label'),node:host().firstElementChild,handler:getHandler(),focus:previousFocus,scroll:current.querySelector('.modal-body')?.scrollTop||0});
    if(stack.length>12)stack.shift();
   }
  }else stack.length=0;
  host().innerHTML=`<div class="modal-backdrop"><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="modal-head"><button type="button" class="dialog-back" data-action="modal-back" aria-label="返回${stack.length?'上一页':''}" title="${stack.length?'返回上一页':'返回'}">${icon('back')}<span>返回</span></button><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-action="close-modal" aria-label="关闭" title="关闭">${icon('close')}</button></header><div class="modal-body">${body}<div class="form-error" id="modal-error" role="alert"></div></div>${footer?`<footer class="modal-footer">${footer}</footer>`:''}</section></div>`;
  setHandler(null);
  // Keep the keyboard closed until mobile users choose an input.
  if(!matchMedia('(max-width:700px)').matches){const opened=dialog();setTimeout(()=>{if(opened?.isConnected&&!opened.contains(document.activeElement))focus(opened.querySelector('input:not([type=checkbox]):not([type=file]):not([type=range])')||opened.querySelector('.dialog-back'))},40)}
 }
 function back(){
  if(!host().firstElementChild)return false;
  if(beforeBack?.())return true;
  const cancelAvatar=dialog()?.querySelector('[data-avatar=cancel]');
  if(cancelAvatar){cancelAvatar.click();return true}
  beforeOpen();
  const prior=stack.pop();
  if(prior){host().innerHTML='';host().appendChild(prior.node);setHandler(prior.handler);const body=dialog()?.querySelector('.modal-body');if(body)body.scrollTop=prior.scroll;focus(prior.focus)}else clear();
  return true;
 }
 function handleBack(){
  const menu=document.querySelector('.context-menu,.popup');if(menu){menu.remove();return true}
  if(back())return true;
  if(document.querySelector('.qr-auth')){document.querySelector('[data-action=login]')?.click();return true}
  return onPageBack();
 }
 document.addEventListener('keydown',event=>{
  if(event.key!=='Tab'||!dialog())return;
  const controls=[...dialog().querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')].filter(node=>!node.disabled&&node.getClientRects().length),first=controls[0],last=controls[controls.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();focus(last)}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();focus(first)}
 });
 window.WeLinkGoBack=handleBack;
 // Completing a settings subpage returns to the controls the user came from.
 function complete(){if(stack.some(item=>item.title==='设置'))back();else clear()}
 return {open,clear,back,handleBack,complete};
}
