import test from 'node:test';import assert from 'node:assert/strict';import {notificationPlan} from '../native/reminder-plan.js';
const s={semesterStart:'2026-10-12',periods:[['08:20','09:00']],courses:[{name:'工程力学',weekday:4,startPeriod:1,weeks:'1-3(单)',room:'E213'}]};
test('Beijing time and odd weeks',()=>{const p=notificationPlan(s,Date.parse('2026-10-14T18:00:00+08:00'));assert.equal(p.length,2);assert.equal(p[0].schedule.at.toISOString(),'2026-10-14T11:30:00.000Z');assert.equal(p[1].schedule.at.toISOString(),'2026-10-28T11:30:00.000Z');assert.match(p[0].body,/08:20 工程力学/);});
test('Skip past reminders',()=>assert.equal(notificationPlan(s,Date.parse('2026-10-14T20:00:00+08:00')).length,1));
test('No courses means no reminders',()=>assert.deepEqual(notificationPlan({...s,courses:[]}),[]));
test('Missing date rejected',()=>assert.throws(()=>notificationPlan({courses:[]})));
