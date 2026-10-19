import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../dist/reminders.js',import.meta.url),'utf8');
function harness({supported=true,failFirst=false}={}){
 const elements=new Map(),events=new Map();let calls=0,configAttempts=0;
 const element=id=>{if(!elements.has(id))elements.set(id,{id,hidden:false,disabled:false,textContent:'',classList:{toggle(){}},after(node){elements.set(node.id,node);}});return elements.get(id);};
 const serviceWorker={register:async()=>({}),addEventListener(){}};
 const window={campusAppReady:false,addEventListener:(name,fn)=>events.set(name,fn)};
 if(supported)Object.assign(window,{Notification:{permission:'default'},PushManager:{}});
 const context={window,document:{getElementById:element,createElement:()=>element('new')},navigator:{serviceWorker},Notification:window.Notification,localStorage:{getItem:()=>null},AbortSignal,URL,console,fetch:async url=>{
  calls++;
  if(url==='./push-config.json')return {ok:true,json:async()=>({backendUrl:'https://example.com/reminders'})};
  if(failFirst&&configAttempts++===0)throw new TypeError('Load failed');
  return {ok:true,json:async()=>({ready:true,publicKey:'A'.repeat(87)})};
 }};
 vm.runInNewContext(source,context);return {elements,events,callCount:()=>calls};
}
test('Reminder connection can recover from a network failure without reloading',async()=>{
 const h=harness({failFirst:true});await h.events.get('campus-app-ready')();
 assert.match(h.elements.get('reminder-status').textContent,/连接提醒服务失败/);
 assert.equal(h.elements.get('retry-reminders').hidden,false);
 assert.equal(h.elements.get('enable-reminders').disabled,true);
 await h.elements.get('retry-reminders').onclick();
 assert.equal(h.elements.get('retry-reminders').hidden,true);
 assert.equal(h.elements.get('enable-reminders').disabled,false);
 assert.match(h.elements.get('reminder-status').textContent,/尚未启用/);
});
test('Unsupported iPhone/browser shows setup guidance rather than a remote load error',async()=>{
 const h=harness({supported:false});await h.events.get('campus-app-ready')();
 assert.match(h.elements.get('reminder-status').textContent,/先添加到主屏幕/);
 assert.equal(h.elements.get('enable-reminders').disabled,true);
 assert.equal(h.callCount(),1);
});
