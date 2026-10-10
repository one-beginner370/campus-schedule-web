import webpush from 'npm:web-push@3.6.7';
import {createHandler} from '../_shared/handler.js';
import {createRestStore} from '../_shared/store.js';
const required=(name:string)=>{const value=Deno.env.get(name);if(!value)throw Error('Missing runtime secret: '+name);return value;};
const publicKey=required('VAPID_PUBLIC_KEY'),privateKey=required('VAPID_PRIVATE_KEY');
const store=createRestStore(required('SUPABASE_URL'),required('SUPABASE_SERVICE_ROLE_KEY'));
const sendPush=async(subscription:unknown,payload:unknown)=>{
 const details=webpush.generateRequestDetails(subscription,JSON.stringify(payload),{TTL:43200,urgency:'normal',vapidDetails:{subject:'https://one-beginner370.github.io/campus-schedule-web/',publicKey,privateKey}});
 const response=await fetch(details.endpoint,{method:details.method,headers:details.headers,body:details.body,redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok){const error=new Error('Push delivery rejected') as Error&{statusCode:number};error.statusCode=response.status;throw error;}
};
Deno.serve(createHandler({store,sendPush,publicKey,cronSecret:required('CRON_SECRET')}));
