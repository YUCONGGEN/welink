// One native/browser window can belong to only one fullscreen surface at a time.
let owner=null;
export function meetingWindow({active,changed,toast,nativeFullscreen}){
 let nativeFull=false,busy=false,entry=null,leaving=null,native;
 const controller={exit},full=()=>owner===controller&&(nativeFull||!!document.fullscreenElement);
 async function exit(){
  if(leaving)return leaving;
  leaving=(async()=>{
   if(entry)try{await entry}catch{}
   if(owner!==controller)return;
   if(nativeFull){await native(false);nativeFull=false}
   if(document.fullscreenElement)await document.exitFullscreen();
   if(owner===controller)owner=null;changed(false);
  })();
  try{await leaving}finally{leaving=null}
 }
 async function toggle(){
  if(busy||!active())return;busy=true;
  try{
   if(full()){await exit();return}
   if(owner&&owner!==controller)await owner.exit();
   if(!active())return;
   owner=controller;native=nativeFullscreen||window.welinkMeetingFullscreen;
   entry=(async()=>{if(native){await native(true);nativeFull=true}else await document.documentElement.requestFullscreen()})();
   try{await entry}finally{entry=null}
   changed(full());if(!active())await exit();
  }catch{if(owner===controller&&!nativeFull&&!document.fullscreenElement)owner=null;changed(full());toast('无法切换全屏，请重试')}finally{busy=false}
 }
 document.addEventListener('fullscreenchange',()=>{if(owner!==controller)return;if(!nativeFull&&!entry&&!document.fullscreenElement)owner=null;changed(full())});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&full()&&active()){e.preventDefault();e.stopImmediatePropagation();exit().catch(()=>toast('退出全屏失败，请重试'))}},true);
 return {toggle,exit,full};
}
