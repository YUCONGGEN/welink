// App self-update from the user's own LinkMe server. The local client checks
// the server's signed release at start and every few hours and downloads a
// newer version in the background; this module shows a banner once it is
// ready and installs it on request (Windows/macOS restart LinkMe; Android
// opens the system installer).
export function createUpdates({S,api,action,esc,toast}){
 let timer,shown='';
 const supported=()=>['windows','darwin','android'].includes(S.config?.platform);
 async function poll(){clearTimeout(timer);if(!S.user||!supported())return;try{render(await api('/local/update'))}catch{}timer=setTimeout(poll,10*60*1000)}
 function render(st){
  let bar=document.getElementById('update-banner');
  if(st.state!=='ready'||!st.latest){bar?.remove();shown='';return}
  if(shown===st.latest&&bar)return;shown=st.latest;
  if(!bar){bar=document.createElement('div');bar.id='update-banner';bar.setAttribute('role','status');document.body.append(bar)}
  bar.innerHTML='<span>新版本 '+esc(st.latest)+' 已下载'+(S.config.platform==='android'?'':'，重启后完成更新')+'</span><button data-update-apply>立即更新</button><button class="dismiss" data-update-later aria-label="稍后">稍后</button>';
 }
 async function apply(){
  const result=await action('/local/update/apply',{});
  if(result.apk){if(!window.WeLinkAndroid?.installUpdate)throw Error('当前版本不支持应用内安装，请从下载页安装');window.WeLinkAndroid.installUpdate(result.apk);return}
  if(result.exit){toast('正在更新，LinkMe 将自动重新打开');setTimeout(()=>{if(window.welinkDesktopExit)window.welinkDesktopExit()},600)}
 }
 // Settings: "检查更新".
 async function check(button){if(!supported()){toast('当前设备不支持自动更新');return}button&&(button.disabled=true);try{let st=await api('/local/update?check=1');for(let i=0;i<20&&st.state==='checking';i++){await new Promise(r=>setTimeout(r,500));st=await api('/local/update')}
   if(st.state==='downloading')toast('正在下载新版本 '+st.latest+'，完成后会提示你更新');else if(st.state==='ready')render(st);else if(st.state==='failed')toast(st.error||'检查更新失败');else toast('已是最新版本');if(st.state==='downloading')setTimeout(poll,15000)}catch(e){toast(e.message)}finally{button&&(button.disabled=false)}}
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-update-apply],[data-update-later],[data-update-check]');if(!b)return;try{if(b.hasAttribute('data-update-later'))document.getElementById('update-banner')?.remove();else if(b.hasAttribute('data-update-check'))await check(b);else{b.disabled=true;await apply()}}catch(err){toast(err.message);b.disabled=false}});
 return {start(){timer=setTimeout(poll,30*1000)},stop(){clearTimeout(timer);document.getElementById('update-banner')?.remove();shown=''},check};
}
