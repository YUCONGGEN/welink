export function createAdmin({S,api,modal,closeModal,toast,esc,icon,refresh}) {
 const $=s=>document.querySelector(s);let generation=0,currentQuery='';
 const request=api;api=async(...args)=>{const token=S.token,result=await request(...args);if(!S.user||S.signingOut||S.token!==token)throw Object.assign(Error('操作已结束'),{name:'AbortError'});return result};
 function bind(id,fn){const button=$('#'+id);if(button)button.onclick=async()=>{button.disabled=true;try{await fn()}catch(error){const n=$('#modal-error');if(n)n.textContent=error.message;else toast(error.message)}finally{button.disabled=false}}}
 async function render(query=currentQuery){
  const token=S.token,g=++generation,users=await api('/api/admin/users?q='+encodeURIComponent(query));
  if(S.token!==token||S.tab!=='admin'||g!==generation)return;currentQuery=query;
  $('#main-content').innerHTML=`<section class="cloud-page admin-page"><header class="cloud-heading"><div><h2>账号管理</h2><p>注册账号、修改资料、重置密码与删除账号</p></div><button class="primary" id="admin-create">${icon('plus')}注册账号</button></header><label class="cloud-search">${icon('search')}<input id="admin-search" placeholder="搜索姓名或 6 位账号" value="${esc(query)}"></label><div>${users.map(u=>`<article class="cloud-file" data-admin-user="${u.id}"><div class="cloud-file-name"><b>${esc(u.name)} ${u.admin?'<small class="admin-label">管理员</small>':''}</b><small>WeLink 账号 ${esc(u.number)}</small></div><div class="admin-user-actions"><button class="secondary" data-admin-edit="${u.id}">编辑资料</button><button class="secondary" data-admin-password="${u.id}" data-name="${esc(u.name)}" data-number="${esc(u.number)}">重置密码</button>${u.admin?'':'<button class="secondary admin-delete" data-admin-delete="'+u.id+'" data-number="'+esc(u.number)+'" data-name="'+esc(u.name)+'">删除账号</button>'}</div></article>`).join('')||'<p class="empty-list">没有找到账号</p>'}</div></section>`;
  $('#admin-search').onkeydown=e=>{if(e.key==='Enter')render(e.target.value).catch(error=>toast(error.message))};bind('admin-create',create);
 }
 const nameField=(value='')=>'<label for="admin-name">姓名</label><input id="admin-name" maxlength="32" autocomplete="name" required placeholder="请输入姓名" value="'+esc(value)+'">';
 function submit(formID,buttonID,save){
  const form=$('#'+formID),button=$('#'+buttonID);
  form.onsubmit=async event=>{event.preventDefault();if(button.disabled)return;const name=$('#admin-name').value.trim();if(!name){$('#modal-error').textContent='请填写姓名';$('#admin-name').focus();return}button.disabled=true;$('#modal-error').textContent='';try{await save(name,form)}catch(e){if(form.isConnected){$('#modal-error').textContent=e.message;button.disabled=false}else if(e.name!=='AbortError')toast(e.message)}};
 }
 function create(){
  modal('注册用户账号','<form id="admin-register-form">'+nameField()+'<label for="admin-password">初始密码（选填）</label><input id="admin-password" type="password" autocomplete="new-password" minlength="8" maxlength="72" placeholder="留空生成随机密码"><p class="hint">请填写姓名，系统自动分配六位登录账号。之后可在账号管理中修改资料。</p></form>','<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="admin-save-user" type="submit" form="admin-register-form">注册账号</button>');
  submit('admin-register-form','admin-save-user',async(name,form)=>{
   const result=await api('/api/admin/users',{method:'POST',body:{name,password:$('#admin-password').value}});
   if(!form.isConnected)return;closeModal();modal('账号已注册','<p>姓名：'+esc(result.user.name)+'</p><p>登录账号：<b id="admin-created-number">'+esc(result.user.number)+'</b></p>'+(result.initialPassword?'<label>随机初始密码（仅显示本次）</label><input id="admin-created-password" readonly value="'+esc(result.initialPassword)+'">':'<p class="hint">初始密码为刚才填写的密码。</p>'),'<button class="primary" data-action="close-modal">完成</button>');await refresh();await render();
  });
 }
 async function edit(id){
  modal('编辑用户资料','<p id="admin-profile-loading" class="hint">正在读取资料…</p>');const loading=$('#admin-profile-loading');
  try{
   const u=await api('/api/admin/users/'+id);if(!loading.isConnected)return;
   modal('编辑用户资料','<form id="admin-profile-form"><p class="hint">WeLink 账号：'+esc(u.number)+'</p>'+nameField(u.name)+'<label for="admin-phone">手机号</label><input id="admin-phone" type="tel" autocomplete="tel" maxlength="32" value="'+esc(u.phone||'')+'" placeholder="未设置"><label for="admin-gender">性别</label><select id="admin-gender"><option value="">未设置</option>'+[['male','男'],['female','女'],['other','其他']].map(([v,t])=>'<option value="'+v+'" '+(u.gender===v?'selected':'')+'>'+t+'</option>').join('')+'</select><label for="admin-job">职位</label><input id="admin-job" maxlength="64" value="'+esc(u.jobTitle||'')+'" placeholder="未设置"><label for="admin-bio">个性签名</label><input id="admin-bio" maxlength="150" value="'+esc(u.bio||'')+'" placeholder="未设置"></form>','<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="admin-save-profile" type="submit" form="admin-profile-form">保存</button>');
   submit('admin-profile-form','admin-save-profile',async(name,form)=>{
    const body={name,phone:$('#admin-phone').value,gender:$('#admin-gender').value,jobTitle:$('#admin-job').value,bio:$('#admin-bio').value};
    const updated=await api('/api/admin/users/'+id,{method:'PATCH',body});if(updated.id===S.user?.id)S.user={...S.user,...updated};
    if(form.isConnected)closeModal();await refresh();await render();toast('资料已保存');
   });
  }catch(e){if(loading.isConnected)$('#modal-error').textContent=e.message}
 }
 document.addEventListener('click',event=>{
  if(!S.policy?.admin)return;const editButton=event.target.closest('[data-admin-edit]');if(editButton){edit(editButton.dataset.adminEdit);return}
  const reset=event.target.closest('[data-admin-password]');if(reset){modal('重置用户密码','<p>为 '+esc(reset.dataset.name)+'（'+esc(reset.dataset.number)+'）设置新密码</p><label>新密码</label><input id="admin-new-password" type="password" autocomplete="new-password" maxlength="72"><p class="hint">不需要原密码。该用户的其他登录设备将退出。</p>','<button class="secondary" data-action="close-modal">取消</button><button class="primary" id="admin-reset-password">重置密码</button>');bind('admin-reset-password',async()=>{await api('/api/admin/users/'+reset.dataset.adminPassword+'/password',{method:'POST',body:{password:$('#admin-new-password').value}});closeModal();toast('密码已重置')});return}
  const b=event.target.closest('[data-admin-delete]');if(!b)return;const id=b.dataset.adminDelete,number=b.dataset.number;modal('删除用户账号',`<p>确认删除 <b>${esc(b.dataset.name)}</b>（${esc(number)}）？</p><p class="hint">账号将无法登录，个人网盘、空间及分享会被清除。其他用户的已有聊天记录保留，发送人显示为已注销用户。</p><label>输入该用户的 WeLink 号码确认</label><input id="admin-confirm-number" autocomplete="off" inputmode="numeric">`,'<button class="secondary" data-action="close-modal">取消</button><button class="primary danger" id="admin-confirm-delete">删除账号</button>');bind('admin-confirm-delete',async()=>{await api('/api/admin/users/'+id,{method:'DELETE',body:{confirmNumber:$('#admin-confirm-number').value}});closeModal();toast('账号已删除');await refresh();await render()});
 });
 return {render,reset(){generation++;currentQuery=''},settingsRow:()=>S.policy?.admin?'<button class="utility-row" data-nav="admin"><div class="body">管理员 · 账号管理</div>'+icon('chevron')+'</button>':''};
}
