// YuDesk uplink policy: reserve capacity for audio and bound mesh fan-out.
export function videoBudget(screen,peers,available=0){
 const count=Math.max(1,peers),floor=screen?500000:300000,emergency=screen?250000:150000,ceiling=screen?3500000:1500000,total=screen?8000000:4000000;
 let target=Math.max(floor,Math.min(ceiling,Math.round(total/count)));
 if(available>0)target=Math.min(target,Math.max(emergency,available*.82));
 return Math.max(emergency,Math.round(target));
}
export async function tuneMeetingPeer(peer,screen,peers){
 if(peer.tuning||peer.pc.signalingState==='closed')return;
 const bitrate=videoBudget(screen,peers,peer.route?.available),key=screen+':'+Math.round(bitrate/100000);
 if(peer.tuningKey===key)return;peer.tuning=true;let complete=true;
 try{for(const sender of peer.pc.getSenders()){
  if(!sender.track||!sender.getParameters)continue;
  try{const p=sender.getParameters();if(!p.encodings?.length){complete=false;continue}
   for(const e of p.encodings){if(sender.track.kind==='audio'){e.maxBitrate=64000;if('priority'in e)e.priority='high';if('networkPriority'in e)e.networkPriority='high'}else{e.maxBitrate=Math.round(bitrate/p.encodings.length);e.maxFramerate=screen?30:24}}
   if(sender.track.kind==='video')p.degradationPreference=screen?'maintain-resolution':'maintain-framerate';
   await sender.setParameters(p);
  }catch{complete=false}
 }}finally{if(complete)peer.tuningKey=key;peer.tuning=false}
}
