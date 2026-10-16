const REMINDER_DB='campus-schedule-reminders';
async function readReminderConnection(){return new Promise((resolve,reject)=>{
 const request=indexedDB.open(REMINDER_DB,1);request.onupgradeneeded=()=>request.result.createObjectStore('settings');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('settings','readonly'),get=tx.objectStore('settings').get('connection');let result;get.onsuccess=()=>result=get.result;tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};};
});}
self.addEventListener('push',event=>event.waitUntil((async()=>{
 let payload;try{payload=event.data?.json();}catch{}
 const title=typeof payload?.title==='string'?payload.title:'校园课表';
 const data={targetDate:/^\d{4}-\d{2}-\d{2}$/.test(payload?.data?.targetDate||'')?payload.data.targetDate:null,url:payload?.data?.url==='#settings'?'#settings':'#today'};
 await self.registration.showNotification(title,{body:typeof payload?.body==='string'?payload.body:'你有一条课程提醒，点击查看课表。',tag:typeof payload?.tag==='string'?payload.tag:'campus-reminder',icon:'./icon-192.png',badge:'./icon-192.png',data});
})()));
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{
  const url=new URL('./',self.registration.scope);url.hash=event.notification.data?.url==='#settings'?'settings':'today';
  const date=event.notification.data?.targetDate;if(/^\d{4}-\d{2}-\d{2}$/.test(date||''))url.searchParams.set('reminderDate',date);
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const existing=windows.find(client=>client.url.startsWith(self.registration.scope));
  if(existing){await existing.navigate(url.href);await existing.focus();}else await self.clients.openWindow(url.href);
 })());
});
self.addEventListener('pushsubscriptionchange',event=>event.waitUntil((async()=>{
 const connection=await readReminderConnection();if(!connection)return;
 try{
  const subscription=event.newSubscription||await self.registration.pushManager.subscribe(event.oldSubscription.options);
  const response=await fetch(connection.backendUrl+'/subscription',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+connection.token},body:JSON.stringify({deviceId:connection.deviceId,subscription:subscription.toJSON(),schedule:connection.schedule,revision:Math.max(Date.now(),connection.revision+1)}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('renewal failed');
 }catch{
  await self.registration.showNotification('校园课表 · 需要重新连接提醒',{body:'手机推送订阅已变化，请打开课表设置，关闭提醒后重新启用。',tag:'campus-push-renewal',icon:'./icon-192.png',data:{url:'#settings'}});
 }
 const windows=await self.clients.matchAll({type:'window'});for(const client of windows)client.postMessage({type:'campus-push-changed'});
})()));
