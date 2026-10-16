import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalWeeks,parseScheduleColumn} from '../dist/recognition.js';
import {weekSet} from '../dist/core.js';
test('each comma-separated range keeps its own parity',()=>{
 assert.equal(canonicalWeeks('4-6周(双),7-8周'),'4,6,7,8');
 assert.equal(canonicalWeeks('10-12周,17-19周(单)'),'10,11,12,17,19');
});
test('PDF line break inside parity is preserved',()=>{
 for(const suffix of ['(单\n)','(\n单)','(\n单\n)']){
 const r=parseScheduleColumn('测试课程\n(3-4节)10-12周,17-19周'+suffix+'/场地:教室A/教师:老师',5);
 assert.deepEqual([...weekSet(r.courses[0].weeks)],[10,11,12,17,19]);
 assert.equal(r.courses[0].room,'教室A');
 }
});
