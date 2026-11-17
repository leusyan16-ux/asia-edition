import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";

async function fixture(withSource = true) {
  const Constructor = process.env.EXTERNAL_SQL_TEST_PGLITE_MODULE
    ? (
        (await import(
          pathToFileURL(process.env.EXTERNAL_SQL_TEST_PGLITE_MODULE).href
        )) as { PGlite: typeof PGlite }
      ).PGlite
    : PGlite;
  const db = new Constructor();
  try {
    await db.exec(`set check_function_bodies=on;
      create role anon; create role authenticated;
      grant usage on schema public to anon,authenticated;
      alter default privileges in schema public grant all on tables to anon,authenticated;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;`);
    const version = (
      await db.query<{ n: number }>(
        "select current_setting('server_version_num')::int n",
      )
    ).rows[0].n;
    if (process.env.EXTERNAL_SQL_TEST_PG_MAJOR)
      assert.equal(
        Math.floor(version / 10000),
        Number(process.env.EXTERNAL_SQL_TEST_PG_MAJOR),
      );
    for (const file of [
      "202610100001_tour_inventory.sql",
      "202610100002_admin.sql",
      "202610140003_external_import_foundation.sql",
    ])
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    await db.exec(`insert into public.locations(country_slug,slug,kind,name_ru,name_en) values('vietnam','test-only','city','ТЕСТ','TEST');
      insert into public.operators(name,verified_at) values('TEST ONLY',now());
      insert into public.tours(slug,country_slug,location_id,category_slug,operator_id,verified_at)
      select 'test-external','vietnam',l.id,'culture',o.id,now() from public.locations l cross join public.operators o;
      insert into public.tour_translations(tour_id,locale,title,description) select t.id,l,'TEST ONLY',array['TEST ONLY'] from public.tours t cross join unnest(array['ru','en']) l;
      insert into public.tour_images(tour_id,url,alt_ru,alt_en,position) select id,'/images/test-only.jpg','ТЕСТ','TEST',0 from public.tours;
      insert into public.tour_prices(tour_id,currency,adult,verified_at) select id,'USD',1,now() from public.tours;
      insert into public.tour_availability(tour_id,service_date,departure_time,capacity,status,verified_at) select id,current_date+1,'09:00',1,'available',now() from public.tours;
      update public.tours set status='published';`);
    if (withSource)
      await db.exec(`insert into public.external_product_sources(tour_id,provider,external_product_id,source_url,last_synced_at,fingerprint,fact_snapshot,commercial_snapshot)
      select id,'test_only','TEST-ONLY','https://example.invalid/test',now(),repeat('a',64),'{}','{}' from public.tours;`);
    await db.exec(
      await readFile(
        "supabase/migrations/202610180004_catalog_worker.sql",
        "utf8",
      ),
    );
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
async function state(db: PGlite) {
  return (await db.query<{ status: string }>("select status from public.tours"))
    .rows[0].status;
}
async function approve(db: PGlite) {
  await db.exec(
    "update public.external_product_sources set source_status='active',editorial_status='approved',content_rights_status='licensed',publication_readiness='ready',rights_evidence='https://example.invalid/license'",
  );
}
async function publish(db: PGlite) {
  await db.exec("update public.tours set status='published'");
}
async function hidden(db: PGlite) {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      for (const table of [
        "tours",
        "tour_translations",
        "tour_images",
        "tour_prices",
        "tour_availability",
      ])
        assert.equal(
          (await db.query(`select * from public.${table}`)).rows.length,
          0,
          `${role}: ${table}`,
        );
      assert.equal(
        (
          await db.query<{ data: unknown }>(
            "select public.tour_detail('test-external') data",
          )
        ).rows[0].data,
        null,
      );
      assert.equal(
        (
          await db.query<{ data: { total: number } }>(
            "select public.tour_catalog('{}') data",
          )
        ).rows[0].data.total,
        0,
      );
    } finally {
      await db.exec("reset role");
    }
  }
}

test("004: existing sources are depublished; every approval revocation hides RPCs and children; reapproval requires explicit publication", async () => {
  const db = await fixture();
  try {
    assert.equal(await state(db), "draft");
    await hidden(db);
    await assert.rejects(publish(db), /editorial and rights approval/);
    const changes = [
      "source_status='missing'",
      "source_status='discontinued'",
      "editorial_status='pending'",
      "editorial_status='rejected'",
      "content_rights_status='restricted'",
      "publication_readiness='blocked'",
      "content_rights_status='unknown',rights_evidence=null",
      "rights_evidence='https://example.invalid/replacement'",
    ];
    for (const change of changes) {
      await approve(db);
      assert.equal(await state(db), "draft");
      await publish(db);
      assert.equal(await state(db), "published");
      await db.exec("set role anon");
      assert.equal(
        (await db.query("select * from public.tours")).rows.length,
        1,
      );
      await db.exec("reset role");
      await db.exec(`update public.external_product_sources set ${change}`);
      assert.equal(await state(db), "draft", change);
      await hidden(db);
      if (!change.startsWith("rights_evidence="))
        await assert.rejects(publish(db), /editorial and rights approval/);
    }
    assert.equal(
      (await db.query("select * from public.tour_translations")).rows.length,
      2,
    );
    await approve(db);
    assert.equal(await state(db), "draft");
    await publish(db);
    assert.equal(await state(db), "published");
  } finally {
    await db.close();
  }
});

test("004: unlink/reassignment and browser/worker writes are denied; private definers and rollback preserve valid publication", async () => {
  const db = await fixture();
  try {
    await approve(db);
    await publish(db);
    await assert.rejects(
      db.exec("delete from public.external_product_sources"),
      /cannot be detached/,
    );
    await assert.rejects(
      db.exec(
        "update public.external_product_sources set tour_id=gen_random_uuid()",
      ),
      /cannot be reassigned/,
    );
    await assert.rejects(
      db.exec(
        "update public.external_product_sources set rights_evidence=null",
      ),
      /source_license_evidence/,
    );
    assert.equal(await state(db), "published");
    await assert.rejects(
      db.exec(
        "begin;update public.external_product_sources set source_status='missing';select 1/0;commit;",
      ),
    );
    await db.exec("rollback");
    assert.equal(await state(db), "published");
    await db.exec(await readFile("supabase/catalog-worker-role.sql", "utf8"));
    for (const role of ["anon", "authenticated", "asia_catalog_worker"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(
        db.exec(
          "update public.external_product_sources set publication_readiness='ready'",
        ),
      );
      for (const name of [
        "guard_external_publication",
        "revoke_external_publication",
      ]) {
        assert.equal(
          (
            await db.query<{ allowed: boolean }>(
              "select has_function_privilege(current_user,$1,'EXECUTE') allowed",
              [`public.${name}()`],
            )
          ).rows[0].allowed,
          false,
        );
      }
      await db.exec("reset role");
    }
    const functions = (
      await db.query<{ prosecdef: boolean; proconfig: string[] }>(
        "select prosecdef,proconfig from pg_proc where oid in ('public.guard_external_publication()'::regprocedure,'public.revoke_external_publication()'::regprocedure)",
      )
    ).rows;
    for (const f of functions) {
      assert.equal(f.prosecdef, true);
      assert.deepEqual(f.proconfig, ['search_path=""']);
    }
    // Parent deletion remains compatible with the existing ON DELETE CASCADE FK.
    await db.exec("delete from public.tours");
    assert.equal(
      (await db.query("select * from public.external_product_sources")).rows
        .length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("004: attaching a source to a published internal tour revokes publication without deleting editorial content", async () => {
  const db = await fixture(false);
  try {
    await publish(db);
    await db.exec(
      "insert into public.external_product_sources(tour_id,provider,external_product_id,source_url,last_synced_at,fingerprint,fact_snapshot,commercial_snapshot) select id,'test_only','TEST-ATTACH','https://example.invalid/test',now(),repeat('a',64),'{}','{}' from public.tours",
    );
    assert.equal(await state(db), "draft");
    await hidden(db);
  } finally {
    await db.close();
  }
});

test("004: authorized legacy admin RPC cannot bypass a revoked normalized source with absent JSON source metadata", async () => {
  const db = await fixture();
  try {
    const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04";
    await db.query("insert into auth.users values($1)", [admin]);
    await db.query("insert into public.admin_members values($1,'admin')", [
      admin,
    ]);
    const doc = (
      await db.query<{ document: Record<string, unknown> }>(
        "select public.admin_tour_payload(t) document from public.tours t",
      )
    ).rows[0].document;
    doc.status = "published";
    doc.durationMinutes = 60;
    doc.slots = [];
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select public.admin_save_batch($1::jsonb,$2::jsonb)", [
        JSON.stringify([doc]),
        JSON.stringify({ [String(doc.id)]: doc.updatedAt }),
      ]),
      /editorial and rights approval/,
    );
    await db.exec("reset role");
    assert.equal(await state(db), "draft");
    assert.equal(
      (await db.query("select * from public.tour_translations")).rows.length,
      2,
    );
  } finally {
    await db.close();
  }
});
