import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../dist/cloud-sync.js',import.meta.url),'utf8');
function setup(status){
 let calls=0;const initial={access_token:'test',refresh_token:'test',expires_at:1};
 const storage=new Map([['campus-cloud-session-v1',JSON.stringify(initial)]]);
 const context=vm.createContext({window:{addEventListener(){}},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},AbortSignal,fetch:async()=>{calls++;return {status,ok:false,headers:{get:()=> '30'},json:async()=>({})}}});
 vm.runInContext(source,context);return {context,storage,calls:()=>calls,request:()=>vm.runInContext("request('/rest/v1/campus_schedules')",context)};
}
test('Busy refresh preserves the session and suppresses repeated requests',async()=>{
 for(const status of [429,503]){const h=setup(status);await assert.rejects(h.request(),/繁忙/);await assert.rejects(h.request(),/等待/);assert.equal(h.calls(),1);assert.ok(h.storage.has('campus-cloud-session-v1'));}
});
test('Invalid refresh still expires the session',async()=>{const h=setup(401);await assert.rejects(h.request(),/已过期/);assert.equal(h.storage.size,0);});
