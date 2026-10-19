import webpush from 'npm:web-push@3.6.7';
import {createHandler} from '../_shared/handler.js';
import {createRestStore} from '../_shared/store.js';
const required=(name:string)=>{const value=Deno.env.get(name);if(!value)throw Error('Missing runtime secret: '+name);return value;};
// Only service_role can read these three bounded Vault values via the RPC.
let runtimePromise:Promise<{publicKey:string,privateKey:string,cronSecret:string}>|null=null;
function runtime(){
 if(!runtimePromise)runtimePromise=(async()=>{
  const url=required('SUPABASE_URL'),key=required('SUPABASE_SERVICE_ROLE_KEY');
  const response=await fetch(url+'/rest/v1/rpc/get_reminder_runtime_config',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Reminder runtime unavailable');
  const value=await response.json();
  if(!value?.publicKey||!value?.privateKey||!value?.cronSecret)throw Error('Reminder runtime incomplete');
  return value;
 })().catch(error=>{runtimePromise=null;throw error;});
 return runtimePromise;
}
const store=createRestStore(required('SUPABASE_URL'),required('SUPABASE_SERVICE_ROLE_KEY'));
const sendPush=async(subscription:unknown,payload:unknown)=>{
 const {publicKey,privateKey}=await runtime();
 const details=webpush.generateRequestDetails(subscription,JSON.stringify(payload),{TTL:43200,urgency:'normal',vapidDetails:{subject:'https://one-beginner370.github.io/campus-schedule-web/',publicKey,privateKey}});
 const response=await fetch(details.endpoint,{method:details.method,headers:details.headers,body:details.body,redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok){const error=new Error('Push delivery rejected') as Error&{statusCode:number};error.statusCode=response.status;throw error;}
};
Deno.serve(async(req:Request)=>{
 try{const {publicKey,cronSecret}=await runtime();return await createHandler({store,sendPush,publicKey,cronSecret})(req);}
 catch{const origin=req.headers.get('Origin');return Response.json({error:'提醒服务暂时不可用，请稍后重试'},{status:503,headers:{'Cache-Control':'no-store',...(origin==='https://one-beginner370.github.io'?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})}});}
});
