// Makes unread messages visible outside the conversation list: the browser
// tab icon gains a red dot and the title carries the count (macOS / browser
// builds have no native taskbar flash). Windows also flashes the tray icon.
const ICON='/assets/icon.svg',UNREAD_ICON='/assets/icon-unread.svg';
let iconShown=null;
export function markUnread(count){
 count=Math.max(0,Number(count)||0);
 const href=count?UNREAD_ICON:ICON,link=document.querySelector('link[rel~=icon]');
 if(link&&iconShown!==href){link.href=href;iconShown=href}
 const base=document.title.replace(/^\(\d+\+?\)\s*/,''),title=count?`(${count>99?'99+':count}) ${base}`:base;
 if(document.title!==title)document.title=title;
}
