import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("CRM and analytics protect customers, aggregate real events and require staff MFA", async () => {
  const db = new PGlite();
  const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const customer = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const order = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now(),banned_until timestamptz);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('aal',current_setting('test.aal',true))$$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid(),auth.jwt() to authenticated;
    `);
    for (const file of ["202610300008_customer_requests.sql","202611100009_commerce_telegram_outbox.sql","202611110010_commerce_crm_analytics.sql"])
      await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'owner@example.test',now()),($2,'client@example.test',now())", [owner,customer]);
    await db.query("insert into public.commerce_staff(user_id,role) values($1,'owner')", [owner]);
    await db.query("insert into public.commerce_profiles(user_id,display_name,phone) values($1,'Client Name','1234')", [customer]);
    await db.query("insert into public.commerce_orders(id,customer_id,contact_email,idempotency_key,request_digest,locale) values($1,$2,'client@example.test',$1,'fixture','ru')", [order,customer]);

    await db.exec("set role anon");
    await assert.rejects(db.query("select public.commerce_dashboard(7)"));
    await assert.rejects(db.query("select * from public.commerce_analytics_daily"));
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('test.uid',$1,false),set_config('test.aal','aal2',false)", [customer]);
    await assert.rejects(db.query("select public.commerce_customers()"));
    await assert.rejects(db.query("select public.commerce_crm_stage($1,'confirmed')", [order]));
    await assert.rejects(db.query("select public.commerce_record_event($1,'visit','/ru','','Unknown','Unknown','mobile','')", ["a".repeat(64)]));
    await db.query("select set_config('test.uid',$1,false),set_config('test.aal','aal1',false)", [owner]);
    await assert.rejects(db.query("select public.commerce_dashboard()"));
    await db.exec("reset role; set role service_role");
    await db.query("select public.commerce_record_event($1,'visit','/ru','','GE','Tbilisi','mobile','example.test')", ["a".repeat(64)]);
    await db.query("select public.commerce_record_event($1,'pageview','/ru/tours','','GE','Tbilisi','mobile','example.test')", ["a".repeat(64)]);
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('test.uid',$1,false),set_config('test.aal','aal2',false)", [owner]);
    const customers = await db.query<{ data: {total:number; items:{email:string;requests:number}[]} }>("select public.commerce_customers('1234') data");
    assert.equal(customers.rows[0].data.total, 1);
    assert.equal(customers.rows[0].data.items[0].email, "client@example.test");
    assert.equal(customers.rows[0].data.items[0].requests, 1);
    await db.query("select public.commerce_crm_stage($1,'in_progress')", [order]);
    const { rows: [row] } = await db.query<{ data: { visits:number; pageviews:number; in_progress:number; geography:{country:string}[] } }>("select public.commerce_dashboard(7) data");
    assert.equal(row.data.visits, 1);
    assert.equal(row.data.pageviews, 1);
    assert.equal(row.data.in_progress, 1);
    assert.equal(row.data.geography[0].country, "GE");
    await assert.rejects(db.query("select public.commerce_crm_stage($1,'invented')", [order]));
    await db.exec("reset role");
    assert.equal((await db.query<{status:string}>("select status from public.commerce_orders where id=$1",[order])).rows[0].status,"requested");
  } finally { await db.close(); }
});
