import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import webpush from 'web-push';
import {cleanSchedule,beijingClock,inDispatchWindow,tomorrowCourses,reminderPayload} from '../supabase/functions/_shared/schedule.js';
import {createHandler,hashToken,validateSubscription} from '../supabase/functions/_shared/handler.js';
const periods=Array.from({length:12},(_,i)=>[`${String(i+8).padStart(2,'0')}:00`,`${String(i+8).padStart(2,'0')}:45`]);
const course=(overrides={})=>({name:'工程力学',room:'E-213',weekday:1,startPeriod:1,endPeriod:2,weeks:'1-16',...overrides});
const schedule=(courses=[course()])=>({semesterStart:'2026-09-07',periods,courses});
const at=new Date('2026-10-11T11:30:00Z');
const key=createECDH('prime256v1');key.generateKeys();const auth=randomBytes(16);
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test-endpoint',keys:{p256dh:key.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}};
const deviceId='9a1d8e42-918a-4b4e-8bbf-719f9f2c99e1',token=randomBytes(32).toString('base64url'),cronSecret='test-cron-secret';
test('Beijing clock is independent of host timezone and has the correct send window',()=>{
 assert.deepEqual(beijingClock(at),{date:'2026-10-11',hour:19,minute:30});
 assert(inDispatchWindow(at));assert(!inDispatchWindow(new Date('2026-10-11T11:29:59Z')));assert(!inDispatchWindow(new Date('2026-10-11T11:40:00Z')));
});
test('Tomorrow uses the right teaching week, odd/even rules, ordering, time and room',()=>{
 const value=cleanSchedule(schedule([course({name:'单周课',weeks:'1-15(单)'}),course({name:'双周课',weeks:'2-16(双)',startPeriod:3,endPeriod:4}),course({name:'早课'})]));
 const result=tomorrowCourses(value,at);assert.equal(result.targetDate,'2026-10-12');assert.equal(result.week,6);assert.deepEqual(result.courses.map(c=>c.name),['早课','双周课']);
 assert.equal(result.courses[0].startTime,'08:00');assert.equal(result.courses[0].endTime,'09:45');assert.equal(result.courses[0].room,'E-213');
 assert.equal(reminderPayload(schedule([course({weekday:2})]),at),null);
 assert.equal(reminderPayload(schedule(),new Date('2026-08-30T11:30:00Z')),null);
 assert.equal(reminderPayload(schedule(),new Date('2027-08-08T11:30:00Z')),null);
});
test('Tomorrow crosses year/month boundaries and uses Beijing rather than UTC date',()=>{
 const value={...schedule([course({weekday:5})]),semesterStart:'2026-12-28'};
 assert.equal(tomorrowCourses(value,new Date('2026-12-31T16:30:00Z')).targetDate,'2027-01-02');
 assert.equal(tomorrowCourses(value,new Date('2026-12-31T11:30:00Z')).targetDate,'2027-01-01');
});
test('Invalid semesters, week ranges, times and courses fail closed',()=>{
 for(const patch of [{semesterStart:'2026-02-30'},{semesterStart:'2026-09-08'},{periods:[['25:00','26:00']]},{courses:[course({weeks:'1,,2'})]},{courses:[course({endPeriod:13})]}])assert.throws(()=>cleanSchedule({...schedule(),...patch}));
});
test('Notification payload is bounded and contains the target date for opening tomorrow',()=>{
 const value=schedule(Array.from({length:2000},(_,i)=>course({name:'课程名称'.repeat(20),room:'教室位置'.repeat(40)})));
 const payload=reminderPayload(cleanSchedule(value),at);assert(new TextEncoder().encode(JSON.stringify(payload)).length<3000);assert.match(payload.body,/另有/);assert.equal(payload.data.targetDate,'2026-10-12');
});
test('Web Push payload encrypts/decrypts with actual browser key material and VAPID',()=>{
 const vapid=webpush.generateVAPIDKeys(),payload=reminderPayload(schedule(),at);
 const details=webpush.generateRequestDetails(subscription,JSON.stringify(payload),{TTL:43200,urgency:'normal',vapidDetails:{subject:'https://one-beginner370.github.io/campus-schedule-web/',...vapid}});
 const require=createRequire(import.meta.url),ece=createRequire(require.resolve('web-push'))('http_ece');
 const plain=ece.decrypt(details.body,{version:'aes128gcm',privateKey:key,authSecret:auth});
 assert.deepEqual(JSON.parse(plain.toString()),payload);assert.match(details.headers.Authorization,/^vapid /);assert.equal(+details.headers.TTL,43200);
});
test('Endpoint validation prevents sending requests to arbitrary/private servers',()=>{
 for(const endpoint of ['https://127.0.0.1/x','https://example.com/x','http://fcm.googleapis.com/x','https://fcm.googleapis.com.evil.test/x','https://evil.push.apple.com.evil.test/x','https://fcm.googleapis.com:8443/x'])assert.throws(()=>validateSubscription({...subscription,endpoint}));
 assert.deepEqual(validateSubscription(subscription),subscription);
});
function memoryStore(){
 const devices=new Map(),deliveries=new Map();
 return {devices,deliveries,
  upsert:async(value)=>{const previous=devices.get(value.deviceId);if(previous&&(previous.tokenHash!==value.tokenHash||previous.revision>value.revision))return null;const data={...value,device_id:value.deviceId,enabled:true,updated_at:at.toISOString()};devices.set(value.deviceId,data);return data;},
  get:async(id,hash)=>devices.get(id)?.tokenHash===hash?devices.get(id):null,
  remove:async(id,hash)=>{if(devices.get(id)?.tokenHash===hash)devices.delete(id);},
  claim:async(date,limit)=>{const result=[];for(const value of devices.values()){const key=value.device_id+date,previous=deliveries.get(key);if(!value.enabled||previous&&['sent','skipped','expired','sending'].includes(previous.status)||previous?.attempts>=3)continue;deliveries.set(key,{status:'sending',attempts:(previous?.attempts||0)+1});result.push(value);}return result.slice(0,limit);},
  finish:async(id,date,status)=>{deliveries.get(id+date).status=status;},
  disable:async(id)=>{devices.get(id).enabled=false;},
  reserveTest:async(id,hash,date)=>{const v=devices.get(id);if(v?.tokenHash!==hash||v.last_test_at&&+date-+new Date(v.last_test_at)<60000)return false;v.last_test_at=date.toISOString();return true;}
 };
}
function setup(sendPush=async()=>{}){const store=memoryStore();return {store,handler:createHandler({store,sendPush,publicKey:'public',cronSecret,now:()=>at})};}
const request=(path,{method='GET',authToken=token,body,origin='https://one-beginner370.github.io',cron}={})=>new Request('https://project.supabase.co/functions/v1/campus-reminders/'+path,{method,headers:{Origin:origin,Authorization:'Bearer '+authToken,...(cron?{'X-Cron-Secret':cron}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
const subscribe=(handler,value=schedule())=>handler(request('subscription',{method:'PUT',body:{deviceId,subscription,schedule:value,revision:1}}));
test('Subscribe, test cooldown and per-device authorization',async()=>{
 const sent=[],{store,handler}=setup(async(s,p)=>sent.push(p));
 assert.equal((await subscribe(handler)).status,200);assert.equal(store.devices.size,1);
 assert.equal((await handler(request('subscription?deviceId='+deviceId,{authToken:randomBytes(32).toString('base64url')}))).status,404);
 assert.equal((await handler(request('subscription',{method:'PUT',authToken:randomBytes(32).toString('base64url'),body:{deviceId,subscription,schedule:schedule(),revision:2}}))).status,409);
 assert.equal((await handler(request('dispatch',{method:'POST',cron:'bad'}))).status,401);
 assert.equal((await handler(request('test',{method:'POST',body:{deviceId}}))).status,200);assert.equal(sent.length,1);
 assert.equal((await handler(request('test',{method:'POST',body:{deviceId}}))).status,429);
 assert.equal((await handler(request('subscription?deviceId='+deviceId,{method:'DELETE'}))).status,200);assert.equal(store.devices.size,0);
});
test('Dispatch sends once, skips no-class days, expires revoked subscriptions and retries failures',async()=>{
 for(const mode of ['normal','no-class','expired','transient']){
  let calls=0;const {handler}=setup(async()=>{calls++;if(mode==='expired')throw Object.assign(Error(),{statusCode:410});if(mode==='transient'&&calls===1)throw Error('temporary');});
  await subscribe(handler,mode==='no-class'?schedule([course({weekday:2})]):schedule());
  const dispatch=()=>handler(request('dispatch',{method:'POST',cron:cronSecret}));
  const first=await(await dispatch()).json(),second=await(await dispatch()).json();
  if(mode==='normal'){assert.equal(first.sent,1);assert.equal(second.sent,0);assert.equal(calls,1);}
  if(mode==='no-class'){assert.equal(first.skipped,1);assert.equal(calls,0);}
  if(mode==='expired'){assert.equal(first.expired,1);assert.equal(calls,1);}
  if(mode==='transient'){assert.equal(first.failed,1);assert.equal(second.sent,1);assert.equal(calls,2);}
 }
});
test('Origin restrictions, malformed payloads and CORS preflight',async()=>{
 const {handler}=setup();assert.equal((await handler(request('config',{origin:'https://evil.test'}))).status,403);
 const preflight=await handler(request('subscription',{method:'OPTIONS'}));assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://one-beginner370.github.io');
 assert.equal((await handler(request('subscription',{method:'PUT',body:{deviceId,subscription,schedule:schedule(),revision:-1}}))).status,400);
 assert.equal((await handler(request('subscription',{method:'PUT',authToken:'invalid',body:{}}))).status,401);
});
