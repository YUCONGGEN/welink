// Fullscreen must include the dialog and notification hosts, not only the video.
export function meetingWindow({active,changed,toast}){
 let nativeFull=false,busy=false;
 const full=()=>nativeFull||!!document.fullscreenElement;
 async function exit(){
  if(nativeFull){await window.welinkMeetingFullscreen(false);nativeFull=false}
  if(document.fullscreenElement)await document.exitFullscreen();
  changed(full());
 }
 async function toggle(){if(busy||!active())return;busy=true;try{if(full())await exit();else if(window.welinkMeetingFullscreen){await window.welinkMeetingFullscreen(true);nativeFull=true;changed(true)}else{await document.documentElement.requestFullscreen();changed(true)}if(!active())await exit()}catch{toast('无法进入全屏，请重试')}finally{busy=false}}
 document.addEventListener('fullscreenchange',()=>changed(full()));
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&full()&&active()){e.preventDefault();e.stopImmediatePropagation();exit().catch(()=>{})}},true);
 return {toggle,exit,full};
}
