const DAY=86400000,OFFSET=8*3600000;
export function weeksOf(input){
 const text=String(input).replace(/\s|周/g,'').replace(/[，、]/g,',').replace(/（/g,'(').replace(/）/g,')').replace(/[–—~]/g,'-');
 const parity=text.endsWith('(单)')?1:text.endsWith('(双)')?0:null;
 const body=text.replace(/\([单双]\)$/,'');if(!body)throw Error('周次不能为空');
 const result=new Set();
 for(const part of body.split(',')){const m=part.match(/^(\d+)(?:-(\d+))?$/);if(!m)throw Error('周次格式不正确');const first=+m[1],last=+(m[2]||m[1]);if(first<1||last>30||last<first)throw Error('周次必须在 1–30 之间');for(let w=first;w<=last;w++)if(parity===null||w%2===parity)result.add(w);}
 if(!result.size)throw Error('周次没有匹配的教学周');return result;
}
function dateValue(text){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text||''))throw Error('请先设置第一周的周一');
 const date=new Date(text+'T00:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==text)throw Error('学期日期无效');return date;
}
export function cleanSchedule(value){
 if(!value||typeof value!=='object')throw Error('课表数据无效');
 const start=dateValue(value.semesterStart);if(start.getUTCDay()!==1)throw Error('第一周起始日期必须为周一');
 if(!Array.isArray(value.periods)||value.periods.length!==12)throw Error('请检查 12 节课的作息时间');
 const periods=value.periods.map(p=>{if(!Array.isArray(p)||p.length!==2||p.some(t=>typeof t!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))||p[0]>=p[1])throw Error('作息时间无效');return [...p];});
 if(!Array.isArray(value.courses)||value.courses.length>2000)throw Error('课表最多支持 2000 条安排');
 const courses=value.courses.map(c=>{
  if(!c||typeof c.name!=='string'||!c.name.trim()||c.name.length>100||typeof c.room!=='string'||c.room.length>200||!Number.isInteger(c.weekday)||c.weekday<1||c.weekday>7||!Number.isInteger(c.startPeriod)||!Number.isInteger(c.endPeriod)||c.startPeriod<1||c.endPeriod>12||c.endPeriod<c.startPeriod||typeof c.weeks!=='string'||c.weeks.length>200)throw Error('课程安排无效');
  weeksOf(c.weeks);return {name:c.name.trim(),room:c.room,weekday:c.weekday,startPeriod:c.startPeriod,endPeriod:c.endPeriod,weeks:c.weeks};
 });
 return {semesterStart:value.semesterStart,periods,courses};
}
export function beijingClock(now=new Date()){
 const d=new Date(+now+OFFSET);return {date:d.toISOString().slice(0,10),hour:d.getUTCHours(),minute:d.getUTCMinutes()};
}
export function inDispatchWindow(now=new Date()){const c=beijingClock(now);return c.hour===19&&c.minute>=30&&c.minute<=39;}
export function tomorrowCourses(schedule,now=new Date()){
 const date=new Date(beijingClock(now).date+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+1);
 const targetDate=date.toISOString().slice(0,10),week=Math.floor((+date-+dateValue(schedule.semesterStart))/(7*DAY))+1,weekday=(date.getUTCDay()+6)%7+1;
 const courses=week<1||week>30?[]:schedule.courses.filter(c=>c.weekday===weekday&&weeksOf(c.weeks).has(week)).sort((a,b)=>a.startPeriod-b.startPeriod||a.endPeriod-b.endPeriod||a.name.localeCompare(b.name,'zh-CN')).map(c=>({...c,startTime:schedule.periods[c.startPeriod-1][0],endTime:schedule.periods[c.endPeriod-1][1]}));
 return {targetDate,week,courses};
}
export function reminderPayload(schedule,now=new Date()){
 const {targetDate,week,courses}=tomorrowCourses(schedule,now);if(!courses.length)return null;
 const [,month,day]=targetDate.split('-');
 const lines=courses.map(c=>`${c.startTime}–${c.endTime} ${c.name.slice(0,40)} · ${(c.room||'教室待定').slice(0,60)}`);
 const payload={title:`明天 ${+month}月${+day}日 · ${courses.length} 条课程安排`,body:'',tag:'campus-next-day-'+targetDate,data:{targetDate,week,url:'#today'}};
 // Keep the encrypted Web Push payload below browser push-service limits.
 let shown=0;for(const line of lines){const candidate=lines.slice(0,shown+1).join('\n')+(shown+1<lines.length?`\n另有 ${lines.length-shown-1} 条，点击查看课表`:'');payload.body=candidate;if(new TextEncoder().encode(JSON.stringify(payload)).length>2800){payload.body=lines.slice(0,shown).join('\n')+`\n另有 ${lines.length-shown} 条，点击查看课表`;break;}shown++;}
 return payload;
}
