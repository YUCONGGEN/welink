import fs from 'node:fs/promises';

const rate=22050;
function wav(samples){
  const pcm=Buffer.alloc(samples.length*2);
  for(let i=0;i<samples.length;i++)pcm.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(samples[i]*32767))),i*2);
  const out=Buffer.alloc(44+pcm.length);out.write('RIFF',0);out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);
  out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(pcm.length,40);pcm.copy(out,44);return out;
}
function signal(seconds,mix){const samples=new Float64Array(Math.round(rate*seconds));for(let i=0;i<samples.length;i++)samples[i]=mix(i/rate);return samples}
const invite=signal(2.6,t=>{let value=0;for(const [frequency,start,length] of [[493.88,0,.48],[587.33,.68,.48],[659.25,1.36,.72]]){const local=t-start;if(local<0||local>=length)continue;const envelope=Math.min(1,local/.055,(length-local)/.14);value+=.17*envelope*(Math.sin(2*Math.PI*frequency*local)+.18*Math.sin(4*Math.PI*frequency*local))}return value});
// Two short, bright pulses with a clear gap: the familiar QQ-style "滴滴" cue.
const message=signal(.56,t=>{let value=0;for(const [frequency,start,length] of [[1046.5,0,.13],[880,.19,.16]]){const local=t-start;if(local<0||local>=length)continue;const attack=Math.min(1,local/.008),release=Math.min(1,(length-local)/.045);const envelope=attack*release;value+=.22*envelope*(Math.sin(2*Math.PI*frequency*local)+.24*Math.sin(4*Math.PI*frequency*local))}return value});
for(const [path,data] of [
  ['cmd/welink/resources/ringtone.wav',wav(invite)],['mobile/android/app/src/main/res/raw/linkme_ringtone.wav',wav(invite)],
  ['cmd/welink/resources/message_beep.wav',wav(message)],['mobile/android/app/src/main/res/raw/linkme_message.wav',wav(message)]
]){await fs.mkdir(path.slice(0,path.lastIndexOf('/')),{recursive:true});await fs.writeFile(path,data)}
console.log('Created LinkMe invitation ringtone and QQ-style message beep');
