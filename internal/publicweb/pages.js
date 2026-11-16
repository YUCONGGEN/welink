(()=>{
 // Copy text to the clipboard; plain HTTP pages have no async clipboard, so
 // fall back to a hidden textarea and execCommand.
 async function copyText(text,focus){
  let copied=false;
  try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);copied=true}}catch{}
  if(!copied){
   const input=document.createElement('textarea');input.value=text;input.setAttribute('readonly','');input.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0';document.body.appendChild(input);
   try{input.select();input.setSelectionRange(0,input.value.length);copied=document.execCommand('copy')}catch{}finally{input.remove();focus&&focus.focus({preventScroll:true})}
  }
  return copied;
 }
 const button=document.getElementById('copy');
 if(button)button.addEventListener('click',async()=>{
  const code=document.querySelector('[data-meeting-code]').getAttribute('data-meeting-code');
  const text='邀请你加入 LinkMe 会议\n会议号：'+code.slice(0,3)+' '+code.slice(3,6)+' '+code.slice(6)+'\n会议链接：'+location.origin+'/join/'+code;
  const copied=await copyText(text,button);
  document.getElementById('status').textContent=copied?'邀请链接和会议号已复制':'请长按或选中上方会议号复制';
 });
 // Server deployment guide: platform tabs and copy buttons. Without this
 // script every platform is shown one after another.
 const card=document.getElementById('deploy-card');
 if(!card)return;
 const tabs=[...card.querySelectorAll('[role=tab]')];
 const select=tab=>{for(const t of tabs){const on=t===tab;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;document.getElementById(t.getAttribute('aria-controls')).classList.toggle('active',on)}};
 select(tabs[0]); // Linux: the most common server system
 card.classList.add('tabs-ready');
 for(const t of tabs){
  t.addEventListener('click',()=>select(t));
  t.addEventListener('keydown',e=>{const i=tabs.indexOf(t),n=e.key==='ArrowRight'?i+1:e.key==='ArrowLeft'?i-1:-2;if(n===-2)return;e.preventDefault();const next=tabs[(n+tabs.length)%tabs.length];select(next);next.focus()});
 }
 for(const b of card.querySelectorAll('.copy-command'))b.addEventListener('click',async()=>{
  const copied=await copyText(b.parentElement.querySelector('code').textContent,b);
  b.textContent=copied?'已复制':'请手动复制';b.classList.toggle('done',copied);
  setTimeout(()=>{b.textContent='复制';b.classList.remove('done')},2000);
 });
})();
