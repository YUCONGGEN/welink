import {meetingWindow} from './meeting-window.js';
export function createRemoteWindow({active,action,toast}){
 const display=meetingWindow({active,toast,nativeFullscreen:window.WeLinkAndroid?.setRemoteFullscreen?enabled=>window.WeLinkAndroid.setRemoteFullscreen(enabled):undefined,changed:full=>{
  const b=document.querySelector('[data-action=remote-fullscreen]');if(b){b.textContent=full?'退出全屏':'全屏';b.setAttribute('aria-pressed',String(full));b.title=full?'退出全屏（Esc）':'全屏'}
  document.querySelector('.remote-screen')?.classList.toggle('remote-fullscreen',full);
  action('/local/remote/release').catch(()=>{});
 }});
 window.WeLinkRemoteFullscreenExited=()=>display.exit().catch(()=>{});
 return {...display,async minimize(){await display.exit();if(active())await action('/local/window/min')},back(){if(!display.full())return false;display.exit().catch(()=>{});return true}};
}
