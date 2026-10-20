export function createDesktop({S,modal,closeModal,toast,markRead,esc}) {
 const native=typeof window.welinkDesktopSettings==='function';let lastCount=-1,nativeHidden=!!window.welinkNativeHidden;
 const hidden=()=>document.hidden||nativeHidden||!document.hasFocus();
 function unread(){if(!native)return;const count=S.user?S.conversations.reduce((n,c)=>n+Number((c.muted?c.mentionCount:c.unread)||0),0):0;lastCount=count;window.welinkDesktopUnread(count).catch(()=>{lastCount=-1})}
 function activity(key,active){if(!native)return;window.welinkDesktopActivity(key,!!active).catch(()=>{})}
 function clearActivities(prefix=''){if(!native)return;window.welinkDesktopClearActivities(prefix).catch(()=>{})}
 async function settings(){try{
  const p=await window.welinkDesktopSettings();
  const toggle=(id,label,checked)=>`<label class="prefs-row" for="${id}"><span>${label}</span><input id="${id}" type="checkbox" ${checked?'checked':''}></label>`;
  const shortcut=(id,label,value,error)=>`<label class="prefs-row desktop-shortcut" for="${id}"><span>${label}</span><span class="shortcut-control"><input id="${id}" class="shortcut-input" readonly value="${esc(value||'')}" placeholder="点击后按下快捷键" aria-label="${label}快捷键"><button class="secondary" type="button" data-clear-shortcut="${id}">清除</button></span></label>${error?'<p class="shortcut-error" data-shortcut-error="'+id+'">'+esc(error)+'</p>':''}`;
  modal('Windows 桌面设置',toggle('desktop-auto-start','登录 Windows 后启动 LinkMe',p.autoStart)+toggle('desktop-start-minimized','开机启动时最小化到托盘',p.startMinimized??true)+`<p class="hint">仅对当前 Windows 用户生效，默认关闭。${p.autoStart&&!p.autoStartRegistered?'启动项尚未注册，请重新保存。':''}</p>`+toggle('desktop-close-tray','关闭窗口后留在系统托盘',p.closeToTray)+'<p class="hint">关闭窗口后继续接收消息，双击托盘图标即可恢复。</p>'+'<p class="hint">普通聊天只通过任务栏图标提示未读；来电、远程和会议邀请会在右下角显示。</p>'+toggle('desktop-hotkeys-enabled','启用全局快捷键',p.hotkeysEnabled??true)+shortcut('desktop-show-hotkey','显示主界面',p.showHotkey??'Ctrl+Alt+W',p.hotkeyErrors?.show)+shortcut('desktop-capture-hotkey','截图',p.captureHotkey??'Ctrl+Alt+A',p.hotkeyErrors?.capture)+'<p class="hint">点击输入框后按下组合键，须包含 Ctrl 或 Alt。可清除某一项；被 QQ 等其他程序占用时可换一个组合键。</p>'+(p.trayAvailable?'':'<p class="hint">系统托盘暂不可用，关闭窗口时会最小化到任务栏。</p>')+'<p class="hint">完全退出可使用托盘右键菜单中的“退出 LinkMe”。</p><p id="desktop-save-error" class="shortcut-error" role="alert"></p>','<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="desktop-save">保存</button>');
  document.querySelector('.modal').classList.add('desktop-settings');
  const $=id=>document.getElementById(id),availability=()=>{$('desktop-start-minimized').disabled=!$('desktop-auto-start').checked;for(const input of document.querySelectorAll('.shortcut-input'))input.disabled=!$('desktop-hotkeys-enabled').checked;for(const b of document.querySelectorAll('[data-clear-shortcut]'))b.disabled=!$('desktop-hotkeys-enabled').checked};
  $('desktop-auto-start').onchange=availability;$('desktop-hotkeys-enabled').onchange=availability;availability();
  for(const input of document.querySelectorAll('.shortcut-input'))input.onkeydown=event=>{
   if(event.key==='Tab')return;event.preventDefault();event.stopPropagation();
   if(event.key==='Escape'){input.blur();return}if(event.key==='Backspace'||event.key==='Delete'){input.value='';return}
   if(['Control','Alt','Shift','Meta'].includes(event.key))return;
   const code=event.code||'',key=/^Key[A-Z]$/.test(code)?code.slice(3):/^Digit\d$/.test(code)?code.slice(5):/^F\d+$/.test(event.key)?event.key:'';
   if(event.metaKey||!event.ctrlKey&&!event.altKey||!key||key==='F12'){$('desktop-save-error').textContent='请选择 Ctrl / Alt 与字母、数字或功能键的组合，F12 不可用。';return}
   document.querySelector('[data-shortcut-error="'+input.id+'"]')?.remove();input.value=[event.ctrlKey?'Ctrl':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',key].filter(Boolean).join('+');$('desktop-save-error').textContent='';
  };
  for(const button of document.querySelectorAll('[data-clear-shortcut]'))button.onclick=()=>{$(button.dataset.clearShortcut).value='';document.querySelector('[data-shortcut-error="'+button.dataset.clearShortcut+'"]')?.remove()};
  const button=$('desktop-save');button.onclick=async()=>{button.disabled=true;try{await window.welinkDesktopSave({closeToTray:$('desktop-close-tray').checked,messageAlerts:false,messageSound:p.messageSound!==false,autoStart:$('desktop-auto-start').checked,startMinimized:$('desktop-start-minimized').checked,hotkeysEnabled:$('desktop-hotkeys-enabled').checked,showHotkey:$('desktop-show-hotkey').value,captureHotkey:$('desktop-capture-hotkey').value});closeModal();toast('桌面设置已保存')}catch(error){$('desktop-save-error').textContent=String(error);button.disabled=false}};
 }catch(error){toast(String(error))}}
 function quit(){modal('退出 LinkMe','<p>退出后将停止接收消息，并结束当前通话和远程协助。</p>','<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="desktop-exit">退出</button>');document.querySelector('#desktop-exit').onclick=()=>window.welinkDesktopExit()}
 window.addEventListener('welink-native-visibility',event=>{nativeHidden=!!event.detail?.hidden;if(!hidden()&&S.user){document.title='LinkMe';markRead().catch(()=>{})}});
 document.addEventListener('click',event=>{if(!native)return;const action=event.target.closest('[data-desktop]')?.dataset.desktop;if(action==='settings')settings();if(action==='quit')quit()});
 return {native,hidden,unread,activity,clearActivities,settingsRow:()=>native?'<div class="prefs-row"><span>Windows 桌面设置</span><button class="secondary" data-desktop="settings">管理</button></div>':'',exitMenu:()=>native?'<button data-desktop="quit">退出 LinkMe</button>':''};
}
