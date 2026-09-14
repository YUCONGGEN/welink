import {CLIENT_VERSION,authShowcase} from './branding.js';
export function createQRLogin({action,S,modal,toast,esc,enter,renderAuth,windows,logo,icon}) {
 let active=null,phonePending=null;
 const el=id=>document.getElementById(id);
 function stop(){if(!active)return;const previous=active;active=null;clearTimeout(previous.timer);if(previous.id)action('/api/auth/qr/cancel',{id:previous.id,pollSecret:previous.pollSecret}).catch(()=>{})}
 async function open(){
  stop();const current={timer:null};active=current;
  el('app').innerHTML=`<main class="auth-shell">${windows()}${authShowcase()}<section class="auth-card qr-auth">${logo()}<h2>扫码登录</h2><p class="subtitle">使用安卓 WeLink「扫一扫」</p><div class="qr-image" id="qr-image"><span>正在生成二维码…</span></div><p class="qr-status" id="qr-status">请在手机上登录你的 WeLink 账号</p><p class="qr-check" id="qr-check"></p><div class="auth-error" id="auth-error"></div><button class="primary" id="qr-refresh">刷新二维码</button><div class="auth-links"><button data-action="login">密码登录</button>${S.registrationEnabled?'<button data-action="register">注册账号</button>':''}</div><p class="auth-consent">扫码后请在手机上确认<br>二维码 3 分钟内有效，仅可使用一次</p></section><small class="auth-footer">WeLink ${CLIENT_VERSION}</small></main>`;
  el('qr-refresh').onclick=open;
  try{const q=await action('/api/auth/qr',{device:'WeLink Windows 客户端'});if(active!==current){action('/api/auth/qr/cancel',q).catch(()=>{});return}Object.assign(current,q);el('qr-image').innerHTML=`<img alt="WeLink 桌面登录二维码" src="${q.image}">`;el('qr-check').textContent='核对码 '+q.checkCode;await poll(current)}catch(e){if(active===current)el('auth-error').textContent=e.message}
 }
 async function poll(current){if(active!==current)return;try{const result=await action('/api/auth/qr/poll',{id:current.id,pollSecret:current.pollSecret});if(active!==current)return;if(result.token){active=null;S.token=result.token;S.user=result.user;localStorage.setItem('welink_token',S.token);await enter();return}const ended=result.state==='expired'||result.state==='rejected';el('qr-status').textContent=result.state==='scanned'?'扫码成功，请在手机上确认':result.state==='expired'?'二维码已过期，请刷新':result.state==='rejected'?'手机已取消登录，请刷新':'请使用安卓 WeLink 扫描二维码';el('qr-image').classList.toggle('qr-inactive',ended);if(!ended)current.timer=setTimeout(()=>poll(current),1200)}catch(e){if(active===current){el('auth-error').textContent=e.message;if(e.status===404){el('qr-status').textContent='二维码已失效，请刷新';el('qr-image').classList.add('qr-inactive')}else current.timer=setTimeout(()=>poll(current),3000)}}}
 async function scanned(payload){
  if(!S.user){toast('请先在手机上登录 WeLink');return}
  const match=/^welink:\/\/login\/([a-f0-9]{32})\?key=([a-f0-9]{64})$/.exec(String(payload));if(!match){toast('这不是 WeLink 登录二维码');return}
  const request={id:match[1],key:match[2]};
  try{const result=await action('/api/auth/qr/scan',request);phonePending=request;modal('登录 Windows 版 WeLink',`<div class="qr-confirm"><div class="qr-computer">${icon('monitor')}</div><h3>${esc(result.device)}</h3><p>将使用 ${esc(S.user.name)} 登录</p><p>WeLink 号：${esc(S.user.number)}</p><div class="qr-check">核对码 ${esc(result.checkCode)}</div><p class="hint">请核对电脑上的数字，只确认你正在操作的电脑。</p></div>`,'<button class="secondary" id="qr-phone-cancel">取消登录</button><button class="primary" id="qr-phone-confirm">确认登录</button>');
   const resolve=async accept=>{const button=el(accept?'qr-phone-confirm':'qr-phone-cancel');button.disabled=true;try{await action('/api/auth/qr/confirm',{...request,accept});phonePending=null;document.querySelector('.modal [data-action=close-modal]')?.click();toast(accept?'已授权电脑登录':'已取消电脑登录')}catch(e){toast(e.message);button.disabled=false}};
   el('qr-phone-confirm').onclick=()=>resolve(true);el('qr-phone-cancel').onclick=()=>resolve(false);
  }catch(e){toast(e.message)}
 }
 window.WeLinkQrScanned=scanned;
 document.addEventListener('click',e=>{const a=e.target.closest('[data-action]')?.dataset.action;if(a==='qr-login')open();if(a==='scan-qr'){if(!S.user){toast('请先登录');return}if(window.WeLinkAndroid?.scanQRCode)window.WeLinkAndroid.scanQRCode();else toast('请在安卓 WeLink 中使用扫一扫')}if(a==='close-modal'&&phonePending){const request=phonePending;phonePending=null;action('/api/auth/qr/confirm',{...request,accept:false}).catch(()=>{})}});
 window.addEventListener('pagehide',()=>{clearTimeout(active?.timer)});
 return {open,stop,scanned};
}
