// One in-flight request; stale hover positions never delay keys or button-up.
export function createRemoteInput(send,release,failed=()=>{}) {
 let queue=[],busy=false,buttons=0,generation=0,stopped=false,resetting=null;
 async function drain(){
  if(busy||stopped||!queue.length)return;
  busy=true;const version=generation,batch=queue.splice(0,64).map(item=>item.event);
  try{await send(batch)}catch(error){queue=[];buttons=0;generation++;await release().catch(()=>{});failed(error)}
  finally{busy=false;if(version===generation)drain()}
 }
 function push(events){
  if(stopped||resetting)return;
  for(const event of events){
   const hover=event.type==='move'&&buttons===0,last=queue[queue.length-1];
   if(hover&&last?.hover)queue[queue.length-1]={event,hover};else queue.push({event,hover});
   if(event.type==='down')buttons|=1<<event.button;
   if(event.type==='up')buttons&=~(1<<event.button);
  }
  if(queue.length>256){reset();failed(Error('输入暂时拥堵，已释放按键，请重试'));return}
  drain();
 }
 function reset(){
  if(resetting)return resetting;
  queue=[];buttons=0;generation++;
  // A release follows any admitted key-down, including a slow local request.
  resetting=(async()=>{while(busy)await new Promise(resolve=>setTimeout(resolve,5));await release().catch(()=>{})})();
  return resetting.finally(()=>{resetting=null});
 }
 return {push,release:reset,async close(){stopped=true;await reset()}};
}

export function remotePoint(event,image){
 const box=image.getBoundingClientRect(),width=Number(image.dataset.width),height=Number(image.dataset.height);
 if(!width||!height||!box.width||!box.height)return {type:'move',x:0,y:0};
 const scale=Math.min(box.width/width,box.height/height),left=box.left+(box.width-width*scale)/2,top=box.top+(box.height-height*scale)/2;
 return {type:'move',x:Math.max(0,Math.min(width-1,Math.round((event.clientX-left)/scale))),y:Math.max(0,Math.min(height-1,Math.round((event.clientY-top)/scale)))};
}
