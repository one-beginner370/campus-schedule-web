export function createRestStore(url,serviceKey,fetcher=fetch){
 const headers={'apikey':serviceKey,'Authorization':'Bearer '+serviceKey,'Content-Type':'application/json'};
 async function call(path,body,method='POST'){
  const response=await fetcher(url+'/rest/v1/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Reminder database request failed');return response.status===204?null:response.json();
 }
 return {
  upsert:async({deviceId,tokenHash,subscription,schedule,revision})=>(await call('rpc/upsert_reminder_device',{p_id:deviceId,p_token_hash:tokenHash,p_subscription:subscription,p_schedule:schedule,p_revision:revision}))[0]||null,
  get:async(id,hash)=>(await call('reminder_devices?id=eq.'+encodeURIComponent(id)+'&token_hash=eq.'+hash+'&select=enabled,subscription,schedule,revision,updated_at,last_test_at',undefined,'GET'))[0]||null,
  remove:async(id,hash)=>call('reminder_devices?id=eq.'+encodeURIComponent(id)+'&token_hash=eq.'+hash,undefined,'DELETE'),
  claim:async(date,limit,now)=>call('rpc/claim_reminder_batch',{p_date:date,p_limit:limit,p_now:now.toISOString()}),
  finish:async(id,date,status)=>call('reminder_deliveries?device_id=eq.'+encodeURIComponent(id)+'&target_date=eq.'+date,{status,locked_until:null,finished_at:new Date().toISOString()},'PATCH'),
  disable:async(id)=>call('reminder_devices?id=eq.'+encodeURIComponent(id),{enabled:false},'PATCH'),
  reserveTest:async(id,hash,now)=>call('rpc/reserve_reminder_test',{p_id:id,p_token_hash:hash,p_now:now.toISOString()})
 };
}
