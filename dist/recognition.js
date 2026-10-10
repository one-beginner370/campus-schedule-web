// Pure layout/text parsing shared by PDF import and its regression checks.
import {normalize,weekSet,validate} from './core.js?v=11';
export function cleanText(value){return String(value??'').normalize('NFKC').replace(/[‐‑‒–—―−~～]/g,'-').replace(/(\d)\s*[至到]\s*(?=\d)/g,'$1-').replace(/[，、；;]/g,',').replace(/\r\n?/g,'\n').replace(/\u00ad/g,'');}
const weekdayNumber=value=>({一:1,二:2,三:3,四:4,五:5,六:6,日:7,天:7}[value]||+value);
const median=values=>{const list=[...values].sort((a,b)=>a-b);return list[Math.floor(list.length/2)];};
export function inferColumns(items,width,inherited=null){
 const candidates=[];
 for(const item of items){
  const str=cleanText(item.str).replace(/\s/g,'');
  for(const match of str.matchAll(/(?:星期|周|礼拜)([一二三四五六日天1-7])/g))candidates.push({day:weekdayNumber(match[1]),x:item.x+(match.index+match[0].length/2)/str.length*item.width,y:item.y});
 }
 // Headers share a baseline; weekday references inside a course are excluded.
 let best=[];
 for(const anchor of candidates){const row=candidates.filter(c=>Math.abs(c.y-anchor.y)<5).sort((a,b)=>a.x-b.x);const unique=row.filter((c,i)=>!row.slice(0,i).some(other=>other.day===c.day));if(unique.length>best.length&&unique.every((c,i)=>!i||c.day>unique[i-1].day))best=unique;}
 if(best.length>=3){
  const gaps=best.slice(1).map((c,i)=>(c.x-best[i].x)/(c.day-best[i].day)),step=median(gaps);
  if(step>width*.055&&step<width*.25){
   const origin=median(best.map(c=>c.x-(c.day-1)*step));
   return {ranges:Array.from({length:7},(_,i)=>[(origin+(i-.5)*step)/width,(origin+(i+.5)*step)/width]),headerY:median(best.map(c=>c.y)),confidence:'headers'};
  }
 }
 if(inherited)return {...inherited,headerY:null,confidence:'continued'};
 return {ranges:Array.from({length:7},(_,i)=>[.118+i*(.982-.118)/7,.118+(i+1)*(.982-.118)/7]),headerY:null,confidence:'fallback'};
}
export function joinLines(items){
 const rows=[];
 for(const item of [...items].sort((a,b)=>a.y-b.y||a.x-b.x)){
  const tolerance=Math.max(1.2,Math.min(3,(item.height||8)*.28));let row=rows.find(row=>Math.abs(row.y-item.y)<tolerance);
  if(!row){row={y:item.y,items:[]};rows.push(row);}row.items.push(item);
 }
 return rows.sort((a,b)=>a.y-b.y).map(row=>row.items.sort((a,b)=>a.x-b.x).map(i=>i.str).join('')).join('\n');
}
export function pageColumns(items,width,layout){
 const body=items.filter(item=>item.str?.trim()&&(layout.headerY===null||item.y>layout.headerY+4)&&!/(?:打印时间|学号\s*[:：]|学年第?\d学期|^.*课表$)/.test(item.str));
 return layout.ranges.map(([left,right])=>joinLines(body.filter(item=>{const x=item.x+Math.min(item.width*.2,2);return x>=left*width&&x<Math.min(1,right)*width;})));
}
export function canonicalWeeks(raw){
 const text=cleanText(raw).replace(/\s|周次?[:：]?|第/g,'').replace(/\(([单双])周?\)/g,'($1)').replace(/,$/,'');
 if(weekSet(text))return text;
 // A different parity on each range cannot be represented by one suffix.
 const weeks=new Set();for(const part of text.split(',')){
  const match=part.match(/^(\d{1,2})(?:-(\d{1,2}))?(?:\(([单双])\))?$/);if(!match)return '';
  const first=+match[1],last=+(match[2]||match[1]);if(first<1||last>30||last<first)return '';
  for(let w=first;w<=last;w++)if(!match[3]||w%2===(match[3]==='单'?1:0))weeks.add(w);
 }
 return [...weeks].sort((a,b)=>a-b).join(',');
}
const fields='场地|上课地点|地点|教室|授课教师|任课教师|教师|老师|教学班组成|教学班|考核方式|选课备注|备注|课程学时组成|讲课学时|实验学时|周学时|总学时|学分';
function titleBefore(text,base){
 const lines=text.split('\n');let offset=text.length,titles=[],start=text.length;
 for(let i=lines.length-1;i>=0;i--){const line=lines[i].trim();offset-=lines[i].length+(i<lines.length-1?1:0);if(!line)continue;
  if(new RegExp(`(?:${fields})\\s*[:：]`).test(line)||(/[:：]/.test(line)&&!/^课程名(?:称)?[:：]/.test(line))||/^[\d\s.,:()/-]+$|^(?:星期|周)[一二三四五六日天]|^(?:上午|下午|晚上|时间段|节次)$|学年|学号|课表$/.test(line)||line.includes('/'))break;
  titles.unshift(line.replace(/^(?:课程名称|课程名)\s*[:：]/,''));start=offset;if(titles.length>=12)break;
 }
 return {name:titles.join('').trim(),start:base+start};
}
export function parseScheduleColumn(raw,weekday){
 const text=cleanText(raw),periods=[...text.matchAll(/[([【]?\s*(?:第\s*)?(\d{1,2})\s*(?:-\s*(?:第\s*)?(\d{1,2}))?\s*节(?:次)?\s*[)\]】]?/g)],anchors=[...periods],records=[];
 // Some schools print the period once, then list more week/room variants.
 for(let i=0;i<periods.length;i++){
  const p=periods[i],start=p.index+p[0].length,block=text.slice(start,periods[i+1]?.index??text.length);
  for(const match of block.matchAll(/(?:\n|\/)\s*(?:周次\s*[:：]\s*)?(\d{1,2}(?:\s*-\s*\d{1,2})?\s*周(?:\([单双]周?\))?(?:\s*,\s*\d{1,2}(?:\s*-\s*\d{1,2})?\s*周?)*)\s*(?=\/?\s*(?:场地|教室|地点|上课地点|教师)[:：])/g)){
   if(!/[:：]/.test(block.slice(0,match.index)))continue;
   const index=start+match.index+match[0].indexOf(match[1]);anchors.push(Object.assign(['',p[1],p[2]],{index}));
  }
 }
 anchors.sort((a,b)=>a.index-b.index);
 for(let i=0;i<anchors.length;i++){
  const m=anchors[i],previous=anchors[i-1],base=previous?previous.index+previous[0].length:0,title=titleBefore(text.slice(base,m.index),base);
  if(!title.name&&records.length)title.name=records[records.length-1].name;
  const following=text.slice(m.index+m[0].length,anchors[i+1]?.index??text.length);
  const weekMatch=following.match(/^\s*(?:周次\s*[:：]?\s*)?((?:第?\s*\d{1,2}\s*(?:-\s*\d{1,2})?\s*周?\s*(?:\([单双]周?\))?\s*,?\s*)+)/);
  records.push({anchor:m,titleStart:title.start,name:title.name,weeks:weekMatch?canonicalWeeks(weekMatch[1]):'',weekEnd:m.index+m[0].length+(weekMatch?.[0].length||0)});
 }
 const courses=[],issues=[];
 for(let i=0;i<records.length;i++){
  const r=records[i],m=r.anchor,next=records[i+1],end=next?Math.min(next.anchor.index,next.titleStart):text.length;
  const details=text.slice(r.weekEnd,end).replace(/\s/g,'');
  const field=labels=>details.match(new RegExp(`(?:${labels})[:：](.*?)(?=[/|]|(?:${fields})[:：]|$)`))?.[1]||'';
  const course=normalize({name:r.name,weekday,startPeriod:+m[1],endPeriod:+(m[2]||m[1]),weeks:r.weeks,room:field('场地|上课地点|地点|教室'),teacher:field('授课教师|任课教师|教师|老师'),source:'PDF / 图片识别 · 待校对'});
  const error=validate(course);if(error)issues.push({weekday,name:course.name||'未识别课程名',reason:error});courses.push(course);
 }
 return {courses,issues,candidates:anchors.length};
}
export function parseScheduleColumns(columns){
 let courses=[],issues=[],candidates=0;for(let day=0;day<7;day++){const result=parseScheduleColumn(columns[day]||'',day+1);courses.push(...result.courses);issues.push(...result.issues);candidates+=result.candidates;}
 const seen=new Set();courses=courses.filter(c=>{const key=JSON.stringify([c.name,c.weekday,c.startPeriod,c.endPeriod,c.weeks,c.room,c.teacher]);if(seen.has(key))return false;seen.add(key);return true;});
 return {courses,issues,stats:{candidates,arrangements:courses.length,subjects:new Set(courses.map(c=>c.name).filter(Boolean)).size,byDay:Array.from({length:7},(_,i)=>courses.filter(c=>c.weekday===i+1).length),needsReview:courses.filter(c=>validate(c)).length,duplicates:candidates-courses.length}};
}
export function documentColumns(pages,useSupplement=false){
 return Array.from({length:7},(_,day)=>pages.map(page=>(page.ocrColumns&&(useSupplement||page.preferOCR)?page.ocrColumns:page.columns)[day]||'').join('\n'));
}
