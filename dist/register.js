// Public client credentials only. Registration uses the same Auth project as login.
const AUTH_URL='https://fgrqsvducfozthkrumym.supabase.co/auth/v1/signup';
const PUBLIC_KEY='sb_publishable_Ha0EYpk74ci685NJ_6iT_w_vyqLuAxo';
const form=document.getElementById('registration-form');
const email=document.getElementById('register-email');
const password=document.getElementById('register-password');
const confirmPassword=document.getElementById('register-confirm');
const consent=document.getElementById('register-consent');
const button=document.getElementById('register-submit');
const status=document.getElementById('registration-status');
let submitting=false;
function message(text,error=false){status.textContent=text;status.hidden=!text;status.classList.toggle('error',error);}
function checkPasswords(){confirmPassword.setCustomValidity(password.value===confirmPassword.value?'':'两次输入的密码不一致');}
password.addEventListener('input',checkPasswords);confirmPassword.addEventListener('input',checkPasswords);
form.addEventListener('submit',async event=>{
 event.preventDefault();if(submitting)return;
 email.value=email.value.trim();checkPasswords();
 if(!form.reportValidity()||!consent.checked)return;
 submitting=true;button.disabled=true;button.textContent='正在提交…';message('正在提交注册请求…');
 try{
  const response=await fetch(AUTH_URL,{method:'POST',headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:email.value,password:password.value}),signal:AbortSignal.timeout(20000)});
  const result=await response.json().catch(()=>null);
  if(!response.ok){
   if(response.status===429)throw Error('请求过于频繁，请稍后再试。若刚提交过，请先检查邮箱。');
   if(result?.code==='email_address_invalid')throw Error('请检查邮箱地址是否正确。');
   if(result?.code==='weak_password'||result?.code==='validation_failed')throw Error('邮箱或密码格式不符合要求，请检查后重试。');
   throw Error('注册暂未完成，请稍后重试；已有账号可返回登录。');
  }
  document.getElementById('registration-email').textContent=email.value;
  password.value='';confirmPassword.value='';form.hidden=true;status.hidden=true;
  document.getElementById('register-heading').hidden=true;
  if(result?.access_token){document.getElementById('registration-result-title').textContent='账号已创建';document.getElementById('registration-result-text').textContent='请返回课表，使用刚才设置的邮箱和密码登录。';}
  document.getElementById('registration-success').hidden=false;
 }catch(error){
  const network=/TypeError|AbortError|TimeoutError/.test(error.name);
  message(network?'网络连接失败或超时，请检查网络后重试。若请求可能已提交，请先检查邮箱，避免重复发送。':error.message,true);
 }finally{submitting=false;button.disabled=false;button.textContent='注册账号';}
});
