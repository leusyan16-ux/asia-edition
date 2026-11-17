import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  adminTourSchema,
  adminDocumentSchema,
  adminSummarySchema,
} from "../src/features/admin/model";
import { demoTour } from "../src/features/tours/demo";
test("admin PostgreSQL: actual RLS, role provisioning, normalized writes, rollback, publication and conflicts", async () => {
  const db = new PGlite();
  const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    user = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  try {
    await db.exec(
      `create role anon;create role authenticated;grant usage on schema public to anon,authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;insert into auth.users values('${admin}'),('${user}');`,
    );
    await db.exec(
      "alter default privileges in schema public grant all on tables to anon,authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated;",
    );
    await db.exec(
      await readFile(
        "supabase/migrations/202610100001_tour_inventory.sql",
        "utf8",
      ),
    );
    await db.exec(
      await readFile("supabase/migrations/202610100002_admin.sql", "utf8"),
    );
    const privileges = await db.query<{ allowed: boolean }>(
      "select has_table_privilege('authenticated','admin_audit_events','TRUNCATE') or has_table_privilege('anon','admin_tour_documents','TRUNCATE') or has_function_privilege('anon','admin_inventory(uuid)','EXECUTE') or has_function_privilege('authenticated','admin_tour_payload(tours)','EXECUTE') allowed",
    );
    assert.equal(privileges.rows[0].allowed, false);
    await db.query("insert into admin_members values($1,'admin')", [admin]);
    await db.exec(
      "insert into locations(country_slug,slug,kind,name_ru,name_en) values('vietnam','ha-long-bay','destination','ТЕСТ','TEST');",
    );
    await db.exec("set role anon");
    await assert.rejects(db.query("select external_reference from operators"));
    await assert.rejects(db.query("select admin_inventory()"));
    await assert.rejects(db.query("select admin_save_batch('[]')"));
    await assert.rejects(db.query("select * from admin_members"));
    await db.exec("reset role");
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    assert.equal(
      (await db.query("select * from admin_members")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("insert into admin_members values($1,'admin')", [user]),
    );
    await assert.rejects(db.query("select admin_inventory()"));
    await assert.rejects(db.query("update tours set status='published'"));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    assert.equal(
      (await db.query("select * from admin_members")).rows.length,
      1,
    );
    const t = adminTourSchema.parse({ ...demoTour, status: "draft" });
    const save = async (
      documents: unknown[],
      expected: Record<string, string> = {},
    ) =>
      (
        await db.query<{ data: unknown[] }>(
          "select admin_save_batch($1::jsonb,$2::jsonb) data",
          [JSON.stringify(documents), JSON.stringify(expected)],
        )
      ).rows[0].data.map((d) => adminTourSchema.parse(d));
    const [saved] = await save([t]);
    assert.equal(
      (await db.query("select * from tour_itinerary")).rows.length,
      t.itinerary.length,
    );
    assert.equal(
      (await db.query("select * from tour_prices")).rows.length,
      t.prices.length,
    );
    assert.equal(
      (await db.query("select * from tour_translations")).rows.length,
      2,
    );
    assert.equal(
      (await db.query<{ data: unknown[] }>("select admin_inventory() data"))
        .rows[0].data.length,
      1,
    );
    await assert.rejects(
      save([{ ...saved, title: { ru: "Changed", en: "Changed" } }], {
        [saved.id]: "2000-01-01",
      }),
    );
    await assert.rejects(
      save([{ ...saved, status: "published", isDemo: false }], {
        [saved.id]: saved.updatedAt,
      }),
    );
    const first = {
      ...t,
      id: "00000000-0000-4000-8000-000000000002",
      slug: "atomic-first",
    };
    const bad = {
      ...t,
      id: "00000000-0000-4000-8000-000000000003",
      slug: t.slug,
    };
    await assert.rejects(save([first, bad]));
    assert.equal(
      (await db.query("select * from tours where slug='atomic-first'")).rows
        .length,
      0,
    );
    await db.exec("reset role");
    const op = (
      await db.query<{ id: string }>(
        "insert into operators(name,verified_at) values('TEST ONLY',now()) returning id",
      )
    ).rows[0].id;
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    const [published] = await save(
      [
        {
          ...saved,
          status: "published",
          isDemo: false,
          verifiedAt: new Date().toISOString(),
          operator: { id: op, name: "TEST ONLY" },
          prices: saved.prices.map((p) => ({
            ...p,
            verifiedAt: new Date().toISOString(),
          })),
          slots: [
            {
              date: "2099-01-01",
              time: "09:00",
              capacity: 5,
              reserved: 0,
              status: "available",
              verifiedAt: new Date().toISOString(),
            },
          ],
        },
      ],
      { [saved.id]: saved.updatedAt },
    );
    await db.exec("reset role;set role anon");
    assert.equal((await db.query("select * from tours")).rows.length, 1);
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    await save([{ ...published, visible: false }], {
      [published.id]: published.updatedAt,
    });
    await db.exec("reset role;set role anon");
    assert.equal((await db.query("select * from tours")).rows.length, 0);
    await db.exec("reset role");
    // Existing reserved places survive edits and cannot be forged by a direct RPC caller.
    await db.query("update tour_availability set reserved=2 where tour_id=$1", [
      t.id,
    ]);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    const inventory = (
      await db.query<{ data: unknown[] }>("select admin_inventory() data")
    ).rows[0].data.map((d) => adminTourSchema.parse(d));
    await assert.rejects(
      save([{ ...inventory[0], slots: [] }], {
        [t.id]: inventory[0].updatedAt,
      }),
    );
    assert.equal(inventory[0].slots[0].reserved, 2);
    await save(
      [{ ...inventory[0], summary: { ru: "Только тест", en: "Test only" } }],
      { [t.id]: inventory[0].updatedAt },
    );
    await db.exec("reset role");
    await db.exec(
      "insert into tours(slug,country_slug,location_id,category_slug) select 'legacy-incomplete','vietnam',id,'nature' from locations where slug='ha-long-bay'; insert into tour_translations(tour_id,locale,title) select id,'ru','Только тест' from tours where slug='legacy-incomplete';",
    );
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    const legacy = (
      await db.query<{ data: unknown[] }>("select admin_inventory() data")
    ).rows[0].data
      .map((d) => adminDocumentSchema.parse(d))
      .find((t) => t.slug === "legacy-incomplete");
    assert.equal(legacy?.title.ru, "Только тест");
    assert.equal(legacy?.title.en, "");
    assert.deepEqual(legacy?.description.en, []);
    const summaries = (
      await db.query<{ data: unknown[] }>("select admin_overview() data")
    ).rows[0].data.map((s) => adminSummarySchema.parse(s));
    assert.equal(summaries.length, 2);
    assert.ok(
      summaries
        .find((t) => t.slug === "legacy-incomplete")
        ?.missing.includes("Название EN"),
    );
    assert.ok(!("description" in summaries[0]));
    assert.equal(
      (
        await db.query<{ data: unknown[] }>(
          "select admin_inventory($1::uuid) data",
          [t.id],
        )
      ).rows[0].data.length,
      1,
    );
    assert.ok(
      (await db.query("select * from admin_audit_events")).rows.length >= 4,
    );
    await db.exec("reset role");
    await db.exec(
      "insert into tours(slug,country_slug,location_id,category_slug) select 'admin-scale-test-'||n,'vietnam',l.id,'nature' from generate_series(1,360) n cross join locations l where l.slug='ha-long-bay'; insert into tour_translations(tour_id,locale,title) select t.id,lang,'TEST ONLY' from tours t cross join unnest(array['ru','en']) lang where t.slug like 'admin-scale-test-%';",
    );
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    const scaled = (
      await db.query<{ data: unknown[] }>("select admin_overview() data")
    ).rows[0].data.map((t) => adminSummarySchema.parse(t));
    assert.equal(scaled.length, 362);
    assert.equal(scaled.filter((t) => t.status === "draft").length, 361);
    assert.ok(
      scaled
        .filter((t) => t.slug.startsWith("admin-scale-test-"))
        .every((t) => t.missing.length > 0),
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    assert.equal(
      (await db.query("select * from admin_audit_events")).rows.length,
      0,
    );
    await assert.rejects(db.query("select admin_inventory()"));
    await assert.rejects(db.query("select admin_overview()"));
    await db.exec("reset role");
    await db.query("delete from admin_members where user_id=$1", [admin]);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    await assert.rejects(db.query("select admin_inventory()"));
    await assert.rejects(db.query("select admin_save_batch('[]')"));
  } finally {
    await db.close();
  }
});
