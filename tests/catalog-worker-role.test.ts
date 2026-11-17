import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  stageStream,
  claim,
  processPacket,
  type Database,
} from "../src/features/ingestion/postgres-worker";
import { countries } from "../src/lib/catalog";
import { localCategories } from "../src/features/admin/local-taxonomy";

test("worker provisioning: PG17 syntax, six RLS policies, least boundary, real packet and 005 definer projection", async (t) => {
  const Constructor = process.env.WORKER_ROLE_TEST_PGLITE_MODULE
    ? (
        (await import(
          pathToFileURL(process.env.WORKER_ROLE_TEST_PGLITE_MODULE).href
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
    if (process.env.WORKER_ROLE_TEST_PG_MAJOR)
      assert.equal(
        Math.floor(version / 10000),
        Number(process.env.WORKER_ROLE_TEST_PG_MAJOR),
      );
    t.diagnostic(
      `Local PostgreSQL server_version_num=${version}; no network connection`,
    );
    await db.exec(
      "set check_function_bodies=on;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;",
    );
    for (const file of [
      "202610100001_tour_inventory.sql",
      "202610100002_admin.sql",
      "202610140003_external_import_foundation.sql",
      "202610180004_catalog_worker.sql",
    ])
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    await db.exec(await readFile("supabase/catalog-worker-role.sql", "utf8"));
    const role = (
      await db.query<Record<string, boolean>>(
        "select rolcanlogin,rolinherit,rolbypassrls,rolsuper,rolcreatedb,rolcreaterole,rolreplication from pg_roles where rolname='asia_catalog_worker'",
      )
    ).rows[0];
    for (const [name, value] of Object.entries(role))
      assert.equal(value, false, name);
    assert.equal(
      (
        await db.query(
          "select 1 from pg_auth_members where roleid='asia_catalog_worker'::regrole or member='asia_catalog_worker'::regrole",
        )
      ).rows.length,
      0,
    );
    const tables = [
      "jobs",
      "parts",
      "products",
      "packages",
      "mappings",
      "events",
    ];
    const policies = (
      await db.query<{
        tablename: string;
        roles: string[];
        cmd: string;
        qual: string;
        with_check: string;
      }>(
        "select tablename,roles,cmd,qual,with_check from pg_policies where schemaname='catalog_ingest' order by tablename",
      )
    ).rows;
    assert.equal(policies.length, 6);
    for (const p of policies) {
      assert.deepEqual(p.roles, ["asia_catalog_worker"]);
      assert.equal(p.cmd, "ALL");
      assert.equal(p.qual, "true");
      assert.ok(
        p.tablename === "products"
          ? p.with_check.includes("'draft'")
          : p.with_check === "true",
      );
    }
    for (const table of tables) {
      const flags = (
        await db.query<{ relrowsecurity: boolean }>(
          "select relrowsecurity from pg_class where oid=$1::regclass",
          [`catalog_ingest.${table}`],
        )
      ).rows[0];
      assert.equal(flags.relrowsecurity, true);
      for (const privilege of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ]) {
        const allowed = (
          await db.query<{ allowed: boolean }>(
            "select has_table_privilege('asia_catalog_worker',$1,$2) allowed",
            [`catalog_ingest.${table}`, privilege],
          )
        ).rows[0].allowed;
        assert.equal(
          allowed,
          ["SELECT", "INSERT"].includes(privilege) ||
            (privilege === "UPDATE" && !["parts", "events"].includes(table)),
          `${table}: ${privilege}`,
        );
      }
    }
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select has_sequence_privilege('asia_catalog_worker','catalog_ingest.events_id_seq','UPDATE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    for (const privilege of ["USAGE", "SELECT"]) {
      assert.equal(
        (
          await db.query<{ allowed: boolean }>(
            "select has_sequence_privilege('asia_catalog_worker','catalog_ingest.events_id_seq',$1) allowed",
            [privilege],
          )
        ).rows[0].allowed,
        privilege === "USAGE",
      );
    }
    for (const role of ["anon", "authenticated"]) {
      assert.equal(
        (
          await db.query<{ allowed: boolean }>(
            "select has_schema_privilege($1,'catalog_ingest','USAGE') allowed",
            [role],
          )
        ).rows[0].allowed,
        false,
      );
      assert.equal(
        (
          await db.query<{ allowed: boolean }>(
            "select has_function_privilege($1,'catalog_ingest.claim(text,integer)','EXECUTE') allowed",
            [role],
          )
        ).rows[0].allowed,
        false,
      );
    }
    const claimDefinition = (
      await db.query<{ prosecdef: boolean; proconfig: string[] }>(
        "select prosecdef,proconfig from pg_proc where oid='catalog_ingest.claim(text,integer)'::regprocedure",
      )
    ).rows[0];
    assert.equal(claimDefinition.prosecdef, false);
    assert.deepEqual(claimDefinition.proconfig, ['search_path=""']);
    // Install 005 only in this fresh in-memory DB; its source trigger must work
    // without granting the worker direct projection or editorial privileges.
    await db.exec(
      await readFile(
        "supabase/migrations/202610180005_catalog_projection.sql",
        "utf8",
      ),
    );
    // A superuser session retains SET ROLE powers after SET ROLE. Switch the
    // session identity too, so escalation checks represent a restricted login.
    await db.exec("set session authorization asia_catalog_worker");
    for (const sql of [
      "select * from public.admin_members",
      "select * from public.admin_tour_documents",
      "select * from public.admin_audit_events",
      "select * from auth.users",
      "select * from catalog_projection.documents",
      "update public.tours set status='published'",
      "select public.admin_save_batch('[]')",
      "set role asia_catalog_editor",
    ])
      await assert.rejects(db.exec(sql), sql);
    for (const table of tables)
      await assert.rejects(db.exec(`delete from catalog_ingest.${table}`));
    await assert.rejects(
      db.exec("update catalog_ingest.parts set checksum=repeat('0',64)"),
    );
    await assert.rejects(
      db.exec("update catalog_ingest.events set event='tampered'"),
    );
    await assert.rejects(db.exec("truncate catalog_ingest.jobs"));
    await assert.rejects(
      db.exec("select setval('catalog_ingest.events_id_seq',100)"),
    );
    await assert.rejects(
      db.exec("create table catalog_ingest.worker_must_not_create(id int)"),
    );
    await db.exec("set row_security=off");
    await assert.rejects(
      db.exec("select * from catalog_ingest.products"),
      /row-level security/,
    );
    await db.exec("set row_security=on");
    await assert.rejects(
      db.exec("select * from catalog_ingest.claim('test',1)"),
      /Invalid lease/,
    );
    assert.equal(
      (await db.query("select * from catalog_ingest.claim('test',60)")).rows
        .length,
      0,
    );
    const taxonomy = {
      locations: countries.flatMap((c) =>
        c.destinations.map((d) => ({
          slug: d.slug,
          country: c.slug,
          name: d.name,
          kind: "destination" as const,
          parent: null,
        })),
      ),
      categories: localCategories,
      operators: [],
    };
    const at = "2026-10-22T00:00:00Z";
    async function* records() {
      yield {
        provider: "test_worker_role",
        external_product_id: "TEST-ONLY",
        source_url: "https://example.invalid/test",
        last_synced_at: at,
        import_status: "pending" as const,
        test_data: true,
        packages: [
          {
            external_package_id: "TEST-PACKAGE",
            title: { ru: "ТЕСТ", en: "TEST" },
            prices: [],
          },
        ],
        product: {
          slug: "test-worker-role",
          country: "thailand",
          location: "chiang-mai",
          category: "culture",
          title: { ru: "ТЕСТ", en: "TEST" },
        },
      };
    }
    const store = db as unknown as Database;
    const job = await stageStream(
      store,
      records(),
      {
        provider: "test_worker_role",
        countries: ["thailand"],
        snapshot_at: at,
        complete: false,
      },
      taxonomy,
      true,
    );
    const lease = (await claim(store, "test-worker-role"))!;
    assert.equal(lease.id, job);
    await processPacket(store, lease, 0, taxonomy, true);
    assert.equal(await processPacket(store, lease, 0, taxonomy, true), false);
    assert.equal(
      (await db.query("select * from catalog_ingest.events")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from catalog_ingest.packages")).rows.length,
      1,
    );
    await assert.rejects(
      db.exec(
        "update catalog_ingest.products set document=jsonb_set(document,'{status}','\"published\"')",
      ),
    );
    await db.exec("set session authorization postgres; reset role");
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from catalog_projection.documents",
        )
      ).rows[0].status,
      "draft",
    );
    await db.exec("set role asia_catalog_reader");
    assert.equal(
      (await db.query("select * from catalog_projection.documents")).rows
        .length,
      0,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
