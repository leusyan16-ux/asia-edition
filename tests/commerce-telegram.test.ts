import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("Telegram outbox is private, transactional and resumes a claimed order", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql as $$select current_setting('test.uid')::uuid$$;
      create function auth.jwt() returns jsonb language sql as $$select null::jsonb$$;
    `);
    for (const file of ["202610300008_customer_requests.sql", "202611100009_commerce_telegram_outbox.sql"])
      await db.exec(await readFile("supabase/migrations/" + file, "utf8"));

    const user = "00000000-0000-4000-8000-000000000001";
    const request = "00000000-0000-4000-8000-000000000002";
    await db.query("select set_config('test.uid',$1,false)", [user]);
    await db.query("insert into auth.users values($1,'fixture@example.test',now())", [user]);
    await db.exec(`
      update public.commerce_settings set requests_enabled=true;
      insert into public.commerce_products
      values('tour','fixture','1','{"ru":"Тур","en":"Tour"}','{"ru":"Дили","en":"Dili"}',true,'fixture');
      set role authenticated;
    `);
    await assert.rejects(db.query("select * from public.commerce_telegram_outbox"));
    await assert.rejects(db.query("select public.commerce_telegram_claim()"));

    const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const create = async (slug: string) => (await db.query<{ id: string }>(
      "select public.commerce_request($1,'ru',$2::jsonb) as id",
      [request, JSON.stringify([{ slug, date, adults: 2, children: 1 }])],
    )).rows[0].id;
    await assert.rejects(create("unavailable"));
    await db.exec("reset role");
    assert.equal((await db.query<{ n: number }>("select count(*)::int n from public.commerce_telegram_outbox")).rows[0].n, 0);
    await db.exec("set role authenticated");
    const id = await create("tour");
    assert.equal(await create("tour"), id);
    await db.exec("reset role; set role service_role");
    const claim = async () => (await db.query<{
      job: { id: string; lease: string; attempts: number; next_part: number; items: { children: number }[] } | null;
    }>("select public.commerce_telegram_claim() as job")).rows[0].job;
    const first = await claim();
    assert.ok(first);
    assert.equal(first.id, id);
    assert.equal(first.items[0].children, 1);
    assert.equal(await claim(), null);
    await db.exec("update public.commerce_telegram_outbox set lease_until=now()-interval '1 second',next_part=1");
    const second = await claim();
    assert.ok(second);
    assert.equal(second.attempts, 2);
    assert.equal(second.next_part, 1);
    assert.notEqual(second.lease, first.lease);
    await db.exec("update public.commerce_telegram_outbox set sent_at=now()");
    assert.equal(await claim(), null);
  } finally {
    await db.close();
  }
});
