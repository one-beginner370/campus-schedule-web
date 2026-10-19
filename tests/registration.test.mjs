import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../dist/register.js',import.meta.url),'utf8');
function setup({mismatch=false,consent=true,fail=false}={}){
 const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,checked:false,events:{},classList:{toggle(){}},addEventListener(k,v){this.events[k]=v;},setCustomValidity(v){this.validation=v;}});return elements.get(id);};
 el('register-email').value='  student@example.org  ';el('register-password').value='A-test-password-123';el('register-confirm').value=mismatch?'different':'A-test-password-123';el('register-consent').checked=consent;
 el('registration-form').reportValidity=()=>!el('register-confirm').validation;
 const calls=[];vm.runInNewContext(source,{document:{getElementById:el},AbortSignal,console,fetch:async(url,options)=>{calls.push({url,options});if(fail)throw new TypeError('Load failed');return {ok:true,json:async()=>({user:{id:'test'}})};}});
 return {el,calls,submit:()=>el('registration-form').events.submit({preventDefault(){}})};
}
test('Registration rejects mismatched passwords and missing consent before making a request',async()=>{
 for(const args of [{mismatch:true},{consent:false}]){const h=setup(args);await h.submit();assert.equal(h.calls.length,0);assert.equal(h.el('registration-form').hidden,false);}
});
test('Registration submits only email and password, prevents duplicate clicks, and shows email confirmation',async()=>{
 const h=setup();const first=h.submit();await h.submit();await first;assert.equal(h.calls.length,1);
 assert.deepEqual(JSON.parse(h.calls[0].options.body),{email:'student@example.org',password:'A-test-password-123'});
 assert.equal(h.el('registration-success').hidden,false);assert.equal(h.el('registration-form').hidden,true);
 assert.equal(h.el('registration-email').textContent,'student@example.org');assert.equal(h.el('register-password').value,'');assert.equal(h.el('register-confirm').value,'');
});
test('Network errors leave the registration form available to retry',async()=>{
 const h=setup({fail:true});await h.submit();assert.match(h.el('registration-status').textContent,/网络连接失败或超时/);assert.equal(h.el('register-submit').disabled,false);assert.equal(h.el('registration-form').hidden,false);
});
