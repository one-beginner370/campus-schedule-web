import {Capacitor} from '@capacitor/core';
import {App} from '@capacitor/app';
import {Filesystem,Directory,Encoding} from '@capacitor/filesystem';
import {Share} from '@capacitor/share';
import {LocalNotifications} from '@capacitor/local-notifications';
import {notificationPlan} from './reminder-plan.js';
if(Capacitor.isNativePlatform()){
 window.campusNativeExport=async(name,text)=>{
  try{const result=await Filesystem.writeFile({path:'exports/'+name.replace(/[\\/]/g,'_'),data:text,directory:Directory.Cache,encoding:Encoding.UTF8,recursive:true});await Share.share({title:name,files:[result.uri],dialogTitle:'保存或分享课表'});}
  catch(e){if(!/cancel|取消/i.test(String(e.message)))alert('导出失败：'+e.message);}
 };
 const $=id=>document.getElementById(id),key='campus-native-reminders-v1';
 let enabled=localStorage.getItem(key)==='on',queue=Promise.resolve();
 const status=text=>{$('reminder-status').textContent=text;};
 function render(){ $('enable-reminders').hidden=enabled;$('enable-reminders').disabled=false;for(const id of ['disable-reminders','sync-reminders','test-reminder'])$(id).hidden=!enabled; }
 async function cancel(){const p=await LocalNotifications.getPending();if(p.notifications.length)await LocalNotifications.cancel({notifications:p.notifications});}
 async function refresh(){
  if(!enabled)return;
  if((await LocalNotifications.checkPermissions()).display!=='granted'){status('通知权限已关闭，请在手机设置中开启。');return;}
  const plan=notificationPlan(window.campusGetSchedule());await cancel();if(plan.length)await LocalNotifications.schedule({notifications:plan});
  status(`已安排未来30天内的 ${plan.length} 次提醒；北京时间19:30提示次日课程。打开App会续排，系统省电设置可能延迟通知。`);
  $('reminder-sync-time').textContent='最近更新：'+new Date().toLocaleString('zh-CN');
 }
 function enqueue(fn){queue=queue.catch(()=>{}).then(fn).catch(e=>status('提醒设置失败：'+e.message));return queue;}
 async function ready(){
  $('install-help').hidden=true;
  document.querySelectorAll('.reminder-panel .small-note').forEach(el=>el.hidden=true);
  $('reminder-heading').nextElementSibling.textContent='本机通知，不上传课表。每天北京时间19:30提醒明日课程，每次打开App续排未来30天，请至少每月打开一次。';
  if(Capacitor.getPlatform()==='android')await LocalNotifications.createChannel({id:'tomorrow-courses',name:'明日课程',importance:3});
  render();status(enabled?'正在更新提醒…':'尚未启用本机提醒。');
  $('enable-reminders').onclick=()=>enqueue(async()=>{notificationPlan(window.campusGetSchedule());if((await LocalNotifications.requestPermissions()).display!=='granted'){status('未允许通知，请在手机设置中开启。');return;}enabled=true;localStorage.setItem(key,'on');render();await refresh();});
  $('disable-reminders').onclick=()=>enqueue(async()=>{await cancel();enabled=false;localStorage.setItem(key,'off');render();status('已关闭提醒。');});
  $('sync-reminders').onclick=()=>enqueue(refresh);
  $('test-reminder').onclick=()=>enqueue(async()=>{await LocalNotifications.schedule({notifications:[{id:999,title:'校园课表',body:'本机通知测试',schedule:{at:new Date(Date.now()+5000)},isExactNotification:false,channelId:'tomorrow-courses'}]});status('已安排测试通知，系统可能延迟发送。');});
  window.addEventListener('campus-schedule-saved',()=>enqueue(refresh));
  await App.addListener('appStateChange',({isActive})=>{if(isActive)enqueue(refresh);});
  await LocalNotifications.addListener('localNotificationActionPerformed',()=>document.querySelector('[data-tab="today"]')?.click());
  if(Capacitor.getPlatform()==='android')await App.addListener('backButton',()=>{const dialog=document.querySelector('dialog[open]');if(dialog){dialog.close();return;}if(location.hash&&location.hash!=='#week'){document.querySelector('[data-tab="week"]')?.click();return;}App.minimizeApp();});
  await refresh();
 }
 if(window.campusAppReady)ready().catch(e=>status(e.message));else window.addEventListener('campus-app-ready',()=>ready().catch(e=>status(e.message)),{once:true});
}
