(()=>{
 const button=document.getElementById('copy');
 if(!button)return;
 button.addEventListener('click',async()=>{
  const code=document.querySelector('[data-meeting-code]').getAttribute('data-meeting-code');
  const text='邀请你加入 LinkMe 会议\n会议号：'+code.slice(0,3)+' '+code.slice(3,6)+' '+code.slice(6)+'\n会议链接：'+location.origin+'/join/'+code;
  let copied=false;
  try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);copied=true}}catch{}
  if(!copied){
   const input=document.createElement('textarea');input.value=text;input.setAttribute('readonly','');input.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0';document.body.appendChild(input);
   try{input.select();input.setSelectionRange(0,input.value.length);copied=document.execCommand('copy')}catch{}finally{input.remove();button.focus({preventScroll:true})}
  }
  document.getElementById('status').textContent=copied?'邀请链接和会议号已复制':'请长按或选中上方会议号复制';
 });
})();
