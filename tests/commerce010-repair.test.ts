import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

for (const partial of [false, true]) test(`010 additive repair: ${partial ? "partial" : "missing"} schema, data preservation, idempotence and MFA/RLS`, async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now(),banned_until timestamptz);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('aal',current_setting('test.aal',true))$$;`);
    await db.exec(await readFile("supabase/migrations/202610300008_customer_requests.sql", "utf8"));
    const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.exec(`insert into auth.users(id,email) values('${owner}','keep@example.test');
      insert into public.commerce_profiles(user_id,display_name) values('${owner}','KEEP');
      insert into public.commerce_staff values('${owner}','owner',true);
      insert into public.commerce_orders(customer_id,contact_email,idempotency_key,request_digest,locale)
      values('${owner}','keep@example.test','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','keep','ru');`);
    if (partial) {
      const original = await readFile("supabase/migrations/202611110010_commerce_crm_analytics.sql", "utf8");
      const table = original.match(/create table public\.commerce_customer_notes \([\s\S]*?\n\);/)![0];
      await db.exec(table);
      await db.exec(`insert into public.commerce_customer_notes(customer_id,actor,note) values('${owner}','${owner}','KEEP NOTE')`);
    }
    const repair = await readFile("supabase/commerce010-staging-repair.sql", "utf8");
    await db.exec(repair);
    const snapshot = await db.query("select oid from pg_proc where proname in('commerce_dashboard','commerce_customers','commerce_record_event','commerce_crm_stage') order by oid");
    assert.equal(snapshot.rows.length, 4);
    await db.exec(repair);
    assert.deepEqual((await db.query("select oid from pg_proc where proname in('commerce_dashboard','commerce_customers','commerce_record_event','commerce_crm_stage') order by oid")).rows,snapshot.rows);
    assert.equal((await db.query<{n:number}>("select count(*)::int n from public.commerce_orders")).rows[0].n,1);
    assert.equal((await db.query<{role:string}>("select role from public.commerce_staff")).rows[0].role,"owner");
    if (partial) assert.equal((await db.query<{note:string}>("select note from public.commerce_customer_notes")).rows[0].note,"KEEP NOTE");
    assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_class where oid in('public.commerce_customer_notes'::regclass,'public.commerce_order_crm'::regclass,'public.commerce_analytics_daily'::regclass) and relrowsecurity")).rows[0].n,3);
    await db.exec("set role anon");
    await assert.rejects(db.query("select public.commerce_dashboard()"));
    await db.exec("reset role;set role authenticated");
    await assert.rejects(db.query("select public.commerce_dashboard()"));
    await assert.rejects(db.query("select * from public.commerce_analytics_daily"));
    await db.exec(`set test.uid='${owner}';set test.aal='aal1'`);
    await assert.rejects(db.query("select public.commerce_dashboard()"));
    await db.exec("set test.aal='aal2'");
    assert.equal((await db.query<{data:{requests:number}}>("select public.commerce_dashboard() as data")).rows[0].data.requests,1);
    assert.equal((await db.query<{data:{total:number}}>("select public.commerce_customers() as data")).rows[0].data.total,1);
    await db.exec("reset role;set role service_role");
    await db.query("select public.commerce_record_event($1,'visit','/en','','Unknown','Unknown','desktop','')",["a".repeat(64)]);
    assert.equal((await db.query<{hits:number}>("select hits from public.commerce_analytics_daily")).rows[0].hits,1);
  } finally { await db.close(); }
});
