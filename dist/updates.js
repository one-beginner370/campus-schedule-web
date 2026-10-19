// Check for a newer shell when a saved home-screen app resumes. Never reload an
// editing page automatically: the user chooses when to open the updated page.
if('serviceWorker' in navigator){
 let checkedAt=0;
 const check=async()=>{if(Date.now()-checkedAt<60000)return;checkedAt=Date.now();try{const reg=await navigator.serviceWorker.getRegistration();await reg?.update();}catch{}};
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(document.getElementById('campus-update-notice'))return;
  const notice=document.createElement('aside');notice.id='campus-update-notice';notice.setAttribute('role','status');
  notice.style.cssText='position:fixed;left:16px;right:16px;bottom:calc(85px + env(safe-area-inset-bottom));z-index:1000;padding:15px;border:1px solid #c9d7cc;border-radius:14px;background:#f0f7f1;color:#274d35;box-shadow:0 6px 25px #0001';
  const text=document.createElement('span');text.textContent='课表有更新。';
  const link=document.createElement('a');link.href='./update.html?next=app';link.textContent='点此刷新';link.style.cssText='margin-left:8px;color:inherit;font-weight:600';
  const close=document.createElement('button');close.type='button';close.textContent='稍后';close.style.cssText='float:right;background:none;border:0;color:inherit';close.onclick=()=>notice.remove();notice.append(text,link,close);document.body.append(notice);
 });
 window.addEventListener('pageshow',check);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check();});check();
}
