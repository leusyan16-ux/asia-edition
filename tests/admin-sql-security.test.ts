import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { adminTourSchema, type AdminTour } from "../src/features/admin/model";
import { demoTour } from "../src/features/tours/demo";

const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa17",
  user = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb17",
  viewer = "cccccccc-cccc-4ccc-8ccc-cccccccccc17";
async function context() {
  const Constructor = process.env.ADMIN_SQL_TEST_PGLITE_MODULE
    ? (
        (await import(
          pathToFileURL(process.env.ADMIN_SQL_TEST_PGLITE_MODULE).href
        )) as { PGlite: typeof PGlite }
      ).PGlite
    : PGlite;
  const db = new Constructor();
  try {
    const version = (
      await db.query<{ n: number }>(
        "select current_setting('server_version_num')::int n",
      )
    ).rows[0].n;
    if (process.env.ADMIN_SQL_TEST_PG_MAJOR)
      assert.equal(
        Math.floor(version / 10000),
        Number(process.env.ADMIN_SQL_TEST_PG_MAJOR),
      );
    await db.exec(
      `set check_function_bodies=on;create role anon;create role authenticated;grant usage on schema public to anon,authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated;`,
    );
    for (const file of [
      "202610100001_tour_inventory.sql",
      "202610100002_admin.sql",
    ])
      await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
    await db.query("insert into auth.users values($1),($2),($3)", [
      admin,
      user,
      viewer,
    ]);
    await db.query(
      "insert into public.admin_members values($1,'admin'),($2,'viewer')",
      [admin, viewer],
    );
    await db.exec(
      "insert into public.locations(country_slug,slug,kind,name_ru,name_en) values('vietnam','ha-long-bay','destination','ТЕСТ','TEST');",
    );
    const operator = (
      await db.query<{ id: string }>(
        "insert into public.operators(name,verified_at) values('TEST ONLY VERIFIED',now()) returning id",
      )
    ).rows[0].id;
    const unverified = (
      await db.query<{ id: string }>(
        "insert into public.operators(name) values('TEST ONLY UNVERIFIED') returning id",
      )
    ).rows[0].id;
    const login = async (
      role: "anon" | "authenticated" | "postgres",
      uid = "",
    ) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        uid,
      ]);
      if (role !== "postgres") await db.exec(`set role ${role}`);
    };
    const document = () =>
      adminTourSchema.parse({
        ...demoTour,
        id: randomUUID(),
        slug: "test-admin-sql-" + randomUUID(),
        title: { ru: "ТЕСТ SQL", en: "TEST SQL" },
        status: "draft",
        isDemo: false,
        operator: { id: operator, name: "TEST ONLY VERIFIED" },
        verifiedAt: new Date().toISOString(),
        slots: [],
      });
    const save = async (documents: unknown, expected: unknown = {}) =>
      (
        await db.query<{ data: AdminTour[] }>(
          "select public.admin_save_batch($1::jsonb,$2::jsonb) data",
          [JSON.stringify(documents), JSON.stringify(expected)],
        )
      ).rows[0].data;
    return { db, version, operator, unverified, login, document, save };
  } catch (e) {
    await db.close();
    throw e;
  }
}

test("admin SQL creation/ACL: fixed SECURITY DEFINER search_path, revoked defaults, RLS, viewer and no self-escalation", async (t) => {
  const { db, version, login, document, save } = await context();
  try {
    t.diagnostic(
      "PostgreSQL " +
        version +
        "; updated 001 + 002 with check_function_bodies=on",
    );
    const functions = (
      await db.query<{
        proname: string;
        prosecdef: boolean;
        proconfig: string[];
      }>(
        "select proname,prosecdef,proconfig from pg_proc where oid in ('public.is_inventory_admin()'::regprocedure,'public.admin_inventory(uuid)'::regprocedure,'public.admin_overview()'::regprocedure,'public.admin_save_batch(jsonb,jsonb)'::regprocedure)",
      )
    ).rows;
    assert.equal(functions.length, 4);
    assert(
      functions.every(
        (f) => f.prosecdef && f.proconfig.includes('search_path=""'),
      ),
    );
    await login("anon");
    for (const sql of [
      "select public.is_inventory_admin()",
      "select public.admin_inventory()",
      "select public.admin_overview()",
      "select public.admin_save_batch('[]','{}')",
      "select * from public.admin_members",
    ])
      await assert.rejects(db.query(sql));
    for (const uid of ["", user, viewer]) {
      await login("authenticated", uid);
      assert.equal(
        (
          await db.query<{ yes: boolean }>(
            "select public.is_inventory_admin() yes",
          )
        ).rows[0].yes,
        false,
      );
      for (const sql of [
        "select public.admin_inventory()",
        "select public.admin_overview()",
        "select public.admin_save_batch('[]','{}')",
        "select public.admin_tour_payload(t) from public.tours t",
        "update public.admin_members set role='admin'",
        "delete from public.admin_audit_events",
        "truncate public.admin_tour_documents",
      ])
        await assert.rejects(db.query(sql));
      await assert.rejects(
        db.query("insert into public.admin_members values($1,'admin')", [user]),
      );
    }
    // search_path poisoning must not replace the qualified authority table/helper.
    await login("authenticated", user);
    await db.exec(
      `create temp table admin_members(user_id uuid,role text);insert into pg_temp.admin_members values('${user}','admin');create function pg_temp.is_inventory_admin() returns boolean language sql as $$select true$$;set search_path=pg_temp,public;`,
    );
    assert.equal(
      (
        await db.query<{ yes: boolean }>(
          "select public.is_inventory_admin() yes",
        )
      ).rows[0].yes,
      false,
    );
    await assert.rejects(save([document()]));
    await login("authenticated", admin);
    assert.equal(
      (
        await db.query<{ yes: boolean }>(
          "select public.is_inventory_admin() yes",
        )
      ).rows[0].yes,
      true,
    );
    await assert.rejects(
      db.query("update public.tours set status='published'"),
    );
    const [saved] = await save([document()]);
    assert(saved);
    await login("authenticated", viewer);
    assert.equal(
      (await db.query("select * from public.admin_audit_events")).rows.length,
      0,
    );
    await login("postgres");
    await db.query("delete from public.admin_members where user_id=$1", [
      admin,
    ]);
    await login("authenticated", admin);
    await assert.rejects(save([document()]));
  } finally {
    await db.close();
  }
});

test("admin_save_batch validation: SQL/JSON nulls and malformed/empty batch cannot be reported as saved", async () => {
  const { db, login, save } = await context();
  try {
    await login("authenticated", admin);
    await assert.rejects(
      db.query("select public.admin_save_batch(null,'{}')"),
      /Invalid batch/,
    );
    for (const documents of [null, {}, [], [null]])
      await assert.rejects(save(documents));
    await assert.rejects(save(Array.from({ length: 1001 }, () => ({}))));
    await assert.rejects(save([{}], []));
  } finally {
    await db.close();
  }
});

test("admin_save_batch booked slots: stable IDs/FK references, immutable reservations and atomic failures", async () => {
  const { db, login, document, save } = await context();
  try {
    await login("authenticated", admin);
    const slot: AdminTour["slots"][number] = {
      date: "2099-01-01",
      time: "09:00",
      capacity: 5,
      reserved: 0,
      status: "available",
      verifiedAt: new Date().toISOString(),
    };
    let [saved] = await save([
      { ...document(), slots: [slot, { ...slot, date: "2099-01-02" }] },
    ]);
    await login("postgres");
    const before = (
      await db.query<{ id: string; service_date: string }>(
        "select id,service_date::text from public.tour_availability where tour_id=$1 order by service_date",
        [saved.id],
      )
    ).rows;
    await db.query(
      "update public.tour_availability set reserved=2 where id=$1",
      [before[0].id],
    );
    // Detect accidental DELETE/reinsert even with a cascading booking reference.
    await db.exec(
      "create table public.test_booking_reference(slot_id uuid references public.tour_availability(id) on delete cascade)",
    );
    await db.query("insert into public.test_booking_reference values($1)", [
      before[0].id,
    ]);
    saved = {
      ...saved,
      slots: [
        { ...slot, reserved: 2 },
        { ...slot, date: "2099-01-02" },
      ],
    };
    await login("authenticated", admin);
    [saved] = await save(
      [{ ...saved, summary: { ru: "ТЕСТ ПРАВКА", en: "TEST EDIT" } }],
      { [saved.id]: saved.updatedAt },
    );
    await login("postgres");
    assert.deepEqual(
      (
        await db.query<{ id: string; service_date: string }>(
          "select id,service_date::text from public.tour_availability where tour_id=$1 order by service_date",
          [saved.id],
        )
      ).rows,
      before,
      "slot identity must survive an ordinary content edit",
    );
    assert.equal(
      (await db.query("select * from public.test_booking_reference")).rows
        .length,
      1,
    );
    await login("authenticated", admin);
    for (const slots of [
      [],
      [{ ...slot, reserved: 0 }],
      [{ ...slot, reserved: 3 }],
      [{ ...slot, reserved: 2, date: "2099-02-01" }],
      [{ ...slot, reserved: 2, time: "10:00" }],
      [{ ...slot, reserved: 2, capacity: 1 }],
      saved.slots.concat(saved.slots),
    ]) {
      await assert.rejects(
        save([{ ...saved, slots }], { [saved.id]: saved.updatedAt }),
      );
      assert.equal(
        (
          await db.query<{ reserved: number }>(
            "select reserved from public.tour_availability where id=$1",
            [before[0].id],
          )
        ).rows[0].reserved,
        2,
      );
    }
    // A booking committed since the editor loaded does not touch tours.updated_at.
    // The independent reservation guard must still reject that stale document.
    await login("postgres");
    await db.query(
      "update public.tour_availability set reserved=3 where id=$1",
      [before[0].id],
    );
    await login("authenticated", admin);
    await assert.rejects(
      save([saved], { [saved.id]: saved.updatedAt }),
      /Booked slot protected/,
    );
    assert.equal(
      (
        await db.query<{ reserved: number }>(
          "select reserved from public.tour_availability where id=$1",
          [before[0].id],
        )
      ).rows[0].reserved,
      3,
    );
    await login("postgres");
    await db.query(
      "update public.tour_availability set reserved=2 where id=$1",
      [before[0].id],
    );
    await login("authenticated", admin);
    // Removing only an unbooked slot is permitted, without touching the booked one.
    [saved] = await save([{ ...saved, slots: [{ ...slot, reserved: 2 }] }], {
      [saved.id]: saved.updatedAt,
    });
    assert.equal(
      (
        await db.query(
          "select * from public.tour_availability where tour_id=$1",
          [saved.id],
        )
      ).rows.length,
      1,
    );
    await assert.rejects(
      save(
        [
          {
            ...saved,
            slots: saved.slots.concat({
              ...slot,
              date: "2099-01-03",
              reserved: 1,
            }),
          },
        ],
        { [saved.id]: saved.updatedAt },
      ),
      /Reservation count protected/,
    );
  } finally {
    await db.close();
  }
});

test("admin_save_batch publication: missing verification/content and unreviewed external products rejected, public RPC compatibility preserved", async () => {
  const { db, login, document, save, unverified } = await context();
  try {
    await login("authenticated", admin);
    const input = { ...document(), status: "published" };
    for (const patch of [
      { verifiedAt: null },
      { operator: null },
      { operator: { id: unverified, name: "TEST UNVERIFIED" } },
      { images: [] },
      { durationMinutes: null },
      { title: { ru: "ТЕСТ", en: "" } },
      { description: { ru: ["ТЕСТ"], en: [] } },
      { archived: true },
      {
        externalProduct: {
          provider: "test",
          editorial_status: "pending",
          content_rights_status: "unknown",
        },
      },
    ])
      await assert.rejects(save([{ ...input, ...patch }]));
    const marker = {
      provider: "test",
      editorial_status: "pending",
      content_rights_status: "unknown",
    };
    const [sourceDraft] = await save([
      { ...document(), externalProduct: marker },
    ]);
    await assert.rejects(
      save([{ ...sourceDraft, externalProduct: null, status: "published" }], {
        [sourceDraft.id]: sourceDraft.updatedAt,
      }),
      /reviewed publication workflow/,
    );
    const [retained] = await save([{ ...sourceDraft, externalProduct: null }], {
      [sourceDraft.id]: sourceDraft.updatedAt,
    });
    assert.deepEqual(retained.externalProduct, marker);
    await assert.rejects(
      save([{ ...retained, externalProduct: null, status: "published" }], {
        [retained.id]: retained.updatedAt,
      }),
      /reviewed publication workflow/,
    );
    const [published] = await save([input]);
    await login("anon");
    assert(
      (
        await db.query<{ data: { id: string } }>(
          "select public.tour_detail($1) data",
          [published.slug],
        )
      ).rows[0].data?.id === published.id,
    );
    await login("authenticated", admin);
    const [hidden] = await save([{ ...published, visible: false }], {
      [published.id]: published.updatedAt,
    });
    await login("anon");
    assert.equal(
      (
        await db.query<{ data: unknown }>(
          "select public.tour_detail($1) data",
          [hidden.slug],
        )
      ).rows[0].data,
      null,
    );
  } finally {
    await db.close();
  }
});

test("admin_save_batch transaction: stale version and a failing second document roll back content, slots and audit", async () => {
  const { db, login, document, save } = await context();
  try {
    await login("authenticated", admin);
    const [saved] = await save([document()]);
    const audits = (await db.query("select * from public.admin_audit_events"))
      .rows.length;
    await assert.rejects(
      save([{ ...saved, title: { ru: "ТЕСТ ИЗМЕНЕНИЕ", en: "TEST CHANGE" } }], {
        [saved.id]: "2000-01-01",
      }),
      /version conflict/,
    );
    const second = { ...document(), location: "test-does-not-exist" };
    await assert.rejects(
      save(
        [
          { ...saved, title: { ru: "ТЕСТ ИЗМЕНЕНИЕ", en: "TEST CHANGE" } },
          second,
        ],
        { [saved.id]: saved.updatedAt },
      ),
      /Invalid location/,
    );
    assert.equal(
      (
        await db.query<{ title: string }>(
          "select title from public.tour_translations where tour_id=$1 and locale='en'",
          [saved.id],
        )
      ).rows[0].title,
      saved.title.en,
    );
    assert.equal(
      (await db.query("select * from public.admin_audit_events")).rows.length,
      audits,
    );
  } finally {
    await db.close();
  }
});
