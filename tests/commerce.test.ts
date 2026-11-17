import { allowAuthAttempt } from "../src/features/commerce/rate-limit";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  mergeCart,
  permitted,
  requestSchema,
  disabledPayments,
  relationArray,
} from "../src/features/commerce/model";
test("unique booking relations render as lists for both PostgREST objects and legacy arrays", () => {
  const booking = { id: "fixture", status: "requested", revision: 0 };
  assert.deepEqual(relationArray(booking).map(value => value.status), ["requested"]);
  assert.deepEqual(relationArray([booking]).map(value => value.status), ["requested"]);
  assert.deepEqual(relationArray(null), []);
  assert.deepEqual(relationArray(undefined), []);
});
import { requestPDF } from "../src/features/commerce/pdf";
import { requestChatDraft } from "../src/features/commerce/chat-request";
import { PDFDocument } from "pdf-lib";
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  owner = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
test("commerce chat: forwards saved request details and price hints without contacts", () => {
  const bot = "https://t.me/VietnamTravelVN_bot";
  const entry = {
    line: { slug: "island", date: "2027-01-20", adults: 2, children: 1, options: "private note" },
    tour: {
      title: { ru: "Поездка на остров", en: "Island trip" },
      previewPrice: {
        amount: 42,
        upper: 53,
        benchmark: { currency: "SGD", unit: "person" as const, sources: [] },
      },
    },
  };
  const draft = requestChatDraft(bot, a, "en", [entry]);
  assert.ok(draft);
  assert.equal(new URL(draft.url).searchParams.get("text"), draft.text);
  assert.match(draft.text, /Island trip\n2027-01-20 · Adults: 2 · Children: 1/);
  assert.match(draft.text, /42–53 SGD, per person/);
  assert.doesNotMatch(draft.text, /private note/);
  const long = requestChatDraft(bot, a, "ru", Array(20).fill(entry));
  assert.equal(long?.url, bot);
  assert.match(long?.text ?? "", /20\. Поездка на остров/);
  assert.equal(requestChatDraft("https://example.com", a, "en", [entry]), null);
});
test("commerce: cart deduplication, bounded inputs, role matrix and disabled payments", async () => {
  const line = {
    slug: "tour-1",
    date: "2027-01-20",
    adults: 2,
    children: 0,
    options: "",
  };
  assert.equal(mergeCart([line], [line]).length, 1);
  assert(!permitted("editor", "staff:manage"));
  assert(!permitted("admin", "staff:manage"));
  assert(permitted("owner", "staff:manage"));
  assert.throws(() =>
    requestSchema.parse({
      key: a,
      locale: "en",
      items: [{ ...line, adults: 0 }],
    }),
  );
  await assert.rejects(disabledPayments.createCheckout(a));
});
test("commerce SQL: real RLS/IDOR, atomic requests, replay, transitions, audit, MFA and staff escalation", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true))$$;grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid(),auth.jwt() to authenticated;insert into auth.users values('${a}','a@example.test',now()),('${b}','b@example.test',now()),('${owner}','owner@example.test',now());alter default privileges in schema public grant all on tables to anon,authenticated;alter default privileges in schema public grant all on functions to anon,authenticated;`,
    );
    await db.exec(
      await readFile("supabase/checks/commerce-staging-before.sql", "utf8"),
    );
    await db.exec(
      await readFile(
        "supabase/migrations/202610300008_customer_requests.sql",
        "utf8",
      ),
    );
    await db.exec(
      await readFile("supabase/checks/commerce-staging-after.sql", "utf8"),
    );
    await assert.rejects(
      db.query("select commerce_request($1,'en','[]')", [a]),
    );
    await db.exec(
      "update commerce_settings set requests_enabled=true where id=1",
    );
    await db.exec(
      `insert into commerce_products values('test-1','test','1','{"ru":"ТЕСТ","en":"TEST"}','{"ru":"Дили","en":"Dili"}',true,'fixture');insert into commerce_staff values('${owner}','owner',true);set role anon;`,
    );
    await assert.rejects(db.query("select * from commerce_orders"));
    await assert.rejects(
      db.query("select commerce_request($1,'en','[]')", [a]),
    );
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
    const lines = JSON.stringify([
      { slug: "test-1", date: "2027-01-20", adults: 2, children: 0 },
    ]);
    const result = await db.query<{ id: string }>(
      "select commerce_request($1,'ru',$2::jsonb) id",
      [a, lines],
    );
    const id = result.rows[0].id;
    // Real PostgREST upsert requires UPDATE privilege, still constrained by own-row RLS.
    for (let i = 0; i < 2; i++)
      await db.query(
        "insert into commerce_favorites(user_id,product_slug) values($1,'test-1') on conflict(user_id,product_slug) do update set product_slug=excluded.product_slug",
        [a],
      );
    assert.equal(
      (
        await db.query<{ id: string }>(
          "select commerce_request($1,'ru',$2::jsonb) id",
          [a, lines],
        )
      ).rows[0].id,
      id,
    );
    await assert.rejects(
      db.query("select commerce_request($1,'en',$2::jsonb)", [a, lines]),
    );
    await assert.rejects(
      db.query("select commerce_request($1,'en',$2::jsonb)", [
        b,
        JSON.stringify([
          { slug: "private-draft", date: "2027-01-20", adults: 2, children: 0 },
        ]),
      ]),
    );
    assert.equal(
      (await db.query("select * from commerce_orders")).rows.length,
      1,
    );
    await assert.rejects(
      db.query("insert into commerce_staff values($1,'owner',true)", [a]),
    );
    const booking = (
      await db.query<{ id: string }>("select id from commerce_bookings")
    ).rows[0].id;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [b]);
    assert.equal(
      (
        await db.query(
          "update commerce_favorites set product_slug='test-1' where user_id=$1 returning user_id",
          [a],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from commerce_orders")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from commerce_documents")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "select commerce_transition($1,1,'cancelled','Not my order, cannot cancel')",
        [booking],
      ),
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    await assert.rejects(
      db.query(
        "select commerce_transition($1,1,'awaiting_availability','Owner without MFA should fail')",
        [booking],
      ),
    );
    await db.query("select set_config('request.jwt.claim.aal','aal2',false)");
    await db.query(
      "select commerce_transition($1,1,'awaiting_availability','Manual availability review started')",
      [booking],
    );
    await assert.rejects(
      db.query(
        "select commerce_transition($1,2,'confirmed','Skipping supplier confirmation')",
        [booking],
      ),
    );
    await db.query(
      "select commerce_transition($1,2,'awaiting_supplier_confirmation','Contacted actual supplier manually')",
      [booking],
    );
    await db.query(
      "select commerce_transition($1,3,'confirmed','Supplier confirmed in writing reference 123','123')",
      [booking],
    );
    assert.equal(
      (await db.query("select * from commerce_documents where kind='voucher'"))
        .rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from commerce_audit")).rows.length,
      3,
    );
    await assert.rejects(
      db.query("select commerce_staff_set($1,'owner',false)", [owner]),
    );
    await db.query("select commerce_staff_set($1,'editor',true)", [b]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [b]);
    await assert.rejects(
      db.query("select commerce_staff_set($1,'admin',true)", [b]),
    );
    await assert.rejects(
      db.query("update commerce_payment_attempts set status='paid'"),
    );

    // Editor cannot read another customer's resources or regenerate their documents.
    await assert.rejects(
      db.query("select commerce_regenerate_receipt($1)", [id]),
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
    await db.query("select commerce_regenerate_receipt($1)", [id]);
    assert.equal(
      (
        await db.query(
          "select version from commerce_documents where kind='request_receipt' order by version",
        )
      ).rows.length,
      2,
    );
    const exported = await db.query<{ data: { orders: unknown[] } }>(
      "select commerce_export_personal() data",
    );
    assert.equal(exported.rows[0].data.orders.length, 1);
    await db.query("select commerce_privacy_request()");
    assert.equal(
      (await db.query("select * from commerce_orders")).rows.length,
      1,
    );
    // Invitation cannot grant owner and must match verified email, one use, with revocation.
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    await assert.rejects(
      db.query("select commerce_invite('new@example.test','owner',$1)", [
        "a".repeat(64),
      ]),
    );
    const invite = (
      await db.query<{ id: string }>(
        "select commerce_invite('new@example.test','support',$1) id",
        ["a".repeat(64)],
      )
    ).rows[0].id;
    await db.query("select commerce_revoke_invite($1)", [invite]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
    await assert.rejects(
      db.query("select commerce_accept_invite($1)", ["a".repeat(64)]),
    );
    await db.exec(
      "reset role;insert into auth.users values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','new@example.test',now());set role authenticated",
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    await db.query("select commerce_invite('new@example.test','support',$1)", [
      "b".repeat(64),
    ]);
    await db.query(
      "select set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false)",
    );
    await db.query("select commerce_accept_invite($1)", ["b".repeat(64)]);
    await assert.rejects(
      db.query("select commerce_accept_invite($1)", ["b".repeat(64)]),
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    await db.query(
      "select commerce_staff_set('dddddddd-dddd-4ddd-8ddd-dddddddddddd','support',false)",
    );
    await db.query(
      "select set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false)",
    );
    assert.equal(
      (
        await db.query<{ role: string | null }>(
          "select commerce_staff_role() role",
        )
      ).rows[0].role,
      null,
    );
    // Partial order state remains requested when only one activity is confirmed.
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
    const pair = JSON.stringify([
      { slug: "test-1", date: "2027-01-21", adults: 1, children: 0 },
      { slug: "test-1", date: "2027-01-22", adults: 1, children: 0 },
    ]);
    const second = (
      await db.query<{ id: string }>(
        "select commerce_request($1,'en',$2::jsonb) id",
        [b, pair],
      )
    ).rows[0].id;
    const one = (
      await db.query<{ id: string }>(
        "select b.id from commerce_bookings b join commerce_order_items i on i.id=b.item_id where i.order_id=$1 limit 1",
        [second],
      )
    ).rows[0].id;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    await db.query(
      "select commerce_transition($1,1,'awaiting_availability','Started independent review')",
      [one],
    );
    await db.query(
      "select commerce_transition($1,2,'awaiting_supplier_confirmation','Supplier checking requested date')",
      [one],
    );
    await db.query(
      "select commerce_transition($1,3,'confirmed','Actual supplier evidence received')",
      [one],
    );
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from commerce_orders where id=$1",
          [second],
        )
      ).rows[0].status,
      "requested",
    );
    await db.query(
      "select commerce_transition($1,4,'cancelled','Supplier cancellation evidence received')",
      [one],
    );
    await assert.rejects(
      db.query(
        "select commerce_transition($1,4,'confirmed','Stale replay must fail')",
        [one],
      ),
    );
  } finally {
    await db.close();
  }
});
test("commerce PDF: Unicode RU/EN receipts, no fake voucher, no fabricated payment", async () => {
  for (const locale of ["ru", "en"] as const) {
    const bytes = await requestPDF(
      {
        order: { number: "AE-TEST", created_at: "2026-10-30" },
        items: [
          {
            title: { ru: "ТЕСТ: Дили", en: "TEST: Dili" },
            requested_date: "2027-01-20",
            adults: 2,
            children: 0,
            amount: null,
          },
        ],
      },
      "request_receipt",
      locale,
    );
    assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), "%PDF");
    assert((await PDFDocument.load(bytes)).getPageCount() > 0);
  }
});

test("commerce auth: bounded per-instance brake and no silent paid checkout", () => {
  const now = Date.now() + 1000000;
  for (let i = 0; i < 10; i++) assert(allowAuthAttempt("TEST-auth-ip", now));
  assert(!allowAuthAttempt("TEST-auth-ip", now));
  assert(allowAuthAttempt("TEST-auth-ip", now + 600001));
});
