// The chat list beside the conversation can be dragged narrower or wider on
// the desktop; the width is remembered on this device. Double-click resets.
const KEY='welink_sidebar_width',MIN=220,MAX=400,DEFAULT=278;
export function sidebarResize(){
 const apply=w=>document.documentElement.style.setProperty('--sidebar-w',w+'px');
 let saved=DEFAULT;try{saved=+localStorage.getItem(KEY)||DEFAULT}catch{}
 apply(Math.min(MAX,Math.max(MIN,saved)));
 document.addEventListener('mousedown',e=>{
  const handle=e.target.closest?.('.sidebar-resizer');if(!handle||e.button!==0)return;
  e.preventDefault();const sidebar=handle.closest('.sidebar'),left=sidebar.getBoundingClientRect().left;
  document.body.classList.add('resizing-sidebar');let width=sidebar.offsetWidth;
  const move=ev=>{width=Math.round(Math.min(MAX,Math.max(MIN,ev.clientX-left)));apply(width)};
  const up=()=>{document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);document.body.classList.remove('resizing-sidebar');try{localStorage.setItem(KEY,String(width))}catch{}};
  document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
 });
 document.addEventListener('dblclick',e=>{if(!e.target.closest?.('.sidebar-resizer'))return;apply(DEFAULT);try{localStorage.removeItem(KEY)}catch{}});
}
