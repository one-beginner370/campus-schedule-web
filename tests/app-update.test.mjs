import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const sw=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
test('Previously cached account scripts are refreshed from network',async()=>{
 const events=new Map();let result,network=0;
 const stale={version:'old'},fresh={ok:true,redirected:false,version:'new',clone(){return this;}};
 vm.runInNewContext(sw,{importScripts(){},URL,self:{location:{origin:'https://example.com',href:'https://example.com/campus/sw.js'},addEventListener:(name,fn)=>events.set(name,fn)},caches:{open:async()=>({match:async()=>stale,put:async()=>{}})},fetch:async()=>{network++;return fresh;}});
 events.get('fetch')({request:{url:'https://example.com/campus/cloud-sync.js?v=4',method:'GET',mode:'cors'},respondWith(p){result=p;}});
 assert.equal((await result).version,'new');assert.equal(network,1);
});
const html=await readFile(new URL('../dist/update.html',import.meta.url),'utf8');const code=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function update({fail=false}={}){
 const els=new Map();const el=id=>{if(!els.has(id))els.set(id,{disabled:false,events:{},addEventListener(k,v){this.events[k]=v;}});return els.get(id);};
 let target=null,options=null;const records=new Map([['campus-schedule-v1','saved-course-data']]);
 vm.runInNewContext(code,{document:{getElementById:el},URLSearchParams,AbortSignal,location:{search:'',replace:u=>{target=u;}},navigator:{serviceWorker:{register:async(_url,opts)=>{options=opts;return {active:{state:'activated'},update:async()=>{}};}}},fetch:async()=>{if(fail)throw Error('offline');return {ok:true};},localStorage:{clear(){records.clear();}},setTimeout,clearTimeout});
 return {els,records,run:()=>el('update').events.click(),get target(){return target;},get options(){return options;}};
}
test('Update entry opens the separate registration page and preserves local course data',async()=>{
 const h=update();await h.run();assert.equal(h.target,'./register.html?v=23');assert.equal(h.options.updateViaCache,'none');assert.equal(h.records.get('campus-schedule-v1'),'saved-course-data');
});
test('Offline update stays on the retryable page and does not clear courses',async()=>{
 const h=update({fail:true});await h.run();assert.equal(h.target,null);assert.equal(h.els.get('update').disabled,false);assert.equal(h.records.size,1);
});
