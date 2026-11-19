// Live captions in meetings. Each participant's device turns their own speech
// into text (the browser's speech recognition, or short recordings sent to
// the server where the browser has none) and sends it through the meeting
// room; everyone sees the lines, and the final ones become the minutes.
export function createCaptions({send,toast,esc,api,code,stream,box}){
 const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
 let on=false,rec=null,recorder=null,interimAt=0,lastInterim='',failed=false;
 const lines=new Map();
 function draw(){
  const el=box();if(!el)return;const now=Date.now();
  for(const [id,l] of lines)if(now-l.at>(l.final?7000:4000))lines.delete(id);
  el.classList.toggle('hidden',!on||!lines.size);
  el.innerHTML=[...lines.values()].slice(-3).map(l=>`<p><b>${esc(l.name)}：</b>${esc(l.text)}</p>`).join('');
 }
 const tick=setInterval(draw,1000);
 function show(m){lines.set(m.id,{name:m.name,text:m.text,final:!!m.final,at:Date.now()});draw()}
 function emit(text,final){text=text.trim();if(!text)return;send({type:'caption',text:text.slice(0,400),final})}
 function startRecognition(){
  rec=new Recognition();rec.lang='zh-CN';rec.continuous=true;rec.interimResults=true;
  rec.onresult=e=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const r=e.results[i];if(r.isFinal){emit(r[0].transcript,true);lastInterim=''}else interim+=r[0].transcript}
   if(interim&&interim!==lastInterim&&Date.now()-interimAt>500){interimAt=Date.now();lastInterim=interim;emit(interim,false)}};
  rec.onerror=e=>{
   if(e.error==='not-allowed'){failed=true;toast('无法使用语音识别，请允许麦克风权限');stop();return}
   // No speech service here (offline, blocked or unsupported): record and let the server transcribe.
   if(['network','service-not-allowed','language-not-supported','audio-capture'].includes(e.error)){failed=true;try{rec.onend=null;rec.stop()}catch{}rec=null;if(on)startRecording()}
  };
  rec.onend=()=>{if(on&&!failed)setTimeout(()=>{try{rec?.start()}catch{}},250)};
  try{rec.start()}catch{}
 }
 function startRecording(){
  const track=stream()?.getAudioTracks()[0];if(!track||typeof MediaRecorder!=='function'){toast('此设备不支持字幕');stop();return}
  const audio=new MediaStream([track.clone()]);let chunks=[];
  const cycle=()=>{
   if(!on)return;recorder=new MediaRecorder(audio,MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?{mimeType:'audio/webm;codecs=opus'}:{});chunks=[];
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
   recorder.onstop=async()=>{const blob=new Blob(chunks,{type:'audio/webm'});if(on)cycle();if(blob.size<3000||!track.enabled)return;
    const form=new FormData();form.append('audio',blob,'speech.webm');
    try{const r=await api(`/api/meetings/${code()}/transcribe`,{method:'POST',body:form});if(r.text)emit(r.text,true)}catch(e){if(e.status===501||e.status===502){toast(e.message);failed=true;stop(true)}}};
   recorder.start();setTimeout(()=>{if(recorder?.state==='recording')recorder.stop()},6000);
  };
  cycle();
  recorder&&(recorder.audioStream=audio);
 }
 function start(){if(on)return;on=true;failed=false;if(Recognition)startRecognition();else startRecording();toast('字幕已开启：你的发言会转为文字，会议结束后自动生成纪要');draw()}
 function stop(keepDisplay=false){
  if(!keepDisplay)on=false;try{rec&&(rec.onend=null,rec.stop())}catch{}rec=null;
  try{if(recorder?.state==='recording')recorder.stop();recorder?.audioStream?.getTracks().forEach(t=>t.stop())}catch{}recorder=null;draw();
 }
 return {show,toggle(){if(on)stop();else start();return on},stop(){stop();clearInterval(tick)},get on(){return on}};
}
