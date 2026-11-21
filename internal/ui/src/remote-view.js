// Sharp presentation of the remote picture, ported from YuDesk
// internal/stream/browser/display.js and resample.js.
//
// The browser's own canvas scaling is bilinear and its flex centering can
// start the picture on half a device pixel, which smears one-pixel text
// strokes over two pixels. fitRemoteView sizes the canvas in whole device
// pixels and aligns its origin to the physical pixel grid. When the picture
// is not shown 1:1, a WebGL Lanczos3 scaler (each pass at most 2:1, clamped
// when enlarging so gray UI text gets no halo) draws a device-resolution copy
// over the canvas. Input keeps using the canvas, which stays in place
// underneath with the same box.

function passes(width,height,targetWidth,targetHeight){
 const result=[];
 for(const axis of [0,1]){
  const target=axis?targetHeight:targetWidth;
  while((axis?height:width)!==target){
   const size=axis?height:width,next=size>target*2?Math.ceil(size/2):target;
   result.push({width:axis?width:next,height:axis?next:height,axis});
   if(axis)height=next;else width=next;
  }
 }
 return result;
}
function kernel(source,target){
 const values=new Float32Array(target*12),scale=Math.min(1,target/source);
 const sinc=x=>Math.abs(x)<.0001?1:Math.sin(Math.PI*x)/(Math.PI*x);
 for(let x=0;x<target;x++){
  const p=(x+.5)*source/target-.5,base=Math.floor(p),weights=[];let sum=0;
  for(let i=0;i<12;i++){const d=(base+i-5-p)*scale,w=Math.abs(d)<3?sinc(d)*sinc(d/3):0;weights.push(w);sum+=w}
  for(let i=0;i<12;i++)values[Math.floor(i/4)*target*4+x*4+i%4]=weights[i]/sum;
 }
 return values;
}
const vertex='attribute vec2 position;varying vec2 uv;void main(){uv=(position+1.0)*0.5;gl_Position=vec4(position,0.0,1.0);}';
const fragment=`precision highp float;
varying vec2 uv;uniform sampler2D image;uniform sampler2D kernelWeights;uniform vec2 sourceSize;uniform vec2 targetSize;uniform vec2 axis;uniform float flipY;
vec4 pixel(vec2 p){p=clamp(p,vec2(0.0),sourceSize-1.0);if(flipY>0.5)p.y=sourceSize.y-1.0-p.y;return texture2D(image,(p+0.5)/sourceSize);}
void main(){
 vec2 p=uv*sourceSize-0.5;float ratio=dot(targetSize/sourceSize,axis);
 float base=floor(dot(p,axis));vec4 sum=vec4(0.0);
 float u=dot(uv,axis);vec4 a0=texture2D(kernelWeights,vec2(u,1.0/6.0)),a1=texture2D(kernelWeights,vec2(u,0.5)),a2=texture2D(kernelWeights,vec2(u,5.0/6.0));
 for(int i=0;i<12;i++){
  float offset=float(i)-5.0,w=i<4?a0[i]:i<8?a1[i-4]:a2[i-8];
  sum+=pixel(p+axis*(base+offset-dot(p,axis)))*w;
 }
 vec4 color=sum;
 if(ratio>1.0){vec4 a=pixel(p+axis*(base-dot(p,axis))),b=pixel(p+axis*(base+1.0-dot(p,axis)));color=clamp(color,min(a,b),max(a,b));}
 gl_FragColor=vec4(clamp(color.rgb,0.0,1.0),1.0);
}`;

class GPUScaler{
 constructor(canvas){
  this.canvas=canvas;const gl=this.gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:'high-performance'});
  if(!gl||!gl.getExtension('OES_texture_float'))throw Error('GPU scaling unavailable');this.kernels=new Map();
  const shader=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const m=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error(m)}return s};
  const program=this.program=gl.createProgram(),v=shader(gl.VERTEX_SHADER,vertex),f=shader(gl.FRAGMENT_SHADER,fragment);
  gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);gl.deleteShader(v);gl.deleteShader(f);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const location=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
  this.sourceUniform=gl.getUniformLocation(program,'sourceSize');this.targetUniform=gl.getUniformLocation(program,'targetSize');this.axisUniform=gl.getUniformLocation(program,'axis');this.flipUniform=gl.getUniformLocation(program,'flipY');
  const texture=()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);return t};
  this.texture=texture;
  this.slots=Array.from({length:3},()=>({texture:texture(),framebuffer:gl.createFramebuffer(),width:0,height:0}));
  gl.uniform1i(gl.getUniformLocation(program,'image'),0);gl.uniform1i(gl.getUniformLocation(program,'kernelWeights'),1);this.maxSize=gl.getParameter(gl.MAX_TEXTURE_SIZE);
 }
 weights(source,target){
  const gl=this.gl,key=source+':'+target;let t=this.kernels.get(key);
  if(!t){
   if(this.kernels.size>=16){const first=this.kernels.keys().next().value;gl.deleteTexture(this.kernels.get(first));this.kernels.delete(first)}
   t=this.texture();gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,target,3,0,gl.RGBA,gl.FLOAT,kernel(source,target));this.kernels.set(key,t);
  }
  gl.bindTexture(gl.TEXTURE_2D,t);
 }
 draw(image,width,height){
  const gl=this.gl,sw=image.width,sh=image.height;
  if(gl.isContextLost()||Math.max(sw,sh,width,height)>this.maxSize)throw Error('GPU scaling size unavailable');
  const jobs=passes(sw,sh,width,height);if(!jobs.length)throw Error('identity needs no scaling');
  const source=this.slots[0];gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,source.texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
  if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
  gl.useProgram(this.program);let input=source,iw=sw,ih=sh;
  jobs.forEach((job,i)=>{
   const last=i===jobs.length-1,out=last?null:this.slots[1+i%2];
   gl.bindFramebuffer(gl.FRAMEBUFFER,out?.framebuffer||null);
   if(out){gl.bindTexture(gl.TEXTURE_2D,out.texture);if(out.width!==job.width||out.height!==job.height){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,job.width,job.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);out.width=job.width;out.height=job.height}gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,out.texture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('GPU scaling framebuffer unavailable')}
   gl.activeTexture(gl.TEXTURE1);this.weights(job.axis?ih:iw,job.axis?job.height:job.width);gl.activeTexture(gl.TEXTURE0);
   gl.viewport(0,0,job.width,job.height);gl.bindTexture(gl.TEXTURE_2D,input.texture);gl.uniform2f(this.sourceUniform,iw,ih);gl.uniform2f(this.targetUniform,job.width,job.height);gl.uniform2f(this.axisUniform,job.axis?0:1,job.axis?1:0);gl.uniform1f(this.flipUniform,i===0?1:0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
   input=out;iw=job.width;ih=job.height;
  });
  gl.flush();return jobs.length;
 }
 close(){const gl=this.gl;for(const s of this.slots){gl.deleteTexture(s.texture);gl.deleteFramebuffer(s.framebuffer)}for(const t of this.kernels.values())gl.deleteTexture(t);gl.deleteBuffer(this.buffer);gl.deleteProgram(this.program);gl.getExtension('WEBGL_lose_context')?.loseContext()}
}

// Presenter draws the scaled copy synchronously on the main thread, one
// frame at a time; the newest frame wins while one is being drawn.
class Presenter{
 constructor(source){
  this.source=source;this.container=source.parentElement;this.failed=false;this.closed=false;
  this.output=document.createElement('canvas');this.output.className='resampled-view';this.output.setAttribute('aria-hidden','true');this.output.hidden=true;
  Object.assign(this.output.style,{position:'absolute',pointerEvents:'none',maxWidth:'none',maxHeight:'none',margin:'0',padding:'0',border:'0',flex:'none',zIndex:'0'});
  this.container.append(this.output);
 }
 fail(){this.failed=true;this.output.hidden=true;this.source.style.opacity='';this.source.dataset.resampling='browser';}
 update(nativePixels,newFrame){
  if(this.closed)return;
  const source=this.source,box=source.getBoundingClientRect(),parent=this.container.getBoundingClientRect(),dpr=Number(window.devicePixelRatio)||1;
  const width=Math.max(1,Math.round(box.width*dpr)),height=Math.max(1,Math.round(box.height*dpr));
  const key=[source.width,source.height,width,height].join(':'),changed=key!==this.key||newFrame;this.key=key;
  const enabled=!nativePixels&&source.dataset.ready==='1'&&(width!==source.width||height!==source.height);
  Object.assign(this.output.style,{left:box.left-parent.left-this.container.clientLeft+this.container.scrollLeft+'px',top:box.top-parent.top-this.container.clientTop+this.container.scrollTop+'px',width:box.width+'px',height:box.height+'px'});
  if(!enabled||this.failed){this.output.hidden=true;source.style.opacity='';if(!this.failed)source.dataset.resampling=nativePixels?'native':'identity';return}
  if(!changed&&!this.output.hidden)return;
  try{
   this.scaler??=new GPUScaler(this.output);
   const started=performance.now(),count=this.scaler.draw(source,width,height);
   const ms=performance.now()-started;this.output.hidden=false;source.style.opacity='0';source.dataset.resampling='lanczos3';source.dataset.resamplePasses=String(count);source.dataset.resampleMs=ms.toFixed(2);
   // Without real GPU acceleration the scaler would hold up every frame:
   // fall back to the browser's scaling rather than add latency.
   this.slow=ms>SLOW_DRAW?(this.slow||0)+1:0;if(this.slow>=SLOW_FRAMES)this.fail();
  }catch{this.fail()}
 }
 close(){this.closed=true;this.scaler?.close();this.output.remove();this.source.style.opacity=''}
}

const SLOW_DRAW=20,SLOW_FRAMES=5;
const fitted=new WeakMap(),presenters=new WeakMap();

// fitRemoteView sizes canvas inside container. nativePixels shows every
// remote pixel on exactly one device pixel; otherwise the picture fills the
// container keeping its aspect ratio. newFrame redraws the scaled copy.
export function fitRemoteView(canvas,container,actualSize=false,newFrame=false){
 if(!canvas||!container||canvas.width<1||canvas.height<1)return;
 canvas.dataset.ready='1';
 const dpr=Math.max(.1,Number(window.devicePixelRatio)||1),width=Math.max(1,container.clientWidth),height=Math.max(1,container.clientHeight),bounds=container.getBoundingClientRect();
 const key=[canvas.width,canvas.height,width,height,dpr,actualSize,bounds.left,bounds.top,container.scrollLeft,container.scrollTop].join(':');
 let nativePixels=fitted.get(canvas)?.nativePixels??actualSize;
 if(fitted.get(canvas)?.key!==key){
  const left=Math.ceil((bounds.left+container.clientLeft)*dpr),top=Math.ceil((bounds.top+container.clientTop)*dpr),right=Math.floor((bounds.left+container.clientLeft+width)*dpr),bottom=Math.floor((bounds.top+container.clientTop+height)*dpr);
  const fit=Math.min(Math.max(1,right-left)/canvas.width,Math.max(1,bottom-top)/canvas.height);
  // Within a few device pixels of 1:1, show the exact pixels (an edge loses
  // at most two) instead of resampling the whole picture by a hair.
  nativePixels=actualSize||Math.abs(fit-1)*Math.max(canvas.width,canvas.height)<=4;
  const scale=nativePixels?1/dpr:fit/dpr;
  canvas.style.width=canvas.width*scale+'px';canvas.style.height=canvas.height*scale+'px';canvas.style.maxWidth='none';canvas.style.maxHeight='none';canvas.style.flex='none';canvas.style.position='relative';canvas.style.left='0px';canvas.style.top='0px';canvas.style.transform='none';
  canvas.style.imageRendering=Math.abs(scale*dpr-1)<1e-6?'pixelated':'auto';
  // Chromium rounds the raster origin to CSS pixels before compositing:
  // set an integer CSS origin first, then align to physical pixels (also at
  // fractional Windows display scaling).
  const box=canvas.getBoundingClientRect();
  canvas.style.left=(Math.round(box.left)-box.left)+'px';canvas.style.top=(Math.round(box.top)-box.top)+'px';
  const origin=canvas.getBoundingClientRect();
  let px=Math.round(origin.left*dpr),py=Math.round(origin.top*dpr);
  if(!nativePixels){px=Math.max(left,Math.min(Math.floor(right-origin.width*dpr+1e-4),px));py=Math.max(top,Math.min(Math.floor(bottom-origin.height*dpr+1e-4),py))}
  const x=px/dpr-origin.left,y=py/dpr-origin.top;
  canvas.style.transform=x||y?`translate(${x}px,${y}px)`:'none';
  fitted.set(canvas,{key,nativePixels});newFrame=true;
 }
 let presenter=presenters.get(canvas);
 if(!presenter&&!nativePixels){presenter=new Presenter(canvas);presenters.set(canvas,presenter)}
 if(presenter)presenter.update(nativePixels,newFrame);else canvas.dataset.resampling='native';
}

export function disposeRemoteView(canvas){presenters.get(canvas)?.close();presenters.delete(canvas);fitted.delete(canvas)}
export const remoteViewInternals={passes,kernel};
