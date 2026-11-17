import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { tourSchema } from "../src/features/tours/model";

// Optional isolated PG17 runtime; never changes the application's dependency.
async function fixture(admin = false) {
  const Constructor = process.env.INVENTORY_TEST_PGLITE_MODULE
    ? (
        (await import(
          pathToFileURL(process.env.INVENTORY_TEST_PGLITE_MODULE).href
        )) as { PGlite: typeof PGlite }
      ).PGlite
    : PGlite;
  const db = new Constructor();
  try {
    await db.exec(
      "create role anon; create role authenticated; grant usage on schema public to anon,authenticated; set check_function_bodies=on;",
    );
    const version = (
      await db.query<{ n: number }>(
        "select current_setting('server_version_num')::int n",
      )
    ).rows[0].n;
    if (process.env.INVENTORY_TEST_PG_MAJOR)
      assert.equal(
        Math.floor(version / 10000),
        Number(process.env.INVENTORY_TEST_PG_MAJOR),
      );
    await db.exec(
      await readFile(
        "supabase/migrations/202610100001_tour_inventory.sql",
        "utf8",
      ),
    );
    const loc = (
      await db.query<{ id: string }>(
        "insert into public.locations(country_slug,slug,kind,name_ru,name_en) values('vietnam','test-rpc-only','city','ТЕСТ','TEST') returning id",
      )
    ).rows[0].id;
    const operator = (
      await db.query<{ id: string }>(
        "insert into public.operators(name,verified_at,external_reference) values('TEST ONLY',now(),'PRIVATE TEST REFERENCE') returning id",
      )
    ).rows[0].id;
    const ids = (
      await db.query<{ id: string; slug: string }>(
        "insert into public.tours(slug,country_slug,location_id,category_slug,operator_id,duration_minutes) values('test-rpc-public','vietnam',$1,'nature',$2,60),('test-rpc-draft','vietnam',$1,'nature',$2,60),('test-rpc-unverified','vietnam',$1,'nature',$2,60) returning id,slug",
        [loc, operator],
      )
    ).rows;
    const id = ids.find((r) => r.slug === "test-rpc-public")!.id;
    await db.exec(
      "insert into public.tour_translations(tour_id,locale,title,description) select t.id,l,'TEST ONLY',array['TEST ONLY'] from public.tours t cross join unnest(array['ru','en']) l;insert into public.tour_images(tour_id,url,alt_ru,alt_en,position) select id,'/images/vietnam.jpg','ТЕСТ','TEST',0 from public.tours;",
    );
    await db.query(
      "update public.tours set status='published',verified_at=now() where id=$1",
      [id],
    );
    for (const row of ids) {
      await db.query(
        `insert into public.tour_prices(tour_id,currency,adult,verified_at,valid_from,valid_until) values
        ($1,'USD',80,now(),current_date-2,current_date+2),
        ($1,'USD',1,null,current_date,current_date+2),
        ($1,'USD',2,now(),current_date+1,current_date+2),
        ($1,'EUR',3,null,null,null),
        ($1,'GBP',4,now(),null,current_date-1),
        ($1,'JPY',5,now(),current_date+1,null),
        ($1,'CAD',30,now(),current_date,current_date)`,
        [row.id],
      );
      await db.query(
        `insert into public.tour_availability(tour_id,service_date,departure_time,capacity,reserved,status,verified_at) values
        ($1,current_date,'09:00',5,2,'available',now()),
        ($1,current_date+1,'09:00',3,0,'available',now()),
        ($1,current_date+1,'10:00',1000,0,'available',null),
        ($1,current_date-1,'09:00',1000,0,'available',now()),
        ($1,current_date+2,'09:00',1000,0,'available',null),
        ($1,current_date+3,'09:00',5,5,'sold_out',now()),
        ($1,current_date+4,'09:00',5,0,'closed',now()),
        ($1,current_date+4,'10:00',1000,0,'available',null)`,
        [row.id],
      );
    }
    if (admin) {
      await db.exec(
        "create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;",
      );
      await db.exec(
        await readFile("supabase/migrations/202610100002_admin.sql", "utf8"),
      );
      await db.exec(
        "insert into auth.users values('00000000-0000-4000-8000-000000000017');insert into public.admin_members values('00000000-0000-4000-8000-000000000017','admin');select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000017',false);",
      );
    }
    return { db, id, ids, version };
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function assertPublicRPC(db: PGlite, id: string) {
  for (const sql of [
    "select public.tour_detail('test-rpc-public') data",
    "select public.tour_payload(t) data from public.tours t where t.id=$1",
  ]) {
    const value = (
      await db.query<{ data: unknown }>(sql, sql.includes("$1") ? [id] : [])
    ).rows[0].data;
    const tour = tourSchema.parse(value);
    assert.deepEqual(
      tour.prices.map((p) => [p.currency, p.adult]).sort(),
      [
        ["CAD", 30],
        ["USD", 80],
      ],
      "public RPC must independently exclude unverified/expired/future rates",
    );
    assert.equal(tour.availability.length, 4);
    assert.deepEqual(
      tour.availability.map((s) => [s.remaining, s.status]),
      [
        [3, "available"],
        [3, "available"],
        [0, "sold_out"],
        [0, "closed"],
      ],
    );
  }
  for (const slug of ["test-rpc-draft", "test-rpc-unverified"]) {
    assert.equal(
      (
        await db.query<{ data: unknown }>(
          "select public.tour_detail($1) data",
          [slug],
        )
      ).rows[0].data,
      null,
    );
  }
  const catalog = async (filters: unknown) =>
    (
      await db.query<{ data: { items: unknown[]; total: number } }>(
        "select public.tour_catalog($1::jsonb) data",
        [JSON.stringify(filters)],
      )
    ).rows[0].data;
  const first = await catalog({
    currency: "USD",
    minPrice: 50,
    maxPrice: 100,
    sort: "price-asc",
    page: 1,
    pageSize: 50,
  });
  assert.equal(first.total, 1);
  assert.equal(first.items.length, 1);
  tourSchema.parse(first.items[0]);
  assert.equal(
    (await catalog({ currency: "USD", maxPrice: 10 })).total,
    0,
    "hidden cheap rates must not influence filtering",
  );
  for (const currency of ["EUR", "GBP", "JPY"])
    assert.equal((await catalog({ currency, minPrice: 0 })).total, 0);
  const missing = await catalog({ search: "definitely-missing-test" });
  assert.deepEqual(missing, { items: [], total: 0 });
  const beyond = await catalog({ page: 100000, pageSize: 100000 });
  assert.equal(beyond.total, 1);
  assert.deepEqual(beyond.items, []);
}

test("inventory RPC creation: validated SQL bodies, SECURITY INVOKER, fixed search_path and narrow function grants", async (t) => {
  const { db, version } = await fixture();
  try {
    t.diagnostic(`PostgreSQL ${version}; check_function_bodies=on`);
    const functions = await db.query<{
      proname: string;
      prosecdef: boolean;
      provolatile: string;
      proconfig: string[];
    }>(
      "select proname,prosecdef,provolatile,proconfig from pg_proc where oid in ('public.tour_payload(public.tours)'::regprocedure,'public.tour_detail(text)'::regprocedure,'public.tour_catalog(jsonb)'::regprocedure)",
    );
    assert.equal(functions.rows.length, 3);
    assert(
      functions.rows.every(
        (f) =>
          !f.prosecdef &&
          f.provolatile === "s" &&
          f.proconfig.includes('search_path=""'),
      ),
    );
    for (const role of ["anon", "authenticated"]) {
      assert.equal(
        (
          await db.query<{ allowed: boolean }>(
            "select has_function_privilege($1,'public.tour_catalog(jsonb)','EXECUTE') allowed",
            [role],
          )
        ).rows[0].allowed,
        true,
      );
    }
    await db.exec("create role test_rpc_outsider nologin");
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('test_rpc_outsider','public.tour_catalog(jsonb)','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});
test("inventory RPC ordinary anon/authenticated: draft denial and verified, current prices/slots only", async () => {
  const { db, id } = await fixture();
  try {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      assert.equal(
        (await db.query("select * from public.tours")).rows.length,
        1,
      );
      assert.equal(
        (await db.query("select * from public.tour_prices")).rows.length,
        2,
      );
      assert.equal(
        (await db.query("select * from public.tour_availability")).rows.length,
        4,
      );
      await assertPublicRPC(db, id);
      await assert.rejects(
        db.query("select external_reference from public.operators"),
      );
      await db.exec("reset role");
    }
  } finally {
    await db.close();
  }
});
test("inventory public RPC remains verified-only for authenticated administrator after migration 002", async () => {
  const { db, id } = await fixture(true);
  try {
    await db.exec("set role authenticated");
    assert.equal(
      (
        await db.query<{ admin: boolean }>(
          "select public.is_inventory_admin() admin",
        )
      ).rows[0].admin,
      true,
    );
    assert.equal(
      (await db.query("select * from public.tour_prices")).rows.length,
      21,
      "admin legitimately sees private raw rows through its separate policy",
    );
    await assertPublicRPC(db, id);
  } finally {
    await db.close();
  }
});
test("inventory public RPC owner execution does not accidentally include unverified price/slot rows", async () => {
  const { db, id } = await fixture();
  try {
    assert.equal(
      (await db.query("select * from public.tour_prices")).rows.length,
      21,
    );
    await assertPublicRPC(db, id);
  } finally {
    await db.close();
  }
});
