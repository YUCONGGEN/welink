export function createScreenshots({S,modal,closeModal,toast,esc,upload}) {
 let pending=null,editor=null,generation=0,stream=null;
 const own=state=>editor===state&&state.canvas.isConnected;
 function reset(){generation++;pending=null;stream?.getTracks().forEach(track=>track.stop());stream=null;if(editor){editor.observer?.disconnect();cancelAnimationFrame(editor.frame);editor.image.src='';editor.canvas.width=editor.canvas.height=1;editor=null}window.welinkScreenshotCancel?.().catch(()=>{})}
 async function start(){
  if(pending||editor)return;
  const state=pending={token:S.token,cid:S.user&&S.active&&S.tab==='messages'?S.active:null,name:S.conversations.find(c=>c.id===S.active)?.name||''},version=generation;
  if(typeof window.welinkScreenshotCapture==='function'){try{if(await window.welinkScreenshotCapture()===false){pending=null;toast('截图仍在处理中，请稍后重试')}}catch(error){pending=null;toast(String(error))}return}
  if(!navigator.mediaDevices?.getDisplayMedia){pending=null;toast('此设备请使用系统截图后发送图片');return}
  let captureStream;
  try{
   captureStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
   if(version!==generation)return;
   stream=captureStream;
   const video=document.createElement('video');video.srcObject=captureStream;await video.play();await new Promise(resolve=>requestAnimationFrame(resolve));
   if(version!==generation)return;
   const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);
   const image=canvas.toDataURL('image/png');canvas.width=canvas.height=1;video.srcObject=null;
   if(version===generation&&pending===state)await preview(state,image);
  }catch(error){if(version===generation&&error.name!=='NotAllowedError')toast('截图失败：'+error.message)}finally{captureStream?.getTracks().forEach(track=>track.stop());if(stream===captureStream)stream=null;if(pending===state)pending=null}
 }
 function redraw(state){
  if(!own(state))return;const {canvas,ctx,image}=state;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);
  for(const item of [...state.items,...(state.current?[state.current]:[])]){
   ctx.strokeStyle=ctx.fillStyle=item.color;ctx.lineWidth=item.width;ctx.lineCap=ctx.lineJoin='round';const [a,b]=item.points;
   if(item.tool==='pen'){ctx.beginPath();ctx.moveTo(a.x,a.y);for(const point of item.points.slice(1))ctx.lineTo(point.x,point.y);if(item.points.length===1)ctx.lineTo(a.x+.1,a.y+.1);ctx.stroke()}
   else if(item.tool==='text'){ctx.font=`${Math.max(18,item.width*6)}px "Microsoft YaHei",sans-serif`;ctx.textBaseline='top';ctx.fillText(item.text,a.x,a.y)}
   else if(b){const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);
    if(item.tool==='rectangle')ctx.strokeRect(x,y,w,h);
    if(item.tool==='arrow'){const angle=Math.atan2(b.y-a.y,b.x-a.x),length=Math.max(12,item.width*4);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.moveTo(b.x-length*Math.cos(angle-.5),b.y-length*Math.sin(angle-.5));ctx.lineTo(b.x,b.y);ctx.lineTo(b.x-length*Math.cos(angle+.5),b.y-length*Math.sin(angle+.5));ctx.stroke()}
    if(item.tool==='mosaic'&&w>=1&&h>=1){const small=document.createElement('canvas'),size=Math.max(8,item.width*5);small.width=Math.max(1,Math.ceil(w/size));small.height=Math.max(1,Math.ceil(h/size));small.getContext('2d').drawImage(canvas,x,y,w,h,0,0,small.width,small.height);ctx.imageSmoothingEnabled=false;ctx.drawImage(small,x,y,w,h);ctx.imageSmoothingEnabled=true;small.width=small.height=1}
   }
  }
  document.querySelector('#screenshot-undo').disabled=!state.items.length;document.querySelector('#screenshot-clear').disabled=!state.items.length;
 }
 function paint(state){cancelAnimationFrame(state.frame);state.frame=requestAnimationFrame(()=>redraw(state))}
 async function blob(state){if(!own(state))throw Error('截图预览已关闭');redraw(state);const result=await new Promise(resolve=>state.canvas.toBlob(resolve,'image/png'));if(!result)throw Error('无法生成截图');if(!own(state))throw Error('截图预览已关闭');return result}
 async function preview(intent,url){
  intent.loading=true;const version=generation,image=new Image();
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('无法读取截图'));image.src=url});if(version!==generation)return;
  if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>32*1024*1024)throw Error('截图尺寸过大');
  pending=null;const canSend=!!intent.cid&&!!S.user&&S.token===intent.token;
  modal('截图预览',`<div class="screenshot-tools" role="toolbar" aria-label="截图标注">${[['pen','画笔'],['rectangle','矩形'],['arrow','箭头'],['text','文字'],['mosaic','马赛克']].map(([tool,label])=>`<button type="button" data-shot-tool="${tool}" class="${tool==='pen'?'selected':''}" aria-pressed="${tool==='pen'}">${label}</button>`).join('')}<label>颜色<input id="screenshot-color" type="color" value="#ff5454" aria-label="标注颜色"></label><label>粗细<select id="screenshot-width" aria-label="标注粗细"><option value="2">细</option><option value="4" selected>中</option><option value="8">粗</option></select></label><button id="screenshot-undo" type="button">撤销</button><button id="screenshot-clear" type="button">清空标注</button></div><div class="screenshot-canvas-wrap"><canvas id="screenshot-canvas" aria-label="截图标注画布"></canvas></div><div class="screenshot-text-row hidden"><input id="screenshot-text" maxlength="200" placeholder="输入标注文字后，点击图中要放置的位置" aria-label="截图标注文字"></div><p class="hint">${image.naturalWidth} × ${image.naturalHeight} · ${canSend?'确认后发送给 '+esc(intent.name):'可保存到电脑或复制到剪贴板'}。Esc 关闭，Ctrl + Z 撤销。</p>`,
   '<button class="secondary" data-action="close-modal">取消</button><button class="secondary" id="screenshot-save">保存图片</button><button class="secondary" id="screenshot-copy">复制</button>'+(canSend?'<button class="primary" id="screenshot-send">发送到 '+esc(intent.name)+'</button>':''),true);
  document.querySelector('.modal').classList.add('screenshot-editor');
  const canvas=document.querySelector('#screenshot-canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const state=editor={...intent,canvas,ctx:canvas.getContext('2d'),image,items:[],current:null,tool:'pen',frame:0,pointer:null};
  state.observer=new MutationObserver(()=>{if(editor===state&&!canvas.isConnected)reset()});state.observer.observe(document.querySelector('#overlays'),{childList:true,subtree:true});
  const position=event=>{const rect=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(canvas.width,(event.clientX-rect.left)*canvas.width/rect.width)),y:Math.max(0,Math.min(canvas.height,(event.clientY-rect.top)*canvas.height/rect.height))}};
  canvas.onpointerdown=event=>{if(event.button!==0||state.pointer!==null)return;event.preventDefault();if(state.items.length>=250){toast('标注数量较多，请先撤销或清空部分内容');return}const item={tool:state.tool,color:document.querySelector('#screenshot-color').value,width:Number(document.querySelector('#screenshot-width').value),points:[position(event)]};
   if(item.tool==='text'){item.text=document.querySelector('#screenshot-text').value.trim();if(!item.text){document.querySelector('#screenshot-text').focus();return}state.items.push(item);paint(state);return}
   state.current=item;state.pointer=event.pointerId;canvas.setPointerCapture(event.pointerId);paint(state);
  };
  canvas.onpointermove=event=>{if(state.pointer!==event.pointerId||!state.current)return;const point=position(event);if(state.current.tool==='pen'){if(state.current.points.length<10000)state.current.points.push(point)}else state.current.points[1]=point;paint(state)};
  const finish=(event,cancelled=false)=>{if(state.pointer!==event.pointerId)return;state.pointer=null;if(!cancelled&&state.current)state.items.push(state.current);state.current=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);paint(state)};
  canvas.onpointerup=event=>finish(event);canvas.onpointercancel=event=>finish(event,true);canvas.onlostpointercapture=event=>finish(event,true);
  for(const button of document.querySelectorAll('[data-shot-tool]'))button.onclick=()=>{state.tool=button.dataset.shotTool;for(const b of document.querySelectorAll('[data-shot-tool]')){b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button))}document.querySelector('.screenshot-text-row').classList.toggle('hidden',state.tool!=='text')};
  document.querySelector('#screenshot-undo').onclick=()=>{state.items.pop();paint(state)};document.querySelector('#screenshot-clear').onclick=()=>{state.items=[];paint(state)};
  const perform=(id,work)=>{const button=document.getElementById(id);if(button)button.onclick=async()=>{button.disabled=true;try{await work()}catch(error){toast(String(error.message||error))}finally{if(own(state))button.disabled=false}}};
  perform('screenshot-save',async()=>{const data=await blob(state),href=URL.createObjectURL(data),link=document.createElement('a');link.href=href;link.download='WeLink-截图-'+Date.now()+'.png';link.click();setTimeout(()=>URL.revokeObjectURL(href),60000)});
  perform('screenshot-copy',async()=>{const data=await blob(state);if(typeof window.welinkScreenshotCopy==='function'){const encoded=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(data)});if(!own(state))return;await window.welinkScreenshotCopy(encoded)}else if(navigator.clipboard?.write&&window.ClipboardItem)await navigator.clipboard.write([new ClipboardItem({'image/png':data})]);else throw Error('此设备请先保存图片');if(own(state))toast('截图已复制')});
  perform('screenshot-send',async()=>{if(!S.user||S.token!==state.token)throw Error('登录账号已变化，请重新选择聊天后截图');const data=await blob(state);if(S.token!==state.token)throw Error('登录账号已变化');await upload(new File([data],'截图-'+Date.now()+'.png',{type:'image/png'}),false,state.cid);if(own(state))closeModal()});
  redraw(state);
 }
 window.addEventListener('welink-screenshot-request',()=>start().catch(error=>toast(String(error))));
 window.addEventListener('welink-screenshot-result',event=>{const state=pending;if(!state||state.loading)return;const result=event.detail||{};if(result.cancelled||result.error){pending=null;if(result.error)toast(result.error);return}if(typeof result.image==='string'&&result.image.startsWith('data:image/png;base64,'))preview(state,result.image).catch(error=>{pending=null;toast(String(error.message||error))})});
 document.addEventListener('keydown',event=>{if(!editor||!own(editor))return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeModal();reset()}else if(event.ctrlKey&&!event.altKey&&event.key.toLowerCase()==='z'&&!event.target.closest('input')){event.preventDefault();editor.items.pop();paint(editor)}},true);
 return {start,reset};
}
