import {CLIENT_VERSION,authShowcase} from './branding.js';
import {cartoonChoices,cartoonOptions} from './cartoon-catalog.js';

export function createEmailAuth({S,action,enter,QR,Desktop,windows,logo}) {
 let timer;
 function render(mode='login',emailValue='') {
  clearInterval(timer);QR.stop();S.user=null;Desktop.unread();
  const register=mode==='register',reset=mode==='reset',verify=register||reset;
  if(register&&!S.registrationEnabled)return render();
  const choices=register?cartoonChoices(4):[];
  document.querySelector('#app').innerHTML=`<main class="auth-shell email-auth ${register?'registering':''}">${windows()}${authShowcase()}<form class="auth-card" id="auth-form">${logo()}<h2>${register?'创建 LinkMe 账号':reset?'找回密码':'欢迎回来'}</h2><p class="subtitle">${reset?'验证邮箱，设置新密码':register?'用邮箱，开启新的连接':'邮箱登录，与团队保持连接'}</p>${register?`<div class="register-avatars"><div class="cartoon-heading"><span>选一个喜欢的头像</span><button type="button" id="register-avatar-shuffle">换一批</button></div><input type="hidden" name="avatar" id="register-avatar" value="${choices[0].id}"><div class="cartoon-grid compact" id="register-avatar-options">${cartoonOptions(choices,choices[0].id)}</div></div>`:''}<div class="auth-fields">${register?'<input name="name" autocomplete="name" placeholder="姓名（别人能搜索到）" aria-label="姓名" maxlength="32" required>':''}<input name="email" type="email" autocomplete="username" inputmode="email" placeholder="邮箱地址" aria-label="邮箱" maxlength="254" required>${verify?'<div class="email-code-row"><input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6 位验证码" aria-label="验证码" pattern="[0-9]{6}" maxlength="6" required><button type="button" class="secondary" id="send-email-code">获取验证码</button></div>':''}<input name="password" type="password" autocomplete="${verify?'new-password':'current-password'}" placeholder="${verify?'设置密码（至少 8 位）':'密码'}" aria-label="密码" minlength="8" maxlength="72" required>${reset?'<input name="repeatPassword" type="password" autocomplete="new-password" placeholder="再次输入新密码" aria-label="确认密码" minlength="8" maxlength="72" required>':''}</div><div class="auth-error" id="auth-error" role="status" aria-live="polite"></div><button type="submit" class="primary">${register?'注册并登录':reset?'重设密码':'登录'}</button>${!verify&&S.config.platform!=='android'?'<button type="button" class="qr-login-entry" data-action="qr-login">使用二维码登录</button>':''}<div class="auth-links">${verify?'<button type="button" data-email-mode="login">返回登录</button>':`${S.registrationEnabled?'<button type="button" data-email-mode="register">注册账号</button>':''}<button type="button" data-email-mode="reset">忘记密码</button>`}<button type="button" data-action="connection">连接设置</button></div></form><small class="auth-footer">LinkMe ${CLIENT_VERSION} · 让沟通更近一步</small></main>`;
  const form=document.querySelector('#auth-form'),email=form.elements.email,error=form.querySelector('#auth-error');
  email.value=emailValue;let challenge='',challengeEmail='';
  form.querySelectorAll('[data-email-mode]').forEach(b=>b.onclick=()=>render(b.dataset.emailMode,email.value));
  if(register){
   form.querySelector('#register-avatar-shuffle').onclick=()=>{const next=cartoonChoices(4);form.elements.avatar.value=next[0].id;form.querySelector('#register-avatar-options').innerHTML=cartoonOptions(next,next[0].id)};
   form.querySelector('#register-avatar-options').onclick=e=>{const b=e.target.closest('[data-cartoon]');if(!b)return;form.elements.avatar.value=b.dataset.cartoon;form.querySelectorAll('[data-cartoon]').forEach(n=>{n.classList.toggle('selected',n===b);n.setAttribute('aria-checked',String(n===b))})};
  }
  if(verify)form.querySelector('#send-email-code').onclick=async()=>{
   if(!email.reportValidity())return;
   const button=form.querySelector('#send-email-code');button.disabled=true;error.textContent='';
   const address=email.value.trim().toLowerCase();
   try{
    const result=await action('/api/auth/email/code',{email:address,purpose:mode});if(!form.isConnected)return;
    challenge=result.challengeId;challengeEmail=address;error.textContent=reset?'如果该邮箱已注册，验证码将发送到邮箱，请查收。':'验证码已发送，请查收邮箱（含垃圾邮件）。';
    const until=Date.now()+result.retryAfter*1000;
    const tick=()=>{if(!form.isConnected){clearInterval(timer);return}const left=Math.max(0,Math.ceil((until-Date.now())/1000));button.textContent=left?`${left} 秒后重发`:'重新发送';button.disabled=left>0;if(!left)clearInterval(timer)};tick();timer=setInterval(tick,500);
   }catch(e){if(form.isConnected){error.textContent=e.message;button.disabled=false}}
  };
  form.onsubmit=async e=>{
   e.preventDefault();const button=form.querySelector('[type=submit]');if(button.disabled)return;
   const p=[...new FormData(form)].reduce((value,[key,item])=>(value[key]=item,value),{});p.email=p.email.trim().toLowerCase();
   if(verify&&(!challenge||p.email!==challengeEmail)){error.textContent='请先为当前邮箱获取验证码';return}
   if(reset&&p.password!==p.repeatPassword){error.textContent='两次输入的密码不一致';return}
   delete p.repeatPassword;if(verify)p.challengeId=challenge;button.disabled=true;error.textContent='';
   try{
    const result=await action(reset?'/api/auth/email/reset':'/api/auth/'+mode,p);if(!form.isConnected)return;
    if(reset){render('login',p.email);document.querySelector('#auth-error').textContent='密码已重设，请使用新密码登录';return}
    S.token=result.token;localStorage.setItem('welink_token',S.token);S.user=result.user;clearInterval(timer);await enter();
   }catch(e){if(form.isConnected){error.textContent=e.message;button.disabled=false}}
  };
 }
 return {render};
}
