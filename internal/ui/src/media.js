export function createMedia({S,api,action,modal,closeModal,toast,esc,icon,fileURL,randomID,renderMessages,queueRefresh,upload}) {
  const $=(s,r=document)=>r.querySelector(s);
  const mic='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
  const sound='<svg class="voice-sound" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 10 4-4v12l-4-4H3v-4Z"/><path d="M13 8a6 6 0 0 1 0 8"/><path d="M17 4a11 11 0 0 1 0 16"/></svg>';
  const seconds=ms=>Math.max(1,Math.ceil(Number(ms||0)/1000));
  const clock=ms=>{const n=Math.max(0,Math.floor(Number(ms||0)/1000));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0')};
  let mode=false,recording=null,hold=null,videoPlayer=null,playing=null;
  const audio=document.createElement('audio');audio.id='welink-audio-player';audio.preload='none';audio.style.display='none';document.body.append(audio);
  function played(){try{return new Set(JSON.parse(localStorage.getItem('welink_voice_played_'+S.user?.id)||'[]'))}catch{return new Set()}}
  function markPlayed(id){const ids=played();ids.add(id);localStorage.setItem('welink_voice_played_'+S.user.id,JSON.stringify([...ids].slice(-500)))}
  function bubble(m,rootID=''){
    if(m.kind==='voice')return `<button class="voice-message" data-play-voice="${m.attachmentId}" data-media-message="${m.id||rootID}" data-duration="${Number(m.durationMs)||0}" aria-label="播放语音 ${seconds(m.durationMs)} 秒" style="width:${Math.min(220,95+Math.sqrt(seconds(m.durationMs))*15)}px">${sound}<span>${seconds(m.durationMs)}″</span>${m.sender&&m.sender!==S.user?.id&&!played().has(m.attachmentId)?'<i class="voice-unplayed"></i>':''}</button>`;
    return `<button class="video-message" data-play-video="${m.attachmentId}" data-media-message="${m.id||rootID}" data-media-root="${rootID}" data-media-name="${esc(m.fileName||'视频')}" aria-label="播放视频"><video muted playsinline preload="metadata" src="${fileURL(m.attachmentId)}" tabindex="-1"></video><span class="video-play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" style="fill:currentColor;stroke:none"/></svg></span><span class="video-duration">${clock(m.durationMs)}</span></button>`;
  }
  function tools(){return `<button class="icon-btn" title="语音消息" aria-label="语音消息" data-media="voice-mode">${mic}</button>`}
  function input(){return '<div id="voice-input" class="voice-input hidden"><button class="voice-hold" data-media="voice-hold">按住说话</button><div class="desktop-voice-controls"><span id="voice-status">语音最长 60 秒</span><button class="primary" data-media="voice-start">开始录音</button><button class="secondary hidden" data-media="voice-cancel">取消</button><button class="primary hidden" data-media="voice-finish">发送语音</button></div></div><input id="video-input" class="file-input" type="file" accept="video/mp4,video/webm"><input id="video-capture-input" class="file-input" type="file" accept="video/*" capture="environment">'}
  function mount(){
    $('.composer')?.classList.toggle('voice-mode',mode);$('#voice-input')?.classList.toggle('hidden',!mode);$('[data-media=voice-mode]')?.classList.toggle('active',mode);
    for(const id of ['video-input','video-capture-input'])if($('#'+id))$('#'+id).onchange=e=>{const file=e.target.files[0];e.target.value='';if(file)sendVideo(file)};
    renderRecording();
  }
  function renderRecording(){
    const state=recording,ready=state?.context,elapsed=ready?state.frames/state.rate:0,cancelled=hold?.cancel;
    if($('#voice-status'))$('#voice-status').textContent=state?(ready?`正在录音 ${Math.floor(elapsed)} / 60 秒`:'正在请求麦克风权限…'):'语音最长 60 秒';
    const holdButton=$('[data-media=voice-hold]');if(holdButton){holdButton.textContent=state?(cancelled?'松开取消':'松开发送，上滑取消'):'按住说话';holdButton.classList.toggle('recording',!!state)}
    $('[data-media=voice-start]')?.classList.toggle('hidden',!!state);$('[data-media=voice-cancel]')?.classList.toggle('hidden',!state);$('[data-media=voice-finish]')?.classList.toggle('hidden',!state);if($('[data-media=voice-finish]'))$('[data-media=voice-finish]').disabled=!ready;
    if(!state){$('#voice-record-overlay')?.remove();return}
    if(!$('#voice-record-overlay'))document.body.insertAdjacentHTML('beforeend',`<aside id="voice-record-overlay" class="voice-record-overlay" aria-live="polite"><div class="record-wave">${Array.from({length:7},()=>'<i></i>').join('')}</div><b></b><p></p></aside>`);
    const overlay=$('#voice-record-overlay');overlay.classList.toggle('cancelling',!!cancelled);$('b',overlay).textContent=ready?`${Math.floor(elapsed)}″`:'正在请求麦克风权限';$('p',overlay).textContent=cancelled?'松开手指，取消发送':state.held?'松开发送，上滑取消':'录音完成后点击发送';overlay.style.setProperty('--voice-level',String(0.35+Math.min(1,(state.level||0)*8)));
  }
  async function begin(held){
    if(recording||!S.active||!S.user)return;
    if(!navigator.mediaDevices?.getUserMedia||!window.AudioContext&&!window.webkitAudioContext){toast('当前设备不支持录音，请更新 WebView 或检查麦克风');return}
    audio.pause();const state=recording={cid:S.active,userId:S.user.id,held,chunks:[],frames:0,rate:0};renderRecording();
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
      if(recording!==state||document.hidden){stream.getTracks().forEach(t=>t.stop());if(!document.hidden&&S.active===state.cid&&S.user?.id===state.userId){mode=true;mount();toast('麦克风已允许，请重新开始录音')}return}
      state.stream=stream;const Context=window.AudioContext||window.webkitAudioContext;const context=new Context();state.context=context;state.rate=context.sampleRate;await context.resume();
      if(recording!==state){release(state);return}
      state.source=context.createMediaStreamSource(stream);state.processor=context.createScriptProcessor(4096,1,1);state.silence=context.createGain();state.silence.gain.value=0;
      state.processor.onaudioprocess=e=>{if(recording!==state)return;const input=e.inputBuffer.getChannelData(0),remaining=Math.max(0,Math.floor(state.rate*60)-state.frames),data=input.slice(0,Math.min(input.length,remaining));state.chunks.push(data);state.frames+=data.length;let level=0;for(let i=0;i<data.length;i+=16)level+=data[i]*data[i];state.level=Math.sqrt(level/Math.max(1,data.length/16));if(state.frames>=state.rate*60&&!state.limit){state.limit=true;setTimeout(()=>finish(false),0)}};
      state.source.connect(state.processor);state.processor.connect(state.silence);state.silence.connect(context.destination);state.timer=setInterval(renderRecording,150);renderRecording();
      for(const track of stream.getTracks())track.onended=()=>{if(recording===state)finish(true)};
    }catch(error){if(recording===state){recording=null;release(state);renderRecording();toast(error.name==='NotAllowedError'?'未获得麦克风权限，请允许后重新录制':'无法录音：'+error.message)}}
  }
  function release(state){clearInterval(state.timer);if(state.processor)state.processor.onaudioprocess=null;for(const node of [state.source,state.processor,state.silence])try{node?.disconnect()}catch{};state.stream?.getTracks().forEach(t=>{t.onended=null;t.stop()});state.context?.close().catch(()=>{})}
  function wav(state){
    const all=new Float32Array(state.frames);let offset=0;for(const chunk of state.chunks){all.set(chunk,offset);offset+=chunk.length}
    const rate=24000,length=Math.min(rate*60,Math.floor(all.length*rate/state.rate)),buffer=new ArrayBuffer(44+length*2),view=new DataView(buffer),str=(at,text)=>{for(let i=0;i<text.length;i++)view.setUint8(at+i,text.charCodeAt(i))};
    str(0,'RIFF');view.setUint32(4,36+length*2,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,length*2,true);
    const ratio=state.rate/rate;for(let i=0;i<length;i++){const at=i*ratio,start=Math.floor(at),end=Math.min(all.length,Math.max(start+1,Math.floor((i+1)*ratio)));let sample=0;for(let j=start;j<end;j++)sample+=all[j];sample=Math.max(-1,Math.min(1,sample/(end-start)));view.setInt16(44+i*2,sample<0?sample*32768:sample*32767,true)}
    return new File([buffer],'语音-'+Date.now()+'.wav',{type:'audio/wav'});
  }
  function finish(cancel){
    const state=recording;if(!state)return;recording=null;hold=null;release(state);renderRecording();
    if(cancel)return;
    if(!state.rate||state.frames/state.rate<0.7){toast('说话时间太短，请重新录制');return}
    if(!S.user||S.user.id!==state.userId)return;
    sendMedia(wav(state),'voice',{},state.cid).catch(showRetry);
  }
  async function sendMedia(file,kind,metadata={},cid=S.active){
    if(!cid||!S.user)return;if(file.size>50*1024*1024)throw Error('文件不能超过 50 MB');
    const owner=S.user.id,clientId=randomID();let attachment;
    const deliver=async()=>{try{
      if(S.user?.id!==owner)throw Error('登录账号已变化，请重新选择要发送的内容');
      if(!attachment){const form=new FormData();form.append('conversationId',cid);form.append('file',file);form.append('mediaKind',kind);for(const [key,value]of Object.entries(metadata))form.append(key,String(value));toast(kind==='voice'?'正在发送语音…':'正在发送视频…');attachment=await api('/api/files',{method:'POST',body:form})}
      if(S.user?.id!==owner)throw Error('登录账号已变化，请重新选择要发送的内容');
      const m=await action(`/api/conversations/${cid}/messages`,{kind,attachmentId:attachment.id,text:'',clientId});
      if(S.active===cid){if(S.historyMode){S.messages=await api(`/api/conversations/${cid}/messages`);S.historyMode=false}else if(!S.messages.some(x=>x.id===m.id))S.messages.push(m);renderMessages()}queueRefresh();toast('发送成功');return m;
    }catch(error){error.retry=deliver;throw error}};
    return deliver();
  }
  function showRetry(error){if(!S.user){toast(error.message);return}modal('发送未完成',`<p class="hint">${esc(error.message)}。录音或视频暂时保留在本窗口，可以重试发送。</p>`,'<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="media-retry">重试发送</button>');$('#media-retry').onclick=async e=>{e.target.disabled=true;try{await error.retry();closeModal()}catch(next){showRetry(next)}}}
  function videoMetadata(file){return new Promise((resolve,reject)=>{
    const v=document.createElement('video'),url=URL.createObjectURL(file);v.preload='metadata';v.muted=true;let timer,done=false;
    const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);v.onloadedmetadata=v.ondurationchange=v.ontimeupdate=v.onerror=null;v.removeAttribute('src');v.load();URL.revokeObjectURL(url);error?reject(error):resolve(result)};
    const check=()=>{const duration=v.duration;if(Number.isFinite(duration)&&duration>0&&v.videoWidth&&v.videoHeight)finish(null,{durationMs:Math.round(duration*1000),width:v.videoWidth,height:v.videoHeight})};
    v.onloadedmetadata=()=>{check();if(!done&&!Number.isFinite(v.duration))try{v.currentTime=1e10}catch{}};v.ondurationchange=v.ontimeupdate=check;v.onerror=()=>finish(Error('当前设备无法播放这段视频'));timer=setTimeout(()=>finish(Error('无法读取视频信息')),15000);v.src=url;
  })}
  async function sendVideo(file){
    const cid=S.active;if(!cid)return;if(file.size>50*1024*1024){toast('视频不能超过 50 MB');return}
    const fallback=error=>{modal('无法直接发送视频',`<p class="hint">${esc(error.message)}，可以作为普通文件发送给对方。</p>`,'<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="video-send-file">作为文件发送</button>');$('#video-send-file').onclick=()=>{closeModal();if(S.active===cid)upload(file,true);else toast('聊天已切换，请重新选择文件')}};
    let metadata;try{metadata=await videoMetadata(file)}catch(error){fallback(error);return}
    try{await sendMedia(file,'video',metadata,cid)}catch(error){if(error.status===400)fallback(error);else showRetry(error)}
  }
  function sync(){
    document.querySelectorAll('[data-play-voice]').forEach(button=>{const active=playing?.id===button.dataset.playVoice&&!audio.paused;button.classList.toggle('is-playing',active);button.setAttribute('aria-label',(active?'暂停语音':'播放语音')+' '+seconds(button.dataset.duration)+' 秒');if(played().has(button.dataset.playVoice))$('.voice-unplayed',button)?.remove()});
    if(recording&&$('.composer')?.classList.contains('selection-hidden'))finish(true);
  }
  function stopVideo(){if(videoPlayer){videoPlayer.pause();videoPlayer.removeAttribute('src');videoPlayer.load();videoPlayer=null}}
  function reset(){finish(true);audio.pause();playing=null;stopVideo();mode=false;mount()}
  function invalidate(id){if(playing?.messageID===id){audio.pause();audio.removeAttribute('src');audio.load();playing=null}if(videoPlayer?.dataset.messageId===id){stopVideo();if($('.video-viewer'))closeModal()}}
  async function playVoice(button){
    finish(true);stopVideo();const id=button.dataset.playVoice;
    if(playing?.id===id&&!audio.paused){audio.pause();return}
    if(playing?.id!==id){audio.pause();audio.src=fileURL(id);playing={id,messageID:button.dataset.mediaMessage}}
    if(audio.ended)audio.currentTime=0;
    try{await audio.play();if(S.user&&playing?.id===id)markPlayed(id);sync()}catch(error){if(S.user)toast('无法播放语音，请检查网络或下载后播放');sync()}
  }
  function playVideo(button){
    finish(true);audio.pause();stopVideo();modal(button.dataset.mediaName||'视频',`<div class="video-viewer"><video id="message-video-player" controls playsinline preload="metadata" src="${fileURL(button.dataset.playVideo)}"></video><p class="hint">${esc(button.dataset.mediaName||'视频')}</p></div>`,(button.dataset.mediaRoot?'<button class="secondary" data-fw="record-return">返回聊天记录</button>':'')+'<button class="secondary" data-download="'+button.dataset.playVideo+'" data-filename="'+esc(button.dataset.mediaName||'视频')+'">保存视频</button>',true);
    videoPlayer=$('#message-video-player');videoPlayer.dataset.messageId=button.dataset.mediaMessage;videoPlayer.onerror=()=>toast('当前设备无法播放此视频，可保存文件后播放');videoPlayer.play().catch(()=>{});
  }
  for(const type of ['play','pause','ended'])audio.addEventListener(type,sync);
  new MutationObserver(()=>{if(videoPlayer&&!document.contains(videoPlayer))stopVideo()}).observe($('#overlays'),{childList:true,subtree:true});
  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-media],[data-play-voice],[data-play-video]');if(!button)return;
    if(button.dataset.playVoice){playVoice(button);return}if(button.dataset.playVideo){playVideo(button);return}
    switch(button.dataset.media){
      case 'voice-mode':finish(true);mode=!mode;if(mode)$('#composer')?.blur();mount();break;
      case 'voice-start':begin(false);break;case 'voice-cancel':finish(true);break;case 'voice-finish':finish(false);break;
      case 'video':if(window.WeLinkAndroid){modal('发送视频','<button class="remote-choice" id="video-from-gallery">'+icon('folder')+'从相册选择</button><button class="remote-choice" id="video-from-camera">'+icon('video')+'拍摄视频</button><p class="hint">支持 MP4、WebM，单个文件不超过 50 MB。</p>');$('#video-from-gallery').onclick=()=>{closeModal();$('#video-input').click()};$('#video-from-camera').onclick=()=>{closeModal();$('#video-capture-input').click()}}else $('#video-input').click();break;
    }
  });
  document.addEventListener('pointerdown',e=>{const button=e.target.closest('[data-media=voice-hold]');if(!button||e.button!==0)return;e.preventDefault();hold={pointer:e.pointerId,y:e.clientY,cancel:false};button.setPointerCapture(e.pointerId);begin(true)});
  document.addEventListener('pointermove',e=>{if(hold&&hold.pointer===e.pointerId){hold.cancel=e.clientY<hold.y-60;renderRecording()}});
  document.addEventListener('pointerup',e=>{if(hold&&hold.pointer===e.pointerId){const cancel=hold.cancel;hold=null;finish(cancel)}});
  document.addEventListener('pointercancel',()=>{if(hold){hold=null;finish(true)}});
  document.addEventListener('click',e=>{if(e.target.closest('[data-nav],[data-conversation],[data-action=back],[data-action=logout]'))reset()},true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)reset()});window.addEventListener('blur',()=>finish(true));
  window.WeLinkMediaBackground=reset;
  window.WeLinkMediaBeforeModal=()=>finish(true);
  return {bubble,tools,input,mount,reset,invalidate,sync,sendVideo};
}
