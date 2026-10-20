import fs from 'node:fs/promises';

const rate=22050,seconds=2.6,total=rate*seconds;
const notes=[[493.88,0,.48],[587.33,.68,.48],[659.25,1.36,.72]];
const pcm=Buffer.alloc(total*2);
for(let i=0;i<total;i++){
  const t=i/rate;let value=0;
  for(const [frequency,start,length] of notes){
    const local=t-start;if(local<0||local>=length)continue;
    const envelope=Math.min(1,local/.055,(length-local)/.14);
    value+=.17*envelope*(Math.sin(2*Math.PI*frequency*local)+.18*Math.sin(4*Math.PI*frequency*local));
  }
  pcm.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(value*32767))),i*2);
}
const wav=Buffer.alloc(44+pcm.length);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
for(const path of ['cmd/welink/resources/ringtone.wav','mobile/android/app/src/main/res/raw/linkme_ringtone.wav']){
  await fs.mkdir(path.slice(0,path.lastIndexOf('/')),{recursive:true});
  await fs.writeFile(path,wav);
}
console.log('Created the soft LinkMe invitation ringtone');
