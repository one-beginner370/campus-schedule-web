import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import {createECDH,randomBytes} from 'node:crypto';
const root=resolve('dist'),origin='http://127.0.0.1:8767';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{try{const file=resolve(root,'.'+decodeURIComponent(new URL(req.url,origin).pathname));assert(file.startsWith(root));const path=(await stat(file)).isDirectory()?resolve(file,'index.html'):file;res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end('Not found');}});
await new Promise(r=>server.listen(8767,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
const fixture={semesterStart:'2026-09-07',courses:[{id:'fixture',name:'明日测试课',room:'E-213',teacher:'',weekday:1,startPeriod:1,endPeriod:2,weeks:'1-16'}],periods:Array.from({length:12},(_,i)=>[`${String(i+8).padStart(2,'0')}:00`,`${String(i+8).padStart(2,'0')}:45`]),weekends:true,updatedAt:1};
try{
 // Disconnected production state must not request permission or claim success.
 const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/#settings');await page.waitForFunction(()=>window.campusAppReady);await page.waitForFunction(()=>document.querySelector('#reminder-status').textContent.includes('后台尚未连接'));
 assert(await page.locator('#enable-reminders').isDisabled());assert(await page.locator('#test-reminder').isHidden());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'disconnected-mobile.png',fullPage:true});assert.deepEqual(errors,[]);await context.close();
 // Native permission/subscription objects are mocked only for client API-flow QA.
 const keys=webpush.generateVAPIDKeys(),dh=createECDH('prime256v1');dh.generateKeys();const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{p256dh:dh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
 const live=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true,permissions:['notifications']});
 await live.addInitScript(({fixture,subscription})=>{
  localStorage.setItem('campus-schedule-web-v1',JSON.stringify(fixture));let active=false;
  const sub={options:{},toJSON:()=>subscription,unsubscribe:async()=>{active=false;window.unsubscribed=true;return true;}};
  PushManager.prototype.getSubscription=async()=>active?sub:null;PushManager.prototype.subscribe=async()=>{active=true;return sub;};
 },{fixture,subscription});
 const p=await live.newPage(),requests=[],liveErrors=[];p.on('pageerror',e=>liveErrors.push(e.message));
 let cloud=null,delayNext=false,resolveUpload;
 await p.route('**/push-config.json',route=>route.fulfill({json:{backendUrl:'https://push.test/functions/v1/campus-reminders',status:'ready'}}));
 await p.route('https://push.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname.split('/').pop(),body=req.postDataJSON();requests.push({method:req.method(),path,body});
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,PUT,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'}});
  let result={};if(path==='config')result={ready:true,publicKey:keys.publicKey};
  if(path==='subscription'&&req.method()==='PUT'){if(delayNext){delayNext=false;await new Promise(r=>resolveUpload=r);}cloud=body;result={enabled:true,syncedAt:new Date().toISOString(),revision:body.revision};}
  if(path==='subscription'&&req.method()==='DELETE'){cloud=null;result={enabled:false};}
  if(path==='test')result={accepted:true,message:'推送服务已接受测试通知，请在手机通知栏确认。'};
  await route.fulfill({json:result,headers:{'Access-Control-Allow-Origin':origin}});
 });
 await p.goto(origin+'/#settings');await p.waitForFunction(()=>window.campusAppReady);await p.locator('#enable-reminders').waitFor();await p.waitForFunction(()=>!document.querySelector('#enable-reminders').disabled);
 await p.locator('#enable-reminders').click();await p.waitForFunction(()=>document.querySelector('#reminder-status').textContent.startsWith('已启用'));
 assert.equal(cloud.schedule.courses[0].name,'明日测试课');assert.equal('teacher'in cloud.schedule.courses[0],false);
 await p.locator('#test-reminder').click();await p.waitForFunction(()=>document.querySelector('#reminder-status').textContent.includes('接受测试通知'));
 // Modify the existing app through its form; changes must auto-sync.
 await p.locator('[data-tab="week"]').click();await p.locator('#add-course').click();await p.locator('#course-form [name=name]').fill('新课程自动同步');await p.locator('#course-form button[type=submit]').click();
 await p.waitForFunction(()=>document.querySelector('#reminder-status').textContent.startsWith('已启用'));assert.equal(cloud.schedule.courses.length,2);
 // Disable during an upload: cloud DELETE must run after the outstanding PUT.
 await p.locator('[data-tab="settings"]').click();delayNext=true;await p.locator('#sync-reminders').click();await p.waitForTimeout(200);assert(resolveUpload);
 await p.locator('#disable-reminders').click();resolveUpload();await p.waitForFunction(()=>document.querySelector('#reminder-status').textContent.includes('已关闭'));
 assert.equal(cloud,null);assert(await p.evaluate(()=>window.unsubscribed));assert.equal(requests.filter(r=>r.path==='subscription').at(-1).method,'DELETE');
 await p.goto(origin+'/?reminderDate=2026-10-12#today');await p.waitForFunction(()=>window.campusAppReady);assert.equal(await p.locator('#today-view h1').innerText(),'课程提醒');assert.match(await p.locator('#today-date').innerText(),/10月12日/);assert.match(await p.locator('#today-content').innerText(),/明日测试课/);await p.locator('#show-today').click();assert(!p.url().includes('reminderDate'));
 assert.deepEqual(liveErrors,[]);await live.close();console.log('PASS: disconnected UI, permission/subscription flow (mocked), minimal data sync, test API, auto-sync, disable/upload race and target date');
 // Exercise the actual Service Worker after closing the site's page. DevTools
 // injects the push event; this verifies background handling, not a push gateway.
 const background=await browser.newContext({permissions:['notifications']}),bg=await background.newPage(),cdp=await background.newCDPSession(bg);
 let registrationId;cdp.on('ServiceWorker.workerRegistrationUpdated',({registrations})=>{for(const r of registrations)if(r.scopeURL===origin+'/')registrationId=r.registrationId;});
 await cdp.send('ServiceWorker.enable');await bg.goto(origin+'/');await bg.waitForFunction(()=>window.campusAppReady);await bg.evaluate(()=>navigator.serviceWorker.ready);await bg.waitForTimeout(500);assert(registrationId);
 await bg.goto('about:blank');
 await cdp.send('ServiceWorker.deliverPushMessage',{origin,registrationId,data:JSON.stringify({title:'后台课程提醒测试',body:'08:00–09:45 明日测试课 · E-213',tag:'background-test',data:{targetDate:'2026-10-12',url:'#today'}})});
 const check=await background.newPage();await check.goto(origin+'/');await check.waitForFunction(()=>window.campusAppReady);
 await check.waitForFunction(async()=>{const reg=await navigator.serviceWorker.ready;return (await reg.getNotifications()).some(n=>n.tag==='background-test');});
 const notices=await check.evaluate(async()=>{const reg=await navigator.serviceWorker.ready;return (await reg.getNotifications()).map(n=>({title:n.title,body:n.body,data:n.data}));});assert(notices.some(n=>n.title==='后台课程提醒测试'&&n.data.targetDate==='2026-10-12'));
 console.log('PASS: actual Service Worker displays injected push notification while website is closed');await background.close();
}finally{await browser.close();server.close();}
