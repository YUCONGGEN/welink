// Analyse the existing microphone track, following YuDesk's meeting meter.
export function microphoneMeter(track,node){
 if(!track||!node)return null;
 let context,source,analyser,frame=0,last=0,level=0,closed=false;
 const bars=[...node.children],history=Array(bars.length).fill(0),values=new Float32Array(512);
 const display=value=>{node.dataset.level=String(Math.round(value*100));node.setAttribute('aria-valuenow',String(Math.round(value*100)));if(value<=0)history.fill(0);else{history.shift();history.push(value)}bars.forEach((bar,i)=>{bar.style.height=Math.max(15,history[i]*100)+'%';bar.classList.toggle('active',history[i]>.02)})};
 try{context=new(window.AudioContext||window.webkitAudioContext)();source=context.createMediaStreamSource(new MediaStream([track]));analyser=context.createAnalyser();analyser.fftSize=512;source.connect(analyser);context.resume().catch(()=>{});
  const draw=time=>{if(closed)return;frame=requestAnimationFrame(draw);if(time-last<90)return;last=time;analyser.getFloatTimeDomainData(values);let sum=0;for(const value of values)sum+=value*value;const sample=Math.max(0,Math.min(1,(20*Math.log10(Math.max(Math.sqrt(sum/values.length),.000001))+60)/60));level=track.enabled&&track.readyState==='live'?Math.max(sample,level*.65):0;display(level)};frame=requestAnimationFrame(draw);
 }catch{source?.disconnect();context?.close().catch(()=>{});display(0);return null}
 return {track,close(){if(closed)return;closed=true;cancelAnimationFrame(frame);source.disconnect();analyser.disconnect();context.close().catch(()=>{});display(0)}};
}
