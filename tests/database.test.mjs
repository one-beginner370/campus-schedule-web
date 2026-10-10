import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('Postgres schema: token isolation, stale versions, atomic claims, leases, retries and RLS',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  await db.exec(await readFile(new URL('../supabase/migrations/202610100001_reminders.sql',import.meta.url),'utf8'));
  const id='9a1d8e42-918a-4b4e-8bbf-719f9f2c99e1',hash='a'.repeat(64),other='b'.repeat(64);
  const upsert=(h,version)=>db.query('select * from upsert_reminder_device($1,$2,$3::jsonb,$4::jsonb,$5)',[id,h,'{}','{}',version]);
  assert.equal((await upsert(hash,10)).rows.length,1);assert.equal((await upsert(other,20)).rows.length,0);assert.equal((await upsert(hash,9)).rows.length,0);assert.equal((await upsert(hash,11)).rows.length,1);
  const claim=now=>db.query('select * from claim_reminder_batch($1,100,$2)',['2026-10-12',now]);
  assert.equal((await claim('2026-10-11T11:30:00Z')).rows.length,1);assert.equal((await claim('2026-10-11T11:31:00Z')).rows.length,0);assert.equal((await claim('2026-10-11T11:33:00Z')).rows.length,1);
  await db.exec("update reminder_deliveries set status='failed',locked_until=null;");assert.equal((await claim('2026-10-11T11:34:00Z')).rows.length,1);
  await db.exec("update reminder_deliveries set status='failed',locked_until=null;");assert.equal((await claim('2026-10-11T11:35:00Z')).rows.length,0);
  assert.equal((await db.query('select reserve_reminder_test($1,$2,$3) as ok',[id,hash,'2026-10-11T11:30:00Z'])).rows[0].ok,true);
  assert.equal((await db.query('select reserve_reminder_test($1,$2,$3) as ok',[id,hash,'2026-10-11T11:30:01Z'])).rows[0].ok,false);
  await db.exec('set role anon;');await assert.rejects(()=>db.query('select * from reminder_devices'),/permission denied/);await assert.rejects(()=>db.query('select * from claim_reminder_batch(current_date,100,now())'),/permission denied/);await db.exec('reset role;');
  await db.exec("update reminder_deliveries set status='sent',attempts=1,locked_until=null;");assert.equal((await claim('2026-10-11T11:36:00Z')).rows.length,0);
  await db.query('delete from reminder_devices where id=$1',[id]);assert.equal((await db.query('select count(*)::int as count from reminder_deliveries')).rows[0].count,0);
 }finally{await db.close();}
});
