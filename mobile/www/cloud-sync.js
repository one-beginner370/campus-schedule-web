// Public project settings only. Privileged credentials never belong in this file.
const URL='https://fgrqsvducfozthkrumym.supabase.co';
const KEY='sb_publishable_Ha0EYpk74ci685NJ_6iT_w_vyqLuAxo';
const SESSION='campus-cloud-session-v1';
let session=null,revision=null,busy=false,pending=null;
try{session=JSON.parse(sessionStorage.getItem(SESSION)||'null')}catch{}
function persist(){if(session)sessionStorage.setItem(SESSION,JSON.stringify(session));else sessionStorage.removeItem(SESSION)}
async function request(path,{method='GET',body,auth=true}={}){
 if(auth&&!session)throw Error('请先登录');
 if(auth&&session.expires_at*1000<Date.now()+60000){
  const r=await fetch(URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token}),signal:AbortSignal.timeout(15000)});
  if(!r.ok){session=null;revision=null;persist();throw Error('登录已过期，请重新登录')}
  session=await r.json();persist();
 }
 const r=await fetch(URL+path,{method,headers:{apikey:KEY,'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+session.access_token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const v=await r.json().catch(()=>null);
 if(!r.ok){const m=v?.message||v?.msg||v?.error_description||'';if(m.includes('REVISION_CONFLICT'))throw Error('云端课表已更新。请先下载云端版本，再修改上传。');if(m.includes('ACCOUNT_DISABLED'))throw Error('账号已停用，请联系管理员');throw Error(m==='Invalid login credentials'?'邮箱或密码不正确':m==='Email not confirmed'?'请先在邮箱中确认注册链接':r.status===429?'请求过于频繁，请稍后再试':'服务请求失败，请检查网络或账号状态')}
 return v;
}
function start(){
 const panel=document.createElement('section');panel.className='panel';panel.style.marginTop='20px';
 panel.innerHTML='<h2>账号与云端课表</h2><p>登录后可手动上传或下载自己的课表。离线时仍可使用本机课表；关闭 App 后可能需要重新登录。</p><p id="cloud-state" role="status"></p><form id="cloud-login"><label>邮箱<input name="email" type="email" autocomplete="email" required></label><label>密码<input name="password" type="password" autocomplete="current-password" minlength="8" required></label><div class="button-row"><button class="primary-button" type="submit">登录</button><button type="button" data-cloud="signup" class="secondary-button">注册账号</button></div></form><div class="button-row"><button data-cloud="upload" class="primary-button">上传本机课表</button><button data-cloud="download" class="secondary-button">下载云端课表</button><button data-cloud="notices" class="secondary-button">刷新公告</button><button data-cloud="logout" class="secondary-button">退出账号</button><button data-cloud="delete" class="danger-button">注销云端账号</button></div><p id="cloud-message" role="status" aria-live="polite"></p><div id="cloud-notices"></div>';
 document.querySelector('#settings-view').append(panel);
 const state=panel.querySelector('#cloud-state'),message=panel.querySelector('#cloud-message'),form=panel.querySelector('form');
 function render(){state.textContent=session?'已登录：'+(session.user?.email||'')+' · '+(revision===null?'尚未同步':'已知云端版本 v'+revision):'未登录 · 本机课表可正常使用';form.hidden=!!session;panel.querySelectorAll('[data-cloud]').forEach(b=>{b.disabled=busy||(!session&&!['signup'].includes(b.dataset.cloud))});form.querySelector('button[type=submit]').disabled=busy;}
 async function work(fn){if(busy)return;busy=true;message.textContent='处理中…';render();try{await fn()}catch(e){message.textContent=e.name==='TimeoutError'?'网络超时，请重试。上传重试会保留原请求标识。':e.message}finally{busy=false;render()}}
 async function login(signup){if(!form.reportValidity())return;const fd=new FormData(form);const email=String(fd.get('email')).trim(),password=String(fd.get('password'));const v=await request(signup?'/auth/v1/signup':'/auth/v1/token?grant_type=password',{method:'POST',auth:false,body:{email,password}});form.reset();if(v.access_token){session=v;revision=null;pending=null;persist();message.textContent='登录成功。请按需选择上传本机课表或下载云端课表。'}else message.textContent='注册请求已提交，请检查邮箱并完成确认后登录。'}
 form.addEventListener('submit',e=>{e.preventDefault();work(()=>login(false))});
 panel.addEventListener('click',e=>{const b=e.target.closest('[data-cloud]');if(!b)return;work(async()=>{
  const action=b.dataset.cloud;
  if(action==='signup')return login(true);
  if(action==='logout'){try{await request('/auth/v1/logout',{method:'POST'})}finally{session=null;revision=null;pending=null;persist()}message.textContent='已退出，本机课表保留。';return}
  if(action==='delete'){if(!confirm('永久注销当前云端账号并删除该账号的云端课表？此操作无法撤销，本机课表会保留。')){message.textContent='已取消';return}await request('/rest/v1/rpc/campus_delete_my_account',{method:'POST',body:{}});session=null;revision=null;pending=null;persist();message.textContent='云端账号已注销，本机课表保留。';return}
  if(action==='notices'){const rows=await request('/rest/v1/campus_announcements?select=id,title,body&order=created_at.desc&limit=30');const dest=panel.querySelector('#cloud-notices');dest.replaceChildren();for(const n of rows){const h=document.createElement('h3'),p=document.createElement('p');h.textContent=n.title;p.textContent=n.body;dest.append(h,p)}message.textContent=rows.length?'已刷新公告':'暂无已发布公告';return}
  const rows=await request('/rest/v1/campus_schedules?select=data,revision&limit=1');const cloud=rows[0];
  if(action==='download'){if(!cloud){message.textContent='云端还没有课表，请先上传。';return}if(!confirm('下载会替换本机课表。建议先导出 JSON 备份，确定继续？')){message.textContent='已取消';return}if(!window.campusApplyCloudSchedule(cloud.data))throw Error('本机存储失败，未完成下载');await window.campusSavePending;revision=cloud.revision;pending=null;message.textContent='已下载云端课表 v'+revision;return}
  if(action==='upload'){
   if(revision===null){if(cloud&&!confirm('首次上传将覆盖当前账号的云端课表。确定使用本机课表覆盖？')){message.textContent='已取消，可改为下载云端课表';return}revision=cloud?.revision||0}
   const data=window.campusGetSchedule();const fingerprint=JSON.stringify(data);
   if(!pending||pending.fingerprint!==fingerprint||pending.revision!==revision)pending={fingerprint,revision,id:crypto.randomUUID()};
   const saved=await request('/rest/v1/rpc/campus_save_schedule',{method:'POST',body:{p_data:data,p_expected_revision:revision,p_request_id:pending.id}});revision=saved.revision;pending=null;message.textContent='已上传到云端 v'+revision;
  }
 })});render();
}
if(window.campusAppReady)start();else window.addEventListener('campus-app-ready',start,{once:true});
