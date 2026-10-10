import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('dist'),origin=process.env.TIMETABLE_URL||'http://127.0.0.1:8768';
const server=process.env.TIMETABLE_URL?null:createServer(async(req,res)=>{try{let path=resolve(root,'.'+decodeURIComponent(new URL(req.url,origin).pathname));assert(path.startsWith(root));if((await stat(path)).isDirectory())path=resolve(path,'index.html');res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}});
if(server)await new Promise(r=>server.listen(8768,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
const course=(id,name,day,start,end,weeks='1-16',room='敦文园 E-212')=>({id,name,weekday:day,startPeriod:start,endPeriod:end,weeks,room,teacher:'教师'});
const courses=[
 course('a','工程力学',1,1,2),course('b','工程地质与土力学',1,1,4,'1-3','东盟实验大楼 A204'),course('c','建筑结构与机电识图',1,5,6,'1-3'),
 course('d','房屋建筑学',2,1,2,'1-16','东盟实验大楼 A403'),course('e','房屋建筑课程设计',2,5,8,'1-3','新工科大楼 304'),
 course('f','工程力学',3,1,2),course('g','无人机智能应用基础',3,3,4,'1-3'),course('h','中国近现代史纲要',3,5,6),course('i','混凝土结构基本原理',3,7,8),
 course('j','中国近现代史纲要',4,1,2,'1-3'),course('k','形势与政策',4,5,6,'1-3'),course('l','房屋建筑学',4,7,8),
 course('m','工程力学',5,1,2),course('n','职业生涯发展和就业指导',5,5,6),course('o','无人机智能应用基础',5,7,8),
 course('p','周末课程',7,9,10),course('q','替代实验安排',3,3,4,'2-4'),
 course('r','相邻时段安排',6,3,4),course('s','第二条相邻安排',6,5,6),course('t','跨度安排',6,2,5,'1-3'),
 course('u','本周重叠安排',5,2,3),course('x','<img src=x onerror=alert(1)>',2,10,11,'1-3')
];
const fixture={semesterStart:'2026-09-07',courses,periods:Array.from({length:12},(_,i)=>[`${String(8+Math.floor(i*.9)).padStart(2,'0')}:${i%2?'10':'20'}`,`${String(8+Math.floor(i*.9)).padStart(2,'0')}:${i%2?'50':'59'}`]),weekends:true,updatedAt:1};
try{
 for(const width of [320,393,430,768,1366]){
  const ctx=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500});
  await ctx.addInitScript(f=>{if(!localStorage.getItem('campus-schedule-web-v1'))localStorage.setItem('campus-schedule-web-v1',JSON.stringify(f));},fixture);
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?v=13#week');await page.waitForFunction(()=>window.campusAppReady);
  // Explicit week six ensures the fixture is independent of the machine date.
  for(let n=0;n<30;n++){const w=Number((await page.locator('#week-label').innerText()).match(/\d+/)[0]);if(w===6)break;await page.locator(w<6?'#next-week':'#previous-week').click();}
  assert.equal(await page.locator('[data-display-mode=all]').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('#week-summary').innerText(),new RegExp('全部 '+courses.length+' 条'));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const grid=await page.locator('#schedule-grid').boundingBox(),sunday=await page.locator('.grid-header').last().boundingBox();assert(sunday.x+sunday.width<=grid.x+grid.width+1);
  // Every imported record must be reachable: direct card or its overlap group.
  const found=new Set(await page.locator('#schedule-grid [data-course]').evaluateAll(nodes=>nodes.map(n=>n.dataset.course)));
  const groups=await page.locator('[data-course-group]').count();
  for(let i=0;i<groups;i++){
   const button=page.locator('[data-course-group]').nth(i);await button.click();
   const ids=await page.locator('#arrangements-list [data-course]').evaluateAll(nodes=>nodes.map(n=>n.dataset.course));ids.forEach(id=>found.add(id));
   assert.equal(Number(await button.locator('.arrangement-count').innerText()),ids.length);
   await page.locator('#arrangements-dialog [data-close-dialog]').click();
  }
  assert.deepEqual([...found].sort(),courses.map(c=>c.id).sort());assert.equal(await page.locator('#schedule-grid img').count(),0);
  assert.equal(await page.locator('[data-course-group]').first().evaluate(el=>el.style.gridRow),'2 / 4');
  assert(await page.locator('.inactive-course').count()>0);assert(await page.locator('.conflict').count()>0);
  if(width===393)await page.screenshot({path:'timetable-mobile.png',fullPage:true});
  // Open an arrangement hidden behind the badge and edit it.
  await page.locator('[data-course-group]').first().click();await page.locator('#arrangements-list [data-course=b]').click();assert.equal(await page.locator('#course-form [name=name]').inputValue(),'工程地质与土力学');
  await page.locator('#course-form [name=room]').fill('修改后的教室 A205');await page.locator('#course-form button[type=submit]').click();
  assert.equal(await page.evaluate(()=>window.campusGetSchedule().courses.find(c=>c.id==='b').room),'修改后的教室 A205');
  await page.locator('[data-display-mode=week]').click();assert.equal(await page.locator('.inactive-course').count(),0);
  await page.reload();await page.waitForFunction(()=>window.campusAppReady);assert.equal(await page.locator('[data-display-mode=week]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-display-mode=all]').click();await page.locator('#weekends').uncheck();assert.equal(await page.locator('.grid-header').count(),6);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#install-help').click();assert(await page.locator('#help-dialog').isVisible());await page.locator('#help-dialog .dialog-heading [data-close-dialog]').click();
  for(const tab of ['today','import','settings']){await page.locator(`[data-tab=${tab}]`).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  assert.deepEqual(errors,[]);await ctx.close();console.log(`PASS ${width}px: all arrangements reachable, gray inactive, conflict badge, editor, mode persistence, seven columns and all tabs`);
 }
}finally{await browser.close();if(server)server.close();}
