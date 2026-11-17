import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const name = "admin/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp";
async function setup() {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;grant usage on schema public to anon,authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;insert into auth.users values('${admin}');create schema storage;create table storage.buckets(id text primary key,name text unique,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant all on storage.objects to anon,authenticated;`,
  );
  for (const p of [
    "supabase/migrations/202610100001_tour_inventory.sql",
    "supabase/migrations/202610100002_admin.sql",
  ])
    await db.exec(await readFile(p, "utf8"));
  await db.exec(`insert into admin_members values('${admin}','admin')`);
  return db;
}
test("Storage: all three SQL files, inherited grants, roles, encoded draft references and immutable images", async () => {
  const db = await setup();
  try {
    await db.exec(await readFile("supabase/storage-admin.sql", "utf8"));
    await db.exec(
      "insert into locations(country_slug,slug,kind,name_ru,name_en) values('vietnam','test','destination','TEST','TEST');insert into tours(slug,country_slug,location_id,category_slug) select 'test','vietnam',id,'nature' from locations;",
    );
    const prefixes = [
      "object/public",
      "object/sign",
      "object/authenticated",
      "render/image/public",
    ];
    for (const prefix of prefixes) {
      const url = `https://example.supabase.co/storage/v1/${prefix}/tour-images/admin%2F${name.slice(6)}?token=test#fragment`;
      assert.equal(
        (
          await db.query<{ path: string }>(
            "select tour_image_object_path($1) path",
            [url],
          )
        ).rows[0].path,
        name,
      );
    }
    await db.exec("set role anon");
    await assert.rejects(db.query("select admin_image_is_unused($1)", [name]));
    await db.exec("reset role;set role authenticated");
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select admin_image_is_unused($1) allowed",
          [name],
        )
      ).rows[0].allowed,
      false,
    );
    await assert.rejects(
      db.query("insert into storage.objects(bucket_id,name) values($1,$2)", [
        "tour-images",
        name,
      ]),
    );
    await assert.rejects(db.query("select tour_image_object_path('anything')"));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    await db.query(
      "insert into storage.objects(bucket_id,name) values($1,$2)",
      ["tour-images", name],
    );
    await assert.rejects(
      db.query(
        "insert into storage.objects(bucket_id,name) values('tour-images','admin/unsafe.svg')",
      ),
    );
    assert.equal(
      (
        await db.query(
          "update storage.objects set name='admin/changed.webp' returning id",
        )
      ).rows.length,
      0,
    );
    await db.exec("reset role");
    for (const reference of [
      `https://example.supabase.co/storage/v1/object/public/tour-images/admin%2F${name.slice(6)}?v=1`,
      "https://example.supabase.co/storage/v1/object/public/tour-images/admin/%ZZ.webp",
      `https://example.supabase.co/storage/v1/object/public/tour%2Dimages/${name}`,
      `https://example.supabase.co/storage/v1/object/public/tour-images/admin/../${name}`,
    ]) {
      await db.query(
        "insert into tour_images(tour_id,url,alt_ru,alt_en,position) select id,$1,'','',0 from tours",
        [reference],
      );
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        admin,
      ]);
      assert.equal(
        (
          await db.query<{ allowed: boolean }>(
            "select admin_image_is_unused($1) allowed",
            [name],
          )
        ).rows[0].allowed,
        false,
      );
      assert.equal(
        (await db.query("delete from storage.objects returning id")).rows
          .length,
        0,
      );
      await db.exec("reset role;delete from tour_images");
    }
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    assert.equal(
      (await db.query("delete from storage.objects returning id")).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});
test("Storage: existing private bucket and unknown policies cause complete rollback", async () => {
  for (const conflict of ["bucket", "policy"]) {
    const db = await setup();
    try {
      if (conflict === "bucket")
        await db.exec(
          "insert into storage.buckets values('tour-images','tour-images',false,123,array['image/png'])",
        );
      else
        await db.exec(
          "create policy unknown_policy on storage.objects for insert to authenticated with check(true)",
        );
      await assert.rejects(
        db.exec(await readFile("supabase/storage-admin.sql", "utf8")),
      );
      await db.exec("rollback");
      const buckets = (
        await db.query<{ public: boolean; file_size_limit: number }>(
          "select * from storage.buckets",
        )
      ).rows;
      assert.equal(buckets.length, conflict === "bucket" ? 1 : 0);
      if (conflict === "bucket") {
        assert.equal(buckets[0].public, false);
        assert.equal(Number(buckets[0].file_size_limit), 123);
      }
      assert.equal(
        (
          await db.query(
            "select 1 from pg_proc where proname='admin_image_is_unused'",
          )
        ).rows.length,
        0,
      );
    } finally {
      await db.close();
    }
  }
});
