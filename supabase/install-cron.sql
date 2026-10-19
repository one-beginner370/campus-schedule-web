-- Runtime keys remain in Vault. This invoker function is callable only by service_role.
create or replace function public.get_reminder_runtime_config()
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object(
 'publicKey',(select decrypted_secret from vault.decrypted_secrets where name='campus_reminder_vapid_public'),
 'privateKey',(select decrypted_secret from vault.decrypted_secrets where name='campus_reminder_vapid_private'),
 'cronSecret',(select decrypted_secret from vault.decrypted_secrets where name='campus_reminder_cron_secret'));
$$;
revoke all on function public.get_reminder_runtime_config() from public,anon,authenticated;
grant execute on function public.get_reminder_runtime_config() to service_role;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
-- Primary attempt: 11:30 UTC = 19:30 Asia/Shanghai. The following minutes
-- retry failed/expired leases only; successful and no-class records are skipped.
select cron.schedule(
 'campus-schedule-reminders',
 '30-39 11 * * *',
 $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='campus_reminder_endpoint') || '/dispatch',
  headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret',(select decrypted_secret from vault.decrypted_secrets where name='campus_reminder_cron_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
 );
 $job$
);
