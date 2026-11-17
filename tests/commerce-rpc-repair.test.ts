import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("function-only repair preserves customer/order data, skips installed functions and restores role checks",async()=>{
  const db=new PGlite();
  try {
    await db.exec(`
      create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now(),banned_until timestamptz);
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create function auth.jwt() returns jsonb language sql as $$select null::jsonb$$;
    `);
    await db.exec(await readFile("supabase/migrations/202610300008_customer_requests.sql","utf8"));
    await db.exec(await readFile("supabase/migrations/202611110010_commerce_crm_analytics.sql","utf8"));
    await db.exec(`
      insert into auth.users(id,email,email_confirmed_at) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','keep@example.test',now());
      insert into public.commerce_profiles(user_id,display_name,phone) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','KEEP','');
      insert into public.commerce_orders(customer_id,contact_email,idempotency_key,request_digest,locale)
      values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','keep@example.test','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','keep','ru');
      drop function public.commerce_customers(text,date,date,integer,text,uuid);
      drop function public.commerce_record_event(text,text,text,text,text,text,text,text);
      drop function public.commerce_dashboard(integer);
    `);
    const sql=await readFile("supabase/commerce-analytics-functions-repair.sql","utf8");
    await db.exec(sql);
    const before=await db.query("select oid from pg_proc where proname in('commerce_customers','commerce_record_event','commerce_dashboard') order by oid");
    assert.equal(before.rows.length,3);
    await db.exec(sql);
    assert.deepEqual((await db.query("select oid from pg_proc where proname in('commerce_customers','commerce_record_event','commerce_dashboard') order by oid")).rows,before.rows);
    assert.equal((await db.query<{n:number}>("select count(*)::int n from public.commerce_orders")).rows[0].n,1);
    assert.equal((await db.query<{display_name:string}>("select display_name from public.commerce_profiles")).rows[0].display_name,"KEEP");
    await db.exec("set role anon");
    await assert.rejects(db.query("select public.commerce_dashboard()"));
    await db.exec("reset role;set role authenticated");
    await assert.rejects(db.query("select public.commerce_dashboard()"));
    await assert.rejects(db.query("select public.commerce_customers()"));
    await db.exec("reset role;set role service_role");
    await db.query("select public.commerce_record_event($1,'pageview','/en','','Unknown','Unknown','desktop','')",["a".repeat(64)]);
    assert.equal((await db.query<{hits:number}>("select hits from public.commerce_analytics_daily")).rows[0].hits,1);
  } finally { await db.close(); }
});
