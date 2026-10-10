import test from 'node:test';
import assert from 'node:assert/strict';
import {parseScheduleColumn,parseScheduleColumns,inferColumns,pageColumns,canonicalWeeks,documentColumns} from '../dist/recognition.js';
import {occurs,merge} from '../dist/core.js';
test('Same cell: different courses and week ranges are separate arrangements',()=>{
 const text='工程力学\n（1—2节）3-8周/场地：E-212/教师：甲\n建筑学\n（1-2节）9-11周/场地：A403/教师：乙';
 const r=parseScheduleColumn(text,3);assert.equal(r.courses.length,2);assert.deepEqual(r.courses.map(c=>[c.name,c.weeks,c.room,c.teacher]),[['工程力学','3-8','E-212','甲'],['建筑学','9-11','A403','乙']]);assert.deepEqual(r.issues,[]);
 assert.equal(r.courses.filter(c=>occurs(c,6))[0].name,'工程力学');assert.equal(r.courses.filter(c=>occurs(c,10))[0].name,'建筑学');assert.equal(merge([],r.courses).length,2);
});
test('Repeated course title is optional; each week/room/teacher variant survives',()=>{
 for(const text of ['工程力学\n(1-2节)3-8周/教室:E-212/教师:甲\n(1-2节)9-11周/教室:E-213/教师:乙','工程力学\n(1-2节)3-8周/教室:E-212/教师:甲\n9-11周/教室:E-213/教师:乙']){
  const r=parseScheduleColumn(text,1);assert.equal(r.courses.length,2);assert.deepEqual(r.courses.map(c=>[c.name,c.weeks,c.room,c.teacher]),[['工程力学','3-8','E-212','甲'],['工程力学','9-11','E-213','乙']]);assert.deepEqual(r.issues,[]);
 }
});
test('Wrapped long names, cross-page metadata, alternate period syntax and odd weeks',()=>{
 const r=parseScheduleColumn('职业\n生涯发展\n和就业\n指导\n第５至６节 6-9周/上课地点：东盟实验大楼A402-\n土建智慧听评室1/授课教师：唐老师/学分：0.5\n创新创业基础\n[3-4节]15-17周（单）/场地:F-205/教师:梁老师',5);
 assert.equal(r.courses.length,2);assert.equal(r.courses[0].name,'职业生涯发展和就业指导');assert.equal(r.courses[0].room,'东盟实验大楼A402-土建智慧听评室1');assert.equal(r.courses[1].weeks,'15-17(单)');assert.deepEqual(r.issues,[]);
 assert.equal(canonicalWeeks('1-8周(单),10-16周(双)'),'1,3,5,7,10,12,14,16');
});
test('Incomplete records stay visible for correction; only exact duplicates are removed',()=>{
 const r=parseScheduleColumns(['力学\n(1-2节)3-8周/场地:A\n力学\n(1-2节)9-11周/场地:B\n未知安排\n(5-6节)/场地:C']);assert.equal(r.courses.length,3);assert.equal(r.stats.needsReview,1);assert.equal(r.issues.length,1);
 const text='力学\n(1-2节)3-8周/场地:A/教师:甲\n力学\n(1-2节)3-8周/场地:A/教师:甲';assert.equal(parseScheduleColumns([text]).courses.length,1);
});
test('Column geometry follows weekday headers and continues across pages',()=>{
 const width=1000,headers=Array.from({length:7},(_,i)=>({str:'星期'+'一二三四五六日'[i],x:200+i*100,y:50,width:40,height:12}));
 const layout=inferColumns(headers,width);assert.equal(layout.confidence,'headers');assert(Math.abs(layout.ranges[0][0]-.17)<.001);
 const continued=inferColumns([],width,layout);assert.equal(continued.confidence,'continued');
 const items=[...headers,{str:'工程力学',x:202,y:80,width:40,height:10},{str:'(1-2节)3-8周/教室:E-212',x:202,y:94,width:95,height:10},{str:'建筑学',x:302,y:80,width:40,height:10},{str:'(1-2节)9-11周/教室:A403',x:302,y:94,width:95,height:10}];
 const r=parseScheduleColumns(pageColumns(items,width,layout));assert.deepEqual(r.courses.map(c=>[c.name,c.weekday,c.weeks]),[['工程力学',1,'3-8'],['建筑学',2,'9-11']]);
});
test('A scanned middle page stays in reading order and keeps the preceding title',()=>{
 const pages=[{columns:['力学\n(1-2节)3-8周/教室:A/教师:甲\n创新创业基础']},{columns:[''],ocrColumns:['(3-4节)15周/教室:F-213/教师:乙'],preferOCR:true},{columns:['创新创业基础\n(3-4节)17周/教室:F-307/教师:乙']}];
 const r=parseScheduleColumns(documentColumns(pages));assert.equal(r.courses.length,3);assert.deepEqual(r.courses.map(c=>[c.name,c.weeks,c.room]),[['力学','3-8','A'],['创新创业基础','15','F-213'],['创新创业基础','17','F-307']]);assert.deepEqual(r.issues,[]);
});
