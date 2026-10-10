create table if not exists public.reminder_devices (
 id uuid primary key,
 token_hash text not null check (length(token_hash) = 64),
 subscription jsonb not null,
 schedule jsonb not null,
 revision bigint not null default 0,
 enabled boolean not null default true,
 updated_at timestamptz not null default now(),
 last_test_at timestamptz
);
create table if not exists public.reminder_deliveries (
 device_id uuid not null references public.reminder_devices(id) on delete cascade,
 target_date date not null,
 status text not null default 'pending' check (status in ('pending','sending','sent','skipped','failed','expired')),
 attempts integer not null default 0,
 locked_until timestamptz,
 finished_at timestamptz,
 primary key(device_id,target_date)
);
alter table public.reminder_devices enable row level security;
alter table public.reminder_deliveries enable row level security;
revoke all on public.reminder_devices,public.reminder_deliveries from anon,authenticated;
grant all on public.reminder_devices,public.reminder_deliveries to service_role;
create or replace function public.upsert_reminder_device(p_id uuid,p_token_hash text,p_subscription jsonb,p_schedule jsonb,p_revision bigint)
returns table(updated_at timestamptz,revision bigint) language sql set search_path=public as $$
 insert into public.reminder_devices as device(id,token_hash,subscription,schedule,revision)
 values(p_id,p_token_hash,p_subscription,p_schedule,p_revision)
 on conflict(id) do update set subscription=excluded.subscription,schedule=excluded.schedule,revision=excluded.revision,enabled=true,updated_at=now()
 where device.token_hash=excluded.token_hash and device.revision<=excluded.revision
 returning device.updated_at,device.revision;
$$;
create or replace function public.claim_reminder_batch(p_date date,p_limit integer,p_now timestamptz)
returns table(device_id uuid,subscription jsonb,schedule jsonb) language plpgsql set search_path=public as $$
begin
 insert into public.reminder_deliveries(device_id,target_date)
 select id,p_date from public.reminder_devices where enabled
 on conflict do nothing;
 return query
 with candidates as (
  select delivery.device_id from public.reminder_deliveries delivery join public.reminder_devices device on device.id=delivery.device_id
  where delivery.target_date=p_date and device.enabled and delivery.status in ('pending','failed','sending')
  and delivery.attempts<3 and (delivery.locked_until is null or delivery.locked_until<p_now)
  order by delivery.device_id limit least(greatest(p_limit,1),100)
  for update of delivery skip locked
 ), claimed as (
  update public.reminder_deliveries delivery set status='sending',attempts=attempts+1,locked_until=p_now+interval '2 minutes'
  from candidates where delivery.device_id=candidates.device_id and delivery.target_date=p_date
  returning delivery.device_id
 ) select device.id,device.subscription,device.schedule from claimed join public.reminder_devices device on device.id=claimed.device_id;
end;
$$;
create or replace function public.reserve_reminder_test(p_id uuid,p_token_hash text,p_now timestamptz)
returns boolean language sql set search_path=public as $$
 with changed as (update public.reminder_devices set last_test_at=p_now where id=p_id and token_hash=p_token_hash and enabled and (last_test_at is null or last_test_at<p_now-interval '1 minute') returning id)
 select exists(select 1 from changed);
$$;
revoke all on function public.upsert_reminder_device(uuid,text,jsonb,jsonb,bigint),public.claim_reminder_batch(date,integer,timestamptz),public.reserve_reminder_test(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.upsert_reminder_device(uuid,text,jsonb,jsonb,bigint),public.claim_reminder_batch(date,integer,timestamptz),public.reserve_reminder_test(uuid,text,timestamptz) to service_role;
