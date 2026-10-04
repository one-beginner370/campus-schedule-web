export const days=['周一','周二','周三','周四','周五','周六','周日'];
export const periods=[['08:20','09:00'],['09:10','09:50'],['10:10','10:50'],['11:00','11:40'],['14:30','15:10'],['15:20','16:00'],['16:20','17:00'],['17:10','17:50'],['18:40','19:20'],['19:25','20:05'],['20:15','20:55'],['21:00','21:40']];
export function weekSet(input){
 const text=String(input).replace(/\s|周/g,'').replace(/[，、]/g,',').replace(/（/g,'(').replace(/）/g,')').replace(/[–—~]/g,'-');
 const parity=text.endsWith('(单)')?1:text.endsWith('(双)')?0:null;
 const body=text.replace(/\([单双]\)$/,'');if(!body)return null;const result=new Set();
 for(const part of body.split(',')){const m=part.match(/^(\d+)(?:-(\d+))?$/);if(!m)return null;const first=+m[1],last=+(m[2]||m[1]);if(first<1||last>30||last<first)return null;for(let w=first;w<=last;w++)if(parity===null||w%2===parity)result.add(w);}
 return result.size?result:null;
}
export function validate(c){if(!String(c.name||'').trim())return '请填写课程名称';if(!Number.isInteger(+c.weekday)||+c.weekday<1||+c.weekday>7)return '星期必须为 1–7';if(!Number.isInteger(+c.startPeriod)||!Number.isInteger(+c.endPeriod)||+c.startPeriod<1||+c.endPeriod>12||+c.endPeriod<+c.startPeriod)return '请检查开始和结束节次（1–12）';if(!weekSet(c.weeks))return '周次格式不正确，例如 2-5,7-9 或 15-17(单)';return '';}
export function normalize(c){return {id:crypto.randomUUID(),name:String(c.name??'').slice(0,100),weekday:Number(c.weekday),startPeriod:Number(c.startPeriod),endPeriod:Number(c.endPeriod),weeks:String(c.weeks??''),room:String(c.room??'').slice(0,200),teacher:String(c.teacher??'').slice(0,100),source:String(c.source??'文件导入')};}
export function parseLocalDate(text){if(!/^\d{4}-\d{2}-\d{2}$/.test(text||''))return null;const [y,m,d]=text.split('-').map(Number);const date=new Date(y,m-1,d);return date.getFullYear()===y&&date.getMonth()===m-1&&date.getDate()===d?date:null;}
export function dateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function dayOffset(from,to){return Math.round((Date.UTC(to.getFullYear(),to.getMonth(),to.getDate())-Date.UTC(from.getFullYear(),from.getMonth(),from.getDate()))/86400000);}
export function currentWeek(start,now=new Date()){const date=parseLocalDate(start);return date?Math.floor(dayOffset(date,now)/7)+1:null;}
export function occurs(c,week){return weekSet(c.weeks)?.has(week)===true;}
export function merge(existing,incoming){const key=c=>JSON.stringify([c.name,+c.weekday,+c.startPeriod,+c.endPeriod,[...(weekSet(c.weeks)||[])].sort((a,b)=>a-b),c.room,c.teacher]);const seen=new Set(existing.map(key));const result=[...existing];for(const c of incoming){const k=key(c);if(!seen.has(k)){result.push(normalize(c));seen.add(k);}}return result;}
export function parseColumn(raw,weekday){
 const text=raw.replace(/（/g,'(').replace(/）/g,')').replace(/：/g,':').replace(/[，、]/g,',').replace(/[–—~]/g,'-');
 const rx=/\((\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*节\)\s*([\d\s,\-周]+周)\s*(\([单双]\))?/g;
 const matches=[...text.matchAll(rx)],courses=[];for(let i=0;i<matches.length;i++){const m=matches[i];const preceding=text.slice(i?matches[i-1].index+matches[i-1][0].length:0,m.index);const lines=preceding.split('\n').map(s=>s.trim()).filter(Boolean);const titles=[];for(const line of lines.reverse()){if(/[/:]|学分|星期|^\d+[.\d]*$/.test(line))break;titles.unshift(line);if(titles.length===3)break;}
 const details=text.slice(m.index+m[0].length,matches[i+1]?.index??text.length).replace(/\n|\s/g,'');const field=k=>details.match(new RegExp(`${k}:([^/]+)`))?.[1]||'';
 courses.push(normalize({name:titles.join(''),weekday,startPeriod:+m[1],endPeriod:+(m[2]||m[1]),weeks:m[3].replace(/\s|周/g,'')+(m[4]||''),room:field('场地'),teacher:field('教师'),source:'文件识别 · 待校对'}));}
 return {courses,unparsed:Math.max(0,(text.match(/节\)/g)||[]).length-matches.length)};
}
export function parseCSV(text){const rows=[];let row=[],field='',quoted=false;text=text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if(c==='\n'&&!quoted){row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';}else field+=c;}if(quoted)throw Error('CSV 引号未闭合');row.push(field);if(row.some(Boolean))rows.push(row);return rows;}
export function fromRows(rows){const aliases=[['课程','课程名称','name'],['星期','weekday'],['开始节','开始节次','startPeriod'],['结束节','结束节次','endPeriod'],['周次','weeks'],['教室','地点','room'],['教师','teacher']];if(!rows.length)throw Error('表格为空');const headers=rows[0].map(v=>String(v).trim());const positions=aliases.map(names=>headers.findIndex(h=>names.includes(h)));if(positions.slice(0,5).some(i=>i<0))throw Error('表头需要包含：课程、星期、开始节、结束节、周次（可下载模板）');return rows.slice(1).filter(row=>row.some(v=>v!==''&&v!=null)).map(row=>{const [name,day,startPeriod,endPeriod,weeks,room,teacher]=positions.map(i=>i<0?'':row[i]??'');const number=Number(day)||days.findIndex(d=>d===day||d.replace('周','星期')===day)+1;return normalize({name,weekday:number,startPeriod,endPeriod,weeks,room,teacher});});}
const icsEscape=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
export function exportICS(state){const start=parseLocalDate(state.semesterStart);if(!start)throw Error('请先设置第一周起始日期');const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CampusSchedule//ZH','CALSCALE:GREGORIAN'];const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');for(const c of state.courses){for(const w of weekSet(c.weeks)||[]){const date=new Date(start);date.setDate(date.getDate()+(w-1)*7+c.weekday-1);const d=dateKey(date).replace(/-/g,'');const first=state.periods[c.startPeriod-1][0].replace(':','')+'00';const last=state.periods[c.endPeriod-1][1].replace(':','')+'00';lines.push('BEGIN:VEVENT',`UID:${c.id}-${w}@campus-schedule`,`DTSTAMP:${stamp}`,`DTSTART:${d}T${first}`,`DTEND:${d}T${last}`,`SUMMARY:${icsEscape(c.name)}`,`LOCATION:${icsEscape(c.room)}`,`DESCRIPTION:${icsEscape(c.teacher)}`,'END:VEVENT');}}lines.push('END:VCALENDAR');return lines.join('\r\n');}
export function parseICS(text,state){
 const start=parseLocalDate(state.semesterStart);if(!start)throw Error('导入日历前，请在课表设置中填写第一周的周一');
 const events=text.replace(/\r\n[ \t]/g,'').replace(/\n[ \t]/g,'').match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g)||[];const results=[];let skipped=0;
 const unescape=s=>s.replace(/\\n/gi,'\n').replace(/\\([,;\\])/g,'$1');
 for(const event of events){const get=k=>event.split(/\r?\n/).find(l=>l.startsWith(k+':')||l.startsWith(k+';'))?.split(/:(.*)/s)[1]||'';const timestamp=get('DTSTART'),finish=get('DTEND');const m=timestamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);const end=finish.match(/T(\d{2})(\d{2})/);if(!m||!end){skipped++;continue;}
 const base=m[7]?new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6])):new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]);const format=(h,n)=>`${String(h).padStart(2,'0')}:${String(n).padStart(2,'0')}`;const beginTime=format(base.getHours(),base.getMinutes());let finishTime=format(+end[1],+end[2]);if(finish.endsWith('Z')){const f=new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+end[1],+end[2]));finishTime=format(f.getHours(),f.getMinutes());}
 const first=state.periods.findIndex(p=>p[0]===beginTime)+1,last=state.periods.findIndex(p=>p[1]===finishTime)+1;
 const rule=Object.fromEntries(get('RRULE').split(';').filter(Boolean).map(p=>p.split('=')));if(rule.FREQ&&rule.FREQ!=='WEEKLY'){skipped++;continue;}if(rule.BYDAY&&rule.BYDAY!==['SU','MO','TU','WE','TH','FR','SA'][base.getDay()]){skipped++;continue;}
 const count=rule.FREQ?Math.min(Number(rule.COUNT)||30,30):1,interval=Number(rule.INTERVAL)||1;const weeks=[];
 for(let i=0;i<count;i++){const d=new Date(base);d.setDate(d.getDate()+i*interval*7);const compact=dateKey(d).replace(/-/g,'');if(rule.UNTIL&&compact>rule.UNTIL.slice(0,8))break;if(get('EXDATE').includes(compact))continue;const w=Math.floor(dayOffset(start,d)/7)+1;if(w>=1&&w<=30)weeks.push(w);}
 if(!weeks.length){skipped++;continue;}results.push(normalize({name:unescape(get('SUMMARY')),weekday:(base.getDay()+6)%7+1,startPeriod:first,endPeriod:last,weeks:weeks.join(','),room:unescape(get('LOCATION')),teacher:unescape(get('DESCRIPTION')),source:'ICS · 时间和时区需校对'}));
 }
 return {courses:results,warnings:[`日历课程时间需与作息表匹配；未匹配节次的条目请编辑。${skipped?'有 '+skipped+' 个事件的日期或重复规则无法映射，未导入。':''}`]};
}
