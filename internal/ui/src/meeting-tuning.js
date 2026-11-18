// Meeting uplink policy. Bandwidth is not capped: maxBitrate is set far above
// what a screen or camera needs, so WebRTC congestion control (the real
// network) is the only limit. Screen sharing keeps the full resolution and
// 30 fps and is encoded for text, so the shared screen is rebuilt sharply.
const SCREEN_BITRATE=100000000,CAMERA_BITRATE=20000000;
export function videoBudget(screen){return screen?SCREEN_BITRATE:CAMERA_BITRATE}
export async function tuneMeetingPeer(peer,screen,peers){
 if(peer.tuning||peer.pc.signalingState==='closed')return;
 const bitrate=videoBudget(screen,peers),key=String(screen);
 if(peer.tuningKey===key)return;peer.tuning=true;let complete=true;
 try{for(const sender of peer.pc.getSenders()){
  if(!sender.track||!sender.getParameters)continue;
  try{const p=sender.getParameters();if(!p.encodings?.length){complete=false;continue}
   for(const e of p.encodings){if(sender.track.kind==='audio'){e.maxBitrate=128000;if('priority'in e)e.priority='high';if('networkPriority'in e)e.networkPriority='high'}else{e.maxBitrate=Math.round(bitrate/p.encodings.length);e.maxFramerate=30;e.scaleResolutionDownBy=1;if(screen){if('priority'in e)e.priority='high';if('networkPriority'in e)e.networkPriority='high'}}}
   if(sender.track.kind==='video')p.degradationPreference=screen?'maintain-resolution':'maintain-framerate';
   await sender.setParameters(p);
  }catch{complete=false}
 }}finally{if(complete)peer.tuningKey=key;peer.tuning=false}
}
// Play received video as soon as it is decoded instead of buffering for
// smoothness: the shared screen follows the presenter with minimal delay.
export function lowLatencyReceiver(receiver){
 if(!receiver||receiver.track?.kind!=='video')return;
 try{if('jitterBufferTarget'in receiver)receiver.jitterBufferTarget=0}catch{}
 try{if('playoutDelayHint'in receiver)receiver.playoutDelayHint=0}catch{}
}
