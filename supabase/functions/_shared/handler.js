import {cleanSchedule,beijingClock,inDispatchWindow,reminderPayload,tomorrowCourses} from './schedule.js';
export class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const encoder=new TextEncoder();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function hashToken(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function validateSubscription(sub){
 if(!sub||typeof sub.endpoint!=='string'||sub.endpoint.length>2048)throw new HttpError(400,'推送订阅无效');
 let url;try{url=new URL(sub.endpoint);}catch{throw new HttpError(400,'推送地址无效');}
 const host=url.hostname;
 if(url.protocol!=='https:'||url.username||url.password||url.port||!(host==='fcm.googleapis.com'||host==='android.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com')))throw new HttpError(400,'不支持此推送服务地址');
 if(!sub.keys||!/^[A-Za-z0-9_-]{87}$/.test(sub.keys.p256dh)||!/^[A-Za-z0-9_-]{22}$/.test(sub.keys.auth))throw new HttpError(400,'推送密钥无效');
 return {endpoint:url.href,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}};
}
async function readJSON(request){
 const reader=request.body?.getReader();if(!reader)return {};
 let size=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512*1024){await reader.cancel();throw new HttpError(413,'课表数据过大');}chunks.push(value);}
 const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(data));}catch{throw new HttpError(400,'请求格式无效');}
}
export function createHandler({store,sendPush,publicKey,cronSecret,now=()=>new Date(),allowedOrigin='https://one-beginner370.github.io'}){
 return async request=>{
  const origin=request.headers.get('Origin'),url=new URL(request.url),route=url.pathname.split('/').pop();
  const cors=origin===allowedOrigin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET,PUT,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Max-Age':'3600'}:{};
  const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
  try{
   if(origin&&origin!==allowedOrigin)throw new HttpError(403,'此网站无权访问提醒服务');
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
   if(route==='config'&&request.method==='GET')return reply(200,{ready:true,publicKey,timezone:'Asia/Shanghai',time:'19:30'});
   if(route==='dispatch'&&request.method==='POST'){
    const incoming=request.headers.get('X-Cron-Secret')||'';
    if(!cronSecret||!incoming||await hashToken(incoming)!==await hashToken(cronSecret))throw new HttpError(401,'需要后台任务授权');
    const date=now();if(!inDispatchWindow(date))return reply(200,{skipped:'outside-send-window',timezone:'Asia/Shanghai'});
    // Claims are atomic in Postgres; retries cannot race other job executions.
    const targetDate=new Date(beijingClock(date).date+'T00:00:00Z');targetDate.setUTCDate(targetDate.getUTCDate()+1);const target=targetDate.toISOString().slice(0,10);
    const rows=await store.claim(target,20,date),counts={sent:0,skipped:0,expired:0,failed:0};let next=0;
    await Promise.all(Array.from({length:Math.min(5,rows.length)},async()=>{while(next<rows.length){const row=rows[next++];
     try{
      const payload=reminderPayload(cleanSchedule(row.schedule),date);
      if(!payload){await store.finish(row.device_id,target,'skipped');counts.skipped++;continue;}
      await sendPush(validateSubscription(row.subscription),payload);await store.finish(row.device_id,target,'sent');counts.sent++;
     }catch(error){
      const expired=[404,410].includes(error.statusCode);if(expired){await store.disable(row.device_id);await store.finish(row.device_id,target,'expired');counts.expired++;}else{await store.finish(row.device_id,target,'failed');counts.failed++;}
     }
    }}));
    return reply(200,{targetDate:target,...counts});
   }
   if(!['subscription','test'].includes(route))throw new HttpError(404,'接口不存在');
   const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
   if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new HttpError(401,'设备授权无效');
   const tokenHash=await hashToken(token),body=['PUT','POST'].includes(request.method)?await readJSON(request):{},deviceId=body.deviceId||url.searchParams.get('deviceId');
   if(!UUID.test(deviceId||''))throw new HttpError(400,'设备标识无效');
   if(route==='subscription'&&request.method==='PUT'){
    let schedule;try{schedule=cleanSchedule(body.schedule);}catch(error){throw new HttpError(400,error.message);}
    const subscription=validateSubscription(body.subscription),revision=Number(body.revision);
    if(!Number.isSafeInteger(revision)||revision<0)throw new HttpError(400,'课表版本无效');
    const result=await store.upsert({deviceId,tokenHash,subscription,schedule,revision});if(!result)throw new HttpError(409,'设备授权或课表版本已变化，请重新连接');
    return reply(200,{enabled:true,syncedAt:result.updated_at,revision:result.revision,tomorrowCount:tomorrowCourses(schedule,now()).courses.length});
   }
   const saved=await store.get(deviceId,tokenHash);if(!saved)throw new HttpError(404,'此设备尚未启用提醒');
   if(route==='subscription'&&request.method==='GET')return reply(200,{enabled:saved.enabled,revision:saved.revision,syncedAt:saved.updated_at});
   if(route==='subscription'&&request.method==='DELETE'){await store.remove(deviceId,tokenHash);return reply(200,{enabled:false});}
   if(route==='test'&&request.method==='POST'){
    if(!saved.enabled)throw new HttpError(409,'提醒订阅已失效，请重新启用');
    if(saved.last_test_at&&+now()-+new Date(saved.last_test_at)<60000)throw new HttpError(429,'请稍等一分钟再测试');
    // Reserve before sending so concurrent requests cannot bypass the cooldown.
    if(!await store.reserveTest(deviceId,tokenHash,now()))throw new HttpError(429,'请稍等一分钟再测试');
    const payload=reminderPayload(cleanSchedule(saved.schedule),now())||{title:'校园课表 · 测试通知',body:'推送服务已连接。明天没有课，将不会发送日常提醒。',tag:'campus-push-test',data:{url:'#settings'}};
    payload.title='测试 · '+payload.title;payload.tag='campus-push-test';
    try{await sendPush(validateSubscription(saved.subscription),payload);}catch(error){if([404,410].includes(error.statusCode)){await store.disable(deviceId);throw new HttpError(410,'订阅已过期，请重新启用提醒');}throw error;}
    return reply(200,{accepted:true,message:'推送服务已接受测试通知，请在手机通知栏确认。'});
   }
   throw new HttpError(405,'不支持此操作');
  }catch(error){return reply(error.status||500,{error:error.status?error.message:'提醒服务暂时不可用，请稍后重试'});}
 };
}
