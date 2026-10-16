import {weekSet} from '../www/core.js';
const DAY=86400000,OFFSET=8*3600000;
export function notificationPlan(state,now=Date.now()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(state?.semesterStart||''))throw Error('请先保存第一周起始日期');
 const start=Date.parse(state.semesterStart+'T00:00:00+08:00');
 if(!Number.isFinite(start))throw Error('学期日期无效');
 const today=Math.floor((now+OFFSET)/DAY)*DAY-OFFSET,result=[];
 for(let day=0;day<30;day++){
  const at=today+day*DAY+1170*60000;if(at<=now)continue;
  const tomorrow=today+(day+1)*DAY,weekday=(new Date(tomorrow+OFFSET).getUTCDay()+6)%7+1,week=Math.floor((tomorrow-start)/(7*DAY))+1;
  const courses=(state.courses||[]).filter(c=>+c.weekday===weekday&&weekSet(c.weeks)?.has(week)).sort((a,b)=>a.startPeriod-b.startPeriod);
  if(!courses.length)continue;
  result.push({id:1000+day,title:`明天有 ${courses.length} 节课程安排`,body:courses.map(c=>`${state.periods?.[c.startPeriod-1]?.[0]||''} ${c.name} · ${c.room||'教室待定'}`).join('\n').slice(0,1500),schedule:{at:new Date(at)},isExactNotification:false,channelId:'tomorrow-courses'});
 }
 return result;
}
