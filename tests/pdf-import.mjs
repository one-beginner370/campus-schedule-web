import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const fixture=process.env.PDF_FIXTURE;if(!fixture)throw Error('Set PDF_FIXTURE to the private test PDF path; fixture files are never published.');
const root=resolve('dist'),origin=process.env.TIMETABLE_URL||'http://127.0.0.1:8769';
const server=process.env.TIMETABLE_URL?null:createServer(async(req,res)=>{try{let path=resolve(root,'.'+decodeURIComponent(new URL(req.url,origin).pathname));assert(path.startsWith(root));if((await stat(path)).isDirectory())path=resolve(path,'index.html');res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.bcmap':'application/octet-stream'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}});
if(server)await new Promise(r=>server.listen(8769,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true}),page=await ctx.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));for(let attempt=0;attempt<4;attempt++){try{await page.goto(origin+'/?v=14#import',{waitUntil:'domcontentloaded',timeout:45000});await page.waitForFunction(()=>window.campusAppReady);break;}catch(error){if(attempt===3)throw error;await page.waitForTimeout(1000);}}
 await page.locator('#file-input').setInputFiles(fixture);await page.locator('#confirm-import').waitFor({timeout:180000});
 const raw=await page.locator('.raw-text').innerText();
 const rows=await page.locator('.preview-row').allTextContents();assert.equal(rows.length,24);assert.equal(await page.locator('.preview-row.invalid').count(),0);assert(await page.locator('#confirm-import').isEnabled());
 assert.match(await page.locator('.preview-heading').innerText(),/7 门课程/);assert.deepEqual(await page.locator('.recognition-report strong').allTextContents(),['4','2','6','4','7','1','0']);
 await page.locator('#confirm-import').click();const data=await page.evaluate(()=>window.campusGetSchedule());
 assert.equal(data.courses.length,24);
 const count=await page.evaluate(async({raw,courses})=>{const {parseColumn,merge}=await import('./core.js?v=11');const cols=raw.split(/星期[1-7]\r?\n/).slice(1);return merge(cols.flatMap((text,i)=>parseColumn(text,i+1).courses),courses).length;},{raw,courses:data.courses});assert.equal(count,24,'Upgrade import must not duplicate existing saved arrangements');assert.equal(new Set(data.courses.map(c=>c.name)).size,7);
 const wed=data.courses.filter(c=>c.weekday===3&&c.name==='工程力学');assert.deepEqual(wed.map(c=>[c.weeks,c.room]),[['2-3','敷文园F-412'],['4-5','敷文园F-510'],['6-11','敷文园F-212'],['12-15','敷文园F-305']]);
 const thu=data.courses.filter(c=>c.weekday===4&&c.name==='创新创业基础');assert.deepEqual(thu.map(c=>[c.weeks,c.room]),[['15','敷文园F-213'],['17','敷文园F-307']]);
 // Independent transcription from the supplied three-page PDF, not parser output.
 const expected=[
 ['工程地质与土力学',1,1,4,'13-14','东盟实验大楼A204-土工实验室'],['混凝土结构基本原理',1,3,4,'2-5,7-9','敷文园D-408'],['工程地质与土力学',1,7,8,'8-11','敷文园D-406'],['工程地质与土力学',1,7,8,'12-15','敷文园D-406'],
 ['工程地质与土力学',2,1,4,'13-14','东盟实验大楼A204-土工实验室'],['创新创业基础',2,3,4,'15-17(单)','敷文园F-205'],
 ['工程力学',3,1,2,'2-3','敷文园F-412'],['工程力学',3,1,2,'4-5','敷文园F-510'],['工程力学',3,1,2,'6-11','敷文园F-212'],['工程力学',3,1,2,'12-15','敷文园F-305'],['中国近现代史纲要',3,5,6,'1-16','敷文园F-102'],['混凝土结构基本原理',3,7,8,'1-15','敷文园D-312'],
 ['中国近现代史纲要',4,1,2,'1-3,17','敷文园F-101'],['创新创业基础',4,3,4,'15','敷文园F-213'],['创新创业基础',4,3,4,'17','敷文园F-307'],['形势与政策',4,5,6,'13-16','敷文园F-102'],
 ['工程力学',5,1,2,'2-3,6-12','敷文园E-213'],['工程力学',5,1,2,'13','敷文园E-206'],['混凝土结构基本原理',5,1,4,'15','实训大棚101-建筑材料实验室'],['职业生涯发展和就业指导',5,5,6,'6-9','东盟实验大楼A402-土建智慧听评室1'],['职业生涯发展和就业指导',5,5,6,'10','其它场地'],['工程地质与土力学',5,7,8,'8-11','敷文园D-215'],['工程地质与土力学',5,7,8,'12-15','敷文园D-215'],['创新创业基础',6,1,4,'16,19','未排地点']];
 assert.deepEqual(data.courses.map(c=>[c.name,c.weekday,c.startPeriod,c.endPeriod,c.weeks,c.room]),expected);
 // Select week six. One subject card contains both Friday engineering variants.
 for(let i=0;i<30;i++){const week=Number((await page.locator('#week-label').innerText()).match(/\d+/)[0]);if(week===6)break;await page.locator(week<6?'#next-week':'#previous-week').click();}
 const friday=page.locator('[data-course-group]').filter({hasText:'工程力学'}).last();await friday.click();
 assert.equal(await page.locator('#arrangements-list .arrangement-heading strong').filter({hasText:'工程力学'}).count(),1);assert.equal(await page.locator('#arrangements-list .arrangement-row').count(),2);
 const engineering=page.locator('#arrangements-list .arrangement-row').filter({has:page.locator('.arrangement-heading strong',{hasText:'工程力学'})});assert.equal(await engineering.locator('[data-course]').count(),2);assert.match(await engineering.innerText(),/E-213/);assert.match(await engineering.innerText(),/E-206/);
 await page.screenshot({path:'tmp/pdfs/phase-card.png',fullPage:true});await page.locator('#arrangements-dialog [data-close-dialog]').click();
 // Week thirteen must use E-206 rather than the week-six room.
 for(let i=0;i<7;i++)await page.locator('#next-week').click();await page.locator('[data-course-group]').filter({hasText:'工程力学'}).last().click();assert.match(await page.locator('#arrangements-list .current-variant').innerText(),/E-206/);
 await page.locator('#arrangements-dialog [data-close-dialog]').click();await page.locator('[data-tab=import]').click();await page.locator('#file-input').setInputFiles(fixture);await page.locator('#confirm-import').waitFor({timeout:180000});await page.locator('#confirm-import').click();assert.equal(await page.evaluate(()=>window.campusGetSchedule().courses.length),24);
 assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));console.log('PASS: supplied three-page PDF, 24 independently verified arrangements / 7 subjects, all week/room variants and cross-page record, one card per subject, week 6/13 room switch, duplicate import and mobile layout');
}finally{await browser.close();if(server)server.close();}
