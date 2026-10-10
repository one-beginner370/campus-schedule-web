import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import webpush from 'web-push';
const root=fileURLToPath(new URL('../',import.meta.url));
const ref=process.env.SUPABASE_PROJECT_REF,accessToken=process.env.SUPABASE_ACCESS_TOKEN;
if(!/^[a-z0-9]{20}$/.test(ref||'')||!accessToken){console.error('Requires SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN in the process environment. No changes made.');process.exit(1);}
const backendUrl=`https://${ref}.supabase.co/functions/v1/campus-reminders`;
async function api(path,{method='GET',body}={}){
 const isForm=body instanceof FormData;
 const response=await fetch('https://api.supabase.com/v1/projects/'+ref+path,{method,headers:{Authorization:'Bearer '+accessToken,...(isForm?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:isForm?body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error(`Supabase request failed (${response.status}) at ${path.split('?')[0]}`);
 return response.status===204?null:response.json();
}
async function query(sql,parameters){return api('/database/query',{method:'POST',body:{query:sql,parameters}});}
async function vault(name,value){
 const existing=await query('select id from vault.secrets where name=$1',[name]);
 if(existing.length)await query('select vault.update_secret($1::uuid,$2,$3)',[existing[0].id,value,name]);
 else await query('select vault.create_secret($1,$2)',[value,name]);
}
try{
 const project=await api('');if(project.id!==ref&&project.ref!==ref)throw Error('Project identity mismatch');
 const secrets=await api('/secrets');
 const hasPublic=secrets.some(s=>s.name==='VAPID_PUBLIC_KEY'),hasPrivate=secrets.some(s=>s.name==='VAPID_PRIVATE_KEY');
 if(hasPublic!==hasPrivate)throw Error('Incomplete VAPID setup. Refusing to rotate existing push keys.');
 // Existing VAPID keys must be preserved: rotating them invalidates subscriptions.
 if(!hasPrivate){const vapid=webpush.generateVAPIDKeys();await api('/secrets',{method:'POST',body:[{name:'VAPID_PUBLIC_KEY',value:vapid.publicKey},{name:'VAPID_PRIVATE_KEY',value:vapid.privateKey}]});}
 let cronSecret;
 const existingCron=await query("select decrypted_secret from vault.decrypted_secrets where name='campus_reminder_cron_secret'");
 cronSecret=existingCron[0]?.decrypted_secret||randomBytes(32).toString('base64url');
 await api('/secrets',{method:'POST',body:[{name:'CRON_SECRET',value:cronSecret}]});
 await query(await readFile(resolve(root,'supabase/migrations/202610100001_reminders.sql'),'utf8'));
 // Single-file bundle avoids multipart relative-path differences in the API.
 const files=['schedule.js','handler.js','store.js'];
 const shared=await Promise.all(files.map(async name=>(await readFile(resolve(root,'supabase/functions/_shared/'+name),'utf8')).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'')));
 const entry=(await readFile(resolve(root,'supabase/functions/campus-reminders/index.ts'),'utf8')).replace(/^import .* from '\.\..*;\s*$/gm,'');
 const form=new FormData();form.append('metadata',JSON.stringify({name:'campus-reminders',entrypoint_path:'index.ts',verify_jwt:false}));form.append('file',new Blob([shared.join('\n')+'\n'+entry],{type:'application/typescript'}),'index.ts');
 await api('/functions/deploy?slug=campus-reminders',{method:'POST',body:form});
 const health=await fetch(backendUrl+'/config',{signal:AbortSignal.timeout(30000)});if(!health.ok)throw Error('Deployed reminder endpoint did not pass its health check');
 const ready=await health.json();if(!ready.ready||!/^[A-Za-z0-9_-]{87}$/.test(ready.publicKey||''))throw Error('Invalid VAPID public configuration');
 await vault('campus_reminder_endpoint',backendUrl);await vault('campus_reminder_cron_secret',cronSecret);
 const zone=await query("select coalesce(current_setting('cron.timezone',true),'GMT') as timezone");
 if(!['GMT','UTC','Etc/UTC'].includes(zone[0]?.timezone))throw Error('Cron is not configured for UTC. Refusing to install an incorrectly timed job.');
 await query(await readFile(resolve(root,'supabase/install-cron.sql'),'utf8'));
 const jobs=await query("select schedule,active from cron.job where jobname='campus-schedule-reminders'");if(jobs.length!==1||!jobs[0].active||jobs[0].schedule!=='30-39 11 * * *')throw Error('Daily Beijing schedule was not confirmed');
 await writeFile(resolve(root,'dist/push-config.json'),JSON.stringify({backendUrl,status:'ready',timezone:'Asia/Shanghai',time:'19:30'},null,2)+'\n');
 console.log('Reminder backend and daily 19:30 Beijing schedule verified. Publish dist/push-config.json to the existing GitHub Pages site.');
}catch(error){console.error(error.message);process.exitCode=1;}
