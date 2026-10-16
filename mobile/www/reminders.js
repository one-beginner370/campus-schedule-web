const storageKey='campus-schedule-push-v1';
const $=id=>document.getElementById(id);
let config=null,server=null,identity=null,registration=null,busy=false,pending=null,syncTask=null,problem='',errorState=false;
try{identity=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}
function persist(){localStorage.setItem(storageKey,JSON.stringify(identity));}
function randomBase64(size){const b=crypto.getRandomValues(new Uint8Array(size));return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function deviceIdentity(){
 if(identity?.id&&identity?.token)return identity;
 const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');
 identity={id:h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20),token:randomBase64(32),enabled:false,revision:0};persist();return identity;
}
function keyBytes(key){return Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-key.length%4)%4)),c=>c.charCodeAt(0));}
function schedule(){
 const state=window.campusGetSchedule?.();if(!state)throw Error('课表还在读取，请稍后重试');
 if(!state.semesterStart)throw Error('请先设置第一周起始日期（周一）并保存，再启用提醒。');
 return {semesterStart:state.semesterStart,periods:state.periods,courses:state.courses.map(c=>({name:c.name,room:c.room||'',weekday:c.weekday,startPeriod:c.startPeriod,endPeriod:c.endPeriod,weeks:c.weeks}))};
}
function supported(){return 'Notification'in window&&'PushManager'in window&&'serviceWorker'in navigator;}
function render(){
 const enabled=identity?.enabled===true,available=!!config?.backendUrl&&!!server?.publicKey&&supported();
 $('enable-reminders').hidden=enabled;$('disable-reminders').hidden=!enabled;$('test-reminder').hidden=!enabled;$('sync-reminders').hidden=!enabled;
 $('enable-reminders').disabled=busy||!available||Notification.permission==='denied';
 for(const id of ['disable-reminders','test-reminder','sync-reminders'])$(id).disabled=busy;
 let text=problem;
 if(!text){
  if(!config?.backendUrl)text='推送后台尚未连接，当前不会发送提醒。';
  else if(!supported())text='当前浏览器不支持网页推送。安卓请尝试 Chrome / Edge；iPhone 请使用 iOS 16.4 或更新版本，先添加到主屏幕，再从主屏幕打开。';
  else if(Notification.permission==='denied')text='系统通知权限已被关闭。请在浏览器或手机设置中允许本站通知，再重新启用。';
  else if(enabled&&identity.dirty)text='课表变更尚未同步到提醒服务。联网后请打开本页重试。';
  else if(enabled)text='已启用：每天北京时间 19:30 提醒明天的课程、时间和教室；明天没课不提醒。';
  else text='尚未启用。点击下方按钮后，请允许系统通知。';
 }
 $('reminder-status').textContent=text;$('reminder-status').classList.toggle('error-message',errorState);
 $('reminder-sync-time').textContent=enabled&&identity.syncedAt?'上次同步：'+new Date(identity.syncedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'（北京时间）':'';
}
function status(message,isError=false){problem=message;errorState=isError;render();}
async function api(path,{method='GET',body}={}){
 if(!config?.backendUrl)throw Error('推送后台尚未连接');
 const response=await fetch(config.backendUrl+'/'+path,{method,headers:{'Content-Type':'application/json',...(identity?{Authorization:'Bearer '+identity.token}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
 let result;try{result=await response.json();}catch{throw Error('提醒服务未正确响应，请稍后重试');}
 if(!response.ok){const error=new Error(result.error||'提醒服务暂时不可用');error.status=response.status;throw error;}return result;
}
function connectionStore(value){return new Promise((resolve,reject)=>{
 const request=indexedDB.open('campus-schedule-reminders',1);request.onupgradeneeded=()=>request.result.createObjectStore('settings');
 request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('settings','readwrite'),store=tx.objectStore('settings');if(value)store.put(value,'connection');else store.delete('connection');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};};
});}
async function rememberConnection(value){await connectionStore(value?{backendUrl:config.backendUrl,deviceId:identity.id,token:identity.token,schedule:value,revision:identity.revision}:null);}
async function readyRegistration(){
 if(!registration)registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
 await registration.update();
 const worker=registration.installing||registration.waiting;
 if(worker&&worker.state!=='activated')await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('通知组件正在更新，请稍后重试')),20000);worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timer);resolve();}else if(worker.state==='redundant'){clearTimeout(timer);reject(Error('通知组件更新失败，请刷新后重试'));}});});
 return navigator.serviceWorker.ready;
}
async function upload(snapshot){
 const reg=await navigator.serviceWorker.ready,subscription=await reg.pushManager.getSubscription();
 if(!subscription)throw Error('手机推送订阅已失效，请关闭提醒后重新启用');
 identity.revision=Math.max(Date.now(),(identity.revision||0)+1);identity.dirty=true;persist();
 await rememberConnection(snapshot);
 const result=await api('subscription',{method:'PUT',body:{deviceId:identity.id,subscription:subscription.toJSON(),schedule:snapshot,revision:identity.revision}});
 identity.syncedAt=result.syncedAt;identity.dirty=false;persist();return result;
}
async function syncPending(){
 if(syncTask)return syncTask;
 if(!identity?.enabled||!config?.backendUrl)return;
 syncTask=(async()=>{
  try{while(pending&&identity.enabled){const value=pending;pending=null;status('正在同步课表到提醒服务…');await upload(value);}status('');}
  catch(error){pending=null;identity.dirty=true;persist();status(error.message+'。本机修改已保存，提醒仍按上次成功同步的课表发送。',true);}
 })();
 try{await syncTask;}finally{syncTask=null;}
}
async function enable(){
 if(busy)return;
 let snapshot;try{snapshot=schedule();deviceIdentity();}catch(error){status(error.message,true);return;}
 // Request permission directly from the user's click, before async network work.
 const permissionPromise=Notification.requestPermission();busy=true;status('正在连接系统通知…');let newlySubscribed=false;
 try{
  if(await permissionPromise!=='granted')throw Error('尚未允许系统通知，提醒没有启用');
  const reg=await readyRegistration();let subscription=await reg.pushManager.getSubscription();
  if(subscription&&subscription.options.applicationServerKey&&btoa(String.fromCharCode(...new Uint8Array(subscription.options.applicationServerKey))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==server.publicKey){await subscription.unsubscribe();subscription=null;}
  if(!subscription){subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(server.publicKey)});newlySubscribed=true;}
  await upload(snapshot);identity.enabled=true;persist();await rememberConnection(snapshot);status('');
 }catch(error){
  if(newlySubscribed){const sub=await registration?.pushManager.getSubscription();await sub?.unsubscribe();}
  identity.enabled=false;persist();await rememberConnection(null).catch(()=>{});status(error.message,true);
 }finally{busy=false;render();}
}
async function disable(){
 busy=true;identity.enabled=false;identity.dirty=false;pending=null;persist();status('正在关闭提醒…');
 try{
  if(syncTask)await syncTask;
  await rememberConnection(null);const reg=await navigator.serviceWorker.getRegistration();const sub=await reg?.pushManager.getSubscription();if(sub)await sub.unsubscribe();
  try{await api('subscription?deviceId='+identity.id,{method:'DELETE'});status('此设备提醒已关闭，云端提醒副本已删除。');}catch(error){if(error.status===404)status('此设备提醒已关闭。');else status('此设备推送已取消。云端清理尚未完成，下次联网可再次启用后关闭。');}
 }catch(error){status('关闭提醒时遇到问题：'+error.message+'。请在系统设置中关闭本站通知。',true);}
 finally{busy=false;render();}
}
async function test(){
 busy=true;status('正在发送测试通知…');
 try{if(syncTask)await syncTask;await upload(schedule());const result=await api('test',{method:'POST',body:{deviceId:identity.id}});status(result.message);}catch(error){status(error.message,true);}finally{busy=false;render();}
}
async function init(){
 $('enable-reminders').onclick=enable;$('disable-reminders').onclick=disable;$('test-reminder').onclick=test;
 $('sync-reminders').onclick=()=>{try{pending=schedule();syncPending();}catch(error){status(error.message,true);}};
 window.addEventListener('campus-schedule-saved',()=>{if(identity?.enabled){identity.dirty=true;persist();try{pending=schedule();syncPending();}catch(error){status(error.message,true);}}});
 render();
 try{
  const response=await fetch('./push-config.json',{cache:'no-store'});if(!response.ok)throw Error('提醒配置读取失败');config=await response.json();
  if(config.backendUrl){const url=new URL(config.backendUrl);if(url.protocol!=='https:')throw Error('提醒服务地址必须使用 HTTPS');config.backendUrl=url.href.replace(/\/$/,'');server=await api('config');if(!/^[A-Za-z0-9_-]{87}$/.test(server.publicKey||''))throw Error('提醒服务配置不完整');}
  if(supported()&&config.backendUrl){registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});if(identity?.enabled){if(Notification.permission!=='granted'){identity.enabled=false;persist();await rememberConnection(null);}else{pending=schedule();await syncPending();}}}
  render();
 }catch(error){status(error.message+'，当前不能确认提醒服务可用。',true);}
 window.addEventListener('online',()=>{if(identity?.enabled){try{pending=schedule();syncPending();}catch{}}});
 navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='campus-push-changed'&&identity?.enabled){try{pending=schedule();syncPending();}catch{}}});
}
if(window.campusAppReady)init();else window.addEventListener('campus-app-ready',init,{once:true});
