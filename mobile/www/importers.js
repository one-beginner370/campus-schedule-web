import {parseCSV,fromRows,parseICS,normalize,parseLocalDate} from './core.js?v=11';
import {inferColumns,pageColumns,parseScheduleColumns,documentColumns} from './recognition.js?v=1';
let pdfLib;
function loadScript(src,globalName){if(window[globalName])return Promise.resolve(window[globalName]);return new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=()=>resolve(window[globalName]);el.onerror=()=>reject(Error('识别组件加载失败，请联网后重试'));document.head.append(el);});}
async function pdf(){if(!Promise.withResolvers)Promise.withResolvers=function(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};pdfLib??=await import('./vendor/pdf/pdf.mjs');pdfLib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf/pdf.worker.mjs',import.meta.url).href;return pdfLib;}
function columnsToCourses(columns,details={}){
 const result=parseScheduleColumns(columns),{stats}=result;
 const warnings=[`已找到 ${stats.arrangements} 条上课安排、${stats.subjects} 门课程。同一格内不同周次、教室或教师的安排分别保留，请逐条校对。`];
 if(stats.needsReview)warnings.push(`有 ${stats.needsReview} 条安排信息不完整，已保留并标红，请补全后保存。`);
 if(!result.courses.length)warnings.push('没有找到可解析的节次，请查看识别原文，或使用 Excel / CSV 模板补充。');
 if(details.fallbackPages)warnings.push(`有 ${details.fallbackPages} 页未找到星期表头，已使用连续页列位置，请重点检查星期。`);
 return {...result,stats:{...stats,...details},warnings,rawText:columns.map((text,i)=>`星期${i+1}\n${text}`).join('\n\n')};
}
async function recognizeImages(canvases,progress,layouts=[]){const T=await loadScript('./vendor/ocr/tesseract.min.js','Tesseract');let worker;const columns=Array(7).fill('');try{progress('正在加载中文识别组件，首次使用需要联网…');worker=await T.createWorker('chi_sim+eng',1,{workerPath:new URL('./vendor/ocr/worker.min.js',import.meta.url).href,corePath:new URL('./vendor/ocr/core/',import.meta.url).href,langPath:new URL('./vendor/ocr/lang/',import.meta.url).href,workerBlobURL:false,logger:m=>{if(m.status==='recognizing text')progress(`正在识别，当前列 ${Math.round((m.progress||0)*100)}%`);}});await worker.setParameters({tessedit_pageseg_mode:6,preserve_interword_spaces:0});for(let page=0;page<canvases.length;page++){const canvas=canvases[page];for(let day=0;day<7;day++){progress(`正在识别第 ${page+1}/${canvases.length} 页，星期 ${day+1}…`);const range=layouts[page]?.ranges[day]||[.118+day*(.982-.118)/7,.118+(day+1)*(.982-.118)/7];const left=Math.max(0,range[0]),width=Math.min(1,range[1])-left;if(width<=0)continue;const crop=document.createElement('canvas');crop.width=Math.round(canvas.width*width);crop.height=canvas.height;const ctx=crop.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,crop.width,crop.height);ctx.drawImage(canvas,Math.round(canvas.width*left),0,crop.width,canvas.height,0,0,crop.width,canvas.height);const result=await worker.recognize(crop);columns[day]+='\n'+result.data.text.replace(/[ \t]/g,'').replace(/周[.。]/g,'周,');crop.width=1;crop.height=1;}canvas.width=1;canvas.height=1;}return columns;}finally{if(worker)await worker.terminate();}}
async function readPDF(file,progress){
 const lib=await pdf(),task=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:new URL('./vendor/pdf/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/pdf/standard_fonts/',import.meta.url).href,isEvalSupported:false});let doc;
 try{
  doc=await task.promise;if(doc.numPages>10)throw Error('请使用最多 10 页的课表 PDF');
  const pages=[],columns=Array(7).fill('');let inherited=null;
  for(let i=1;i<=doc.numPages;i++){
   progress(`正在读取 PDF 第 ${i}/${doc.numPages} 页并定位星期列…`);
   const page=await doc.getPage(i),content=await page.getTextContent(),viewport=page.getViewport({scale:1});
   const items=content.items.filter(item=>item.transform&&item.str?.trim()).map(item=>{const t=lib.Util.transform(viewport.transform,item.transform);return {str:item.str,x:t[4],y:t[5],width:item.width*viewport.scale,height:Math.hypot(t[2],t[3])};});
   const layout=inferColumns(items,viewport.width,inherited);if(layout.confidence==='headers')inherited=layout;
   const cols=pageColumns(items,viewport.width,layout),parsed=parseScheduleColumns(cols),characters=cols.join('').replace(/\s/g,'').length;
   // Inspect every page. Finding text on page one must not skip a scanned page.
   let raster=false;if(characters<400||!parsed.courses.length||parsed.stats.needsReview){const operators=await page.getOperatorList();raster=operators.fnArray.some(op=>[lib.OPS.paintImageXObject,lib.OPS.paintInlineImageXObject,lib.OPS.paintImageMaskXObject].includes(op));}
   pages.push({number:i,layout,characters,raster,parsed,columns:cols});for(let d=0;d<7;d++)columns[d]+='\n'+cols[d];page.cleanup();
  }
  let result=columnsToCourses(columns),ocrPages=pages.filter(page=>page.raster&&(!page.parsed.courses.length||page.characters<400||page.parsed.stats.needsReview));
  if(!result.courses.length&&!ocrPages.length)ocrPages=pages;
  for(const info of ocrPages){
   progress(`第 ${info.number} 页需要补充识别，正在准备图片…`);const page=await doc.getPage(info.number),base=page.getViewport({scale:1}),view=page.getViewport({scale:Math.min(3,2200/base.width)}),canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
   await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;const cols=await recognizeImages([canvas],progress,[info.layout]);info.ocrColumns=cols;info.preferOCR=info.characters<100||!info.parsed.courses.length;page.cleanup();
  }
  const details={pages:doc.numPages,ocrPages:ocrPages.length,fallbackPages:pages.filter(p=>p.layout.confidence==='fallback').length};
  if(ocrPages.length){
   result=columnsToCourses(documentColumns(pages));const ocr=columnsToCourses(documentColumns(pages,true)),key=c=>JSON.stringify([c.name,c.weekday,c.startPeriod,c.endPeriod,c.weeks,c.room,c.teacher]);const seen=new Set(result.courses.map(key));
   const extra=ocr.courses.filter(c=>{const k=key(c);if(seen.has(k))return false;seen.add(k);return true;});
   const courses=[...result.courses,...extra];result={...result,courses,stats:{...result.stats,arrangements:courses.length,subjects:new Set(courses.map(c=>c.name)).size,byDay:Array.from({length:7},(_,i)=>courses.filter(c=>c.weekday===i+1).length),needsReview:result.stats.needsReview+extra.filter(c=>!c.name||!c.weeks).length},rawText:result.rawText+'\n\n补充图片识别：\n'+ocr.rawText};
   result.warnings.push(`已补充识别 ${ocrPages.length} 页图片内容；图片识别的文字、周次和教室需要校对。`);
  }
  result.stats={...result.stats,...details};result.warnings[0]=`已找到 ${result.stats.arrangements} 条上课安排、${result.stats.subjects} 门课程。同一格内不同周次、教室或教师的安排分别保留，请逐条校对。`;
  if(details.fallbackPages)result.warnings.push(`有 ${details.fallbackPages} 页未找到星期表头，请检查星期是否正确。`);
  progress(`识别完成：${result.stats.arrangements} 条安排，正在生成逐条校对结果…`);return result;
 }catch(e){if(e.name==='PasswordException')throw Error('PDF 受密码保护，请先保存无密码的课表文件');throw e;}finally{if(doc)await doc.destroy();else await task.destroy();}
}
async function imageCanvas(file){const url=URL.createObjectURL(file);try{const image=new Image();image.src=url;await image.decode();const scale=Math.min(3,3000/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return canvas;}finally{URL.revokeObjectURL(url);}}
export async function readFile(file,state,progress){if(file.size>20*1024*1024)throw Error('文件超过 20 MB，请缩小或拆分后再导入');const extension=file.name.split('.').pop().toLowerCase();if(extension==='pdf')return readPDF(file,progress);if(file.type.startsWith('image/')||['png','jpg','jpeg','webp'].includes(extension))return columnsToCourses(await recognizeImages([await imageCanvas(file)],progress));if(['xlsx','xls'].includes(extension)){progress('正在读取 Excel 表格…');const XLSX=await loadScript('./vendor/xlsx.full.min.js','XLSX');const book=XLSX.read(await file.arrayBuffer(),{type:'array'});const rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:''});return {courses:fromRows(rows),warnings:['读取 Excel 第一张工作表，请校对后导入。'],rawText:rows.map(r=>r.join(' | ')).join('\n')};}const text=await file.text();if(extension==='csv')return {courses:fromRows(parseCSV(text)),warnings:['课程尚未保存，请校对后确认导入。'],rawText:text};if(extension==='ics'){const result=parseICS(text,state);return {...result,rawText:text};}if(extension==='json'){const value=JSON.parse(text.replace(/^\uFEFF/,''));const courses=Array.isArray(value)?value:value.courses;if(!Array.isArray(courses)||courses.length>2000)throw Error('JSON 需要包含课程数组，最多 2000 条');let backup;if(!Array.isArray(value)){if(value.semesterStart&&(!parseLocalDate(value.semesterStart)||parseLocalDate(value.semesterStart).getDay()!==1))throw Error('备份的学期起始日期无效');if(value.periods&&(!Array.isArray(value.periods)||value.periods.length!==12||value.periods.some(p=>!Array.isArray(p)||p.length!==2||p.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))||p[0]>=p[1])))throw Error('备份作息时间无效');backup={semesterStart:value.semesterStart,periods:value.periods};}return {courses:courses.map(normalize),backup,warnings:['备份课程将追加到现有课表；若含学期和作息设置，也会恢复。'],rawText:file.name};}throw Error('暂不支持此文件格式，请选择 PDF、图片、Excel、CSV、ICS 或 JSON');}


