import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("future external schema: migration compatibility, inherited privilege revocation and private RLS", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;grant usage on schema public to anon,authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;",
    );
    for (const file of [
      "202610100001_tour_inventory.sql",
      "202610100002_admin.sql",
      "202610140003_external_import_foundation.sql",
    ])
      await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
    const uid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.exec(
      `insert into auth.users values('${uid}');insert into admin_members values('${uid}','admin');insert into catalog_import_batches(batch_id,digest,actor_id,format,status,created_count,updated_count,skipped_count,failed_count,results) values('TEST ONLY','test','${uid}','json','committed',0,0,0,0,'[]');`,
    );
    await db.exec("set role anon");
    await assert.rejects(db.query("select * from external_product_sources"));
    await assert.rejects(db.query("select * from catalog_import_batches"));
    await db.exec("reset role;set role authenticated");
    assert.equal(
      (await db.query("select * from catalog_import_batches")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select has_table_privilege('authenticated','external_product_sources','TRUNCATE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    await assert.rejects(db.query("delete from catalog_import_batches"));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      uid,
    ]);
    assert.equal(
      (await db.query("select * from catalog_import_batches")).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});
