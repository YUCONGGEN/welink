// Remote picture renderer, ported from YuDesk internal/stream/browser/frames.js.
// The local client long-polls /local/remote/tiles?after=N and answers with the
// union of tiles changed since revision N:
//   [u32 JSON length][u32 payload length][JSON TileFrame][tile bytes...]
// Tiles decode in up to eight parallel createImageBitmap slots while the body
// is still streaming; all of them are drawn to the canvas at once. The next
// request starts only after painting, so a slow page skips stale versions
// instead of queueing them.

class ByteReader {
 constructor(reader){this.reader=reader;this.chunk=new Uint8Array(0);this.offset=0}
 async read(size){
  const result=new Uint8Array(size);let offset=0;
  while(offset<size){
   if(this.offset===this.chunk.length){const next=await this.reader.read();if(next.done)throw Error('画面传输已断开');this.chunk=next.value;this.offset=0}
   const count=Math.min(size-offset,this.chunk.length-this.offset);
   result.set(this.chunk.subarray(this.offset,this.offset+count),offset);offset+=count;this.offset+=count;
  }
  return result;
 }
 async header(){
  const sizes=new DataView((await this.read(8)).buffer),header=sizes.getUint32(0),size=sizes.getUint32(4);
  if(header<1||header>1048576||size>33554432)throw Error('画面数据长度无效');
  return {meta:JSON.parse(new TextDecoder().decode(await this.read(header))),size};
 }
 async finish(){
  if(this.offset!==this.chunk.length)throw Error('画面包含多余数据');
  const next=await this.reader.read();if(!next.done)throw Error('画面包含多余数据');
 }
}

function validate(meta,size){
 if(meta.tileSize!==undefined&&![128,256].includes(meta.tileSize))throw Error('画面分块尺寸无效');
 if(!Number.isInteger(meta.width)||!Number.isInteger(meta.height)||meta.width<1||meta.height<1||meta.width>16384||meta.height>16384||meta.width*meta.height>33177600||!Array.isArray(meta.tiles)||meta.tiles.length>1024)throw Error('画面尺寸无效');
 let total=0;
 for(const t of meta.tiles){
  if(![t.x,t.y,t.w,t.h,t.size].every(Number.isInteger)||t.x<0||t.y<0||t.w<1||t.h<1||t.x+t.w>meta.width||t.y+t.h>meta.height||t.size<1||!['image/png','image/jpeg'].includes(t.mime))throw Error('画面区域无效');
  total+=t.size;
 }
 if(total!==size)throw Error('画面数据不完整');
}

function decodeImage(part,mime){
 const blob=new Blob([part],{type:mime});
 if(window.createImageBitmap)return createImageBitmap(blob);
 return new Promise((resolve,reject)=>{const url=URL.createObjectURL(blob),image=new Image();image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};image.onerror=()=>{URL.revokeObjectURL(url);reject(Error('无法解码远程画面'))};image.src=url});
}

async function paintStream(canvas,stream,meta,size,shouldPaint){
 validate(meta,size);
 if(!meta.reset&&(canvas.width!==meta.width||canvas.height!==meta.height))throw Error('需要重新同步画面');
 // Only one read may own the byte cursor, even with eight decoders.
 let readTail=Promise.resolve();
 const readTile=t=>{const part=readTail.then(()=>stream.read(t.size));readTail=part;return part};
 const images=[];let index=0,failure;
 try{
  const decode=async()=>{
   while(index<meta.tiles.length&&!failure){
    const i=index++,t=meta.tiles[i];
    try{const bitmap=await readTile(t).then(part=>decodeImage(part,t.mime));images[i]={t,bitmap};if((bitmap.width||bitmap.naturalWidth)!==t.w||(bitmap.height||bitmap.naturalHeight)!==t.h)throw Error('画面区域尺寸不匹配')}
    catch(error){failure=error}
   }
  };
  await Promise.all(Array.from({length:Math.min(8,meta.tiles.length)},decode));
  if(failure)throw failure;
  await stream.finish();
  if(!shouldPaint())return false;
  // Resize only after a successful decode; a reset replaces every tile.
  if(canvas.width!==meta.width)canvas.width=meta.width;
  if(canvas.height!==meta.height)canvas.height=meta.height;
  const ctx=canvas.getContext('2d',{alpha:false});
  for(const {t,bitmap} of images)ctx.drawImage(bitmap,t.x,t.y);
  canvas.dataset.width=String(meta.width);canvas.dataset.height=String(meta.height);
  return true;
 }finally{for(const image of images)image?.bitmap.close?.()}
}

// runRemoteFrames paints until live() turns false. onFrame runs after each
// painted update; onError receives repeated failures.
// endpoint serves the same format for another picture (meeting screen share).
export async function runRemoteFrames(canvas,live,onFrame,onError,endpoint='/local/remote/tiles'){
 let revision=0,failures=0;
 while(live()){
  let reader,failed=false;
  try{
   const response=await fetch(endpoint+'?after='+revision,{cache:'no-store'});
   if(!live())return;
   if(response.status===204){failures=0;continue}
   if(!response.ok)throw Error('远程画面暂时不可用');
   reader=response.body.getReader();const stream=new ByteReader(reader);
   const {meta,size}=await stream.header();
   if(!Number.isSafeInteger(meta.revision)||meta.revision<1)throw Error('画面版本无效');
   const painted=await paintStream(canvas,stream,meta,size,live);
   if(painted===false)return;
   revision=meta.revision;failures=0;onFrame?.(meta);
  }catch(error){
   failed=true;revision=0;
   if(!live())return;
   if(++failures>=20){onError?.(error);return}
  }finally{if(reader){if(failed)await reader.cancel().catch(()=>{});reader.releaseLock()}}
  if(failed)await new Promise(resolve=>setTimeout(resolve,150));
 }
}
