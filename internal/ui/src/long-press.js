// A touch release may synthesize a click on a newly opened menu (or its parent),
// not on the original row. Suppress that one click; a fresh touch starts normally.
export function bindLongPress(selector,onHold,{delay=500,distance=10}={}) {
 let timer,start,held=false,ghostUntil=0,target=null,started=0;
 const cancel=()=>{clearTimeout(timer);timer=null};
 const key=node=>node?.dataset.message||node?.dataset.conversation||node?.dataset.profile;
 const fire=()=>{const node=document.elementFromPoint(start.x,start.y)?.closest(selector);if(node&&key(node)===key(target)){held=true;onHold(node,start.x,start.y)}};
 document.addEventListener('touchstart',event=>{
  cancel();ghostUntil=0;held=false;start=null;target=null;
  const node=event.target.closest(selector);if(!node||event.touches.length!==1)return;
  const p=event.touches[0];start={x:p.clientX,y:p.clientY};target=node;started=Date.now();
  timer=setTimeout(fire,delay);
 },{passive:true});
 document.addEventListener('touchmove',event=>{const p=event.touches[0];if(!p||!start||Math.hypot(p.clientX-start.x,p.clientY-start.y)>distance)cancel()},{passive:true});
 document.addEventListener('touchend',()=>{if(timer&&!held&&Date.now()-started>=delay)fire();cancel();if(held)ghostUntil=Date.now()+900;held=false},{passive:true});
 document.addEventListener('touchcancel',()=>{cancel();held=false;ghostUntil=0},{passive:true});
 document.addEventListener('click',event=>{
  if((held||Date.now()<ghostUntil)&&event.detail!==0&&event.sourceCapabilities?.firesTouchEvents!==false){cancel();held=false;ghostUntil=0;event.preventDefault();event.stopImmediatePropagation()}
 },true);
}
