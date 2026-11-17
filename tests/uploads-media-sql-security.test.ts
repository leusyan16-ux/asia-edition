import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { emptyTour } from "../src/features/admin/model";

async function fixture(legacyPublication = false) {
  const Constructor = process.env.MEDIA_SQL_TEST_PGLITE_MODULE
    ? (
        (await import(
          pathToFileURL(process.env.MEDIA_SQL_TEST_PGLITE_MODULE).href
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
    if (process.env.MEDIA_SQL_TEST_PG_MAJOR)
      assert.equal(
        Math.floor(version / 10000),
        Number(process.env.MEDIA_SQL_TEST_PG_MAJOR),
      );
    await db.exec(
      "set check_function_bodies=on;create role anon;create role authenticated;grant usage on schema public to anon,authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;",
    );
    for (const file of [
      "202610100001_tour_inventory.sql",
      "202610100002_admin.sql",
      "202610140003_external_import_foundation.sql",
      "202610180004_catalog_worker.sql",
    ])
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    await db.exec(await readFile("supabase/catalog-worker-role.sql", "utf8"));
    await db.exec(
      await readFile(
        "supabase/migrations/202610180005_catalog_projection.sql",
        "utf8",
      ),
    );
    if (legacyPublication) {
      const d = document(),
        job = randomUUID();
      const external = {
        ...d,
        images: [
          {
            url: "/images/admin/" + randomUUID() + ".webp",
            alt: { ru: "ТЕСТ", en: "TEST" },
          },
        ],
        externalProduct: {
          provider: "test_006",
          external_product_id: "TEST-LEGACY",
          source_status: "active",
          editorial_status: "approved",
          content_rights_status: "licensed",
          publication_readiness: "ready",
          rights_evidence: "https://example.invalid/TEST-PROOF",
        },
      };
      await db.query(
        "insert into catalog_ingest.jobs(id,provider,snapshot_at,countries) values($1,'test_006',now(),array['japan'])",
        [job],
      );
      await db.query(
        "insert into catalog_ingest.products(id,provider,external_product_id,country,document,last_job) values($1,'test_006','TEST-LEGACY','japan',$2::jsonb,$3)",
        [d.id, JSON.stringify(external), job],
      );
      await db.query(
        "update catalog_projection.documents set document=jsonb_set(jsonb_set(document,'{verifiedAt}',to_jsonb($2::text)),'{status}','\"published\"'),revision=revision+1 where id=$1",
        [d.id, d.verifiedAt],
      );
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select status from catalog_projection.documents",
          )
        ).rows[0].status,
        "published",
      );
    }
    await db.exec(
      "alter default privileges grant all on tables to anon,authenticated;alter default privileges grant execute on functions to anon,authenticated;",
    );
    await db.exec(
      await readFile(
        "supabase/migrations/202610180006_local_uploads_media.sql",
        "utf8",
      ),
    );
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
async function as(db: PGlite, role: string) {
  await db.exec(`set session authorization ${role}; reset role`);
}
async function owner(db: PGlite) {
  await as(db, "postgres");
}
function document() {
  const id = randomUUID();
  return {
    ...emptyTour(id),
    slug: "test-006-" + id,
    country: "japan",
    location: "kyoto",
    category: "culture",
    title: { ru: "ТЕСТ", en: "TEST" },
    description: { ru: ["ТЕСТ"], en: ["TEST"] },
    durationMinutes: 60,
    operator: { id: randomUUID(), name: "TEST ONLY" },
    verifiedAt: "2026-10-22T00:00:00Z",
    images: [
      {
        url: "https://example.invalid/TEST.webp",
        alt: { ru: "ТЕСТ", en: "TEST" },
      },
    ],
  };
}
async function insertDocument(db: PGlite) {
  const d = document();
  await db.query(
    "insert into catalog_projection.documents(id,document) values($1,$2::jsonb)",
    [d.id, JSON.stringify(d)],
  );
  return d.id;
}
async function asset(db: PGlite) {
  const id = randomUUID(),
    key = id + ".webp";
  await db.query(
    "insert into catalog_projection.media_assets(id,key,bytes,sha256,actor) values($1,$2,1,$3,'TEST ONLY')",
    [id, key, "a".repeat(64)],
  );
  return { id, key, url: "/images/admin/" + key };
}
async function gallery(db: PGlite, id: string, url: string) {
  await db.query(
    "update catalog_projection.documents set document=jsonb_set(document,'{images}',$2::jsonb),revision=revision+1 where id=$1",
    [id, JSON.stringify([{ url, alt: { ru: "ТЕСТ", en: "TEST" } }])],
  );
}
async function publish(db: PGlite, id: string) {
  await db.query(
    "update catalog_projection.documents set document=jsonb_set(document,'{status}','\"published\"'),revision=revision+1 where id=$1",
    [id],
  );
}
async function visible(db: PGlite, key: string) {
  return (
    await db.query<{ visible: boolean }>(
      "select catalog_projection.media_visible($1) visible",
      [key],
    )
  ).rows[0].visible;
}

test("006 SQL: dependencies, RLS, fixed definer paths, inherited grants, targeted claims and private slug lookup", async () => {
  const db = await fixture();
  try {
    const security = (
      await db.query<{
        proname: string;
        prosecdef: boolean;
        proconfig: string[];
      }>(
        "select proname,prosecdef,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='catalog_projection' and proname in ('slug_owners','local_media_key','link_media','retire_media','media_visible','review_media','guard_publication_permission')) or (n.nspname='catalog_ingest' and proname='claim_specific')",
      )
    ).rows;
    assert.equal(security.length, 8);
    for (const f of security) {
      assert.deepEqual(f.proconfig, ['search_path=""']);
      assert.equal(
        f.prosecdef,
        !["claim_specific", "local_media_key"].includes(f.proname),
      );
    }
    const functions = [
      "catalog_ingest.claim_specific(uuid,text)",
      "catalog_projection.slug_owners(text[])",
      "catalog_projection.local_media_key(text)",
      "catalog_projection.link_media()",
      "catalog_projection.retire_media(text)",
      "catalog_projection.media_visible(text)",
      "catalog_projection.review_media(text,text,text)",
      "catalog_projection.guard_publication_permission()",
    ];
    for (const role of ["anon", "authenticated"]) {
      for (const f of functions)
        assert.equal(
          (
            await db.query<{ ok: boolean }>(
              "select has_function_privilege($1,$2,'EXECUTE') ok",
              [role, f],
            )
          ).rows[0].ok,
          false,
        );
      for (const table of [
        "catalog_ingest.uploads",
        "catalog_projection.media_assets",
        "catalog_projection.media_links",
        "catalog_projection.publication_permissions",
      ])
        for (const privilege of [
          "SELECT",
          "INSERT",
          "UPDATE",
          "DELETE",
          "TRUNCATE",
        ])
          assert.equal(
            (
              await db.query<{ ok: boolean }>(
                "select has_table_privilege($1,$2,$3) ok",
                [role, table, privilege],
              )
            ).rows[0].ok,
            false,
          );
    }
    assert.equal(
      (
        await db.query(
          "select 1 from pg_class where oid in ('catalog_ingest.uploads'::regclass,'catalog_projection.media_assets'::regclass,'catalog_projection.media_links'::regclass,'catalog_projection.publication_permissions'::regclass) and relrowsecurity",
        )
      ).rows.length,
      4,
    );
    const id = await insertDocument(db);
    const slug = (
      await db.query<{ slug: string }>(
        "select slug from catalog_projection.documents where id=$1",
        [id],
      )
    ).rows[0].slug;
    const job = randomUUID();
    await db.query(
      "insert into catalog_ingest.jobs(id,provider,snapshot_at,countries,sealed,state) values($1,'test_006',now(),array['japan'],true,'queued')",
      [job],
    );
    await as(db, "asia_catalog_worker");
    for (const args of [
      [job, null],
      [job, ""],
      [job, "   "],
      [job, "x".repeat(101)],
      [null, "TEST"],
    ])
      await assert.rejects(
        db.query("select * from catalog_ingest.claim_specific($1,$2)", args),
        /Invalid worker claim/,
      );
    const lease = (
      await db.query<{ fence: number; owner: string }>(
        "select * from catalog_ingest.claim_specific($1,'TEST-WORKER')",
        [job],
      )
    ).rows[0];
    assert.equal(lease.owner, "TEST-WORKER");
    assert.equal(Number(lease.fence), 1);
    assert.equal(
      (
        await db.query(
          "select * from catalog_ingest.claim_specific($1,'OTHER')",
          [job],
        )
      ).rows.length,
      0,
    );
    const owners = (
      await db.query<{ provider: null; slug: string }>(
        "select * from catalog_projection.slug_owners($1)",
        [[slug]],
      )
    ).rows;
    assert.equal(owners.length, 1);
    assert.equal(owners[0].provider, null);
    await assert.rejects(
      db.query("select * from catalog_projection.documents"),
    );
    await assert.rejects(
      db.query("select catalog_projection.review_media($1,$2,$3)", [
        "x",
        "licensed",
        "https://example.invalid/proof",
      ]),
    );
    await owner(db);
    await db.query(
      "update catalog_ingest.jobs set lease_until=now()-interval '1 second',attempts=max_attempts where id=$1",
      [job],
    );
    await as(db, "asia_catalog_worker");
    assert.equal(
      (
        await db.query(
          "select * from catalog_ingest.claim_specific($1,'TEST')",
          [job],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from catalog_ingest.jobs where id=$1",
          [job],
        )
      ).rows[0].state,
      "failed",
    );
  } finally {
    await db.close();
  }
});

test("006 installation revokes existing imported publication while retaining all editorial content", async () => {
  const db = await fixture(true);
  try {
    const row = (
      await db.query<{
        status: string;
        document: { description: { en: string[] } };
        revision: number;
      }>("select status,document,revision from catalog_projection.documents")
    ).rows[0];
    assert.equal(row.status, "draft");
    assert.deepEqual(row.document.description.en, ["TEST"]);
    assert.equal(Number(row.revision), 3);
    await as(db, "asia_catalog_reader");
    assert.equal(
      (await db.query("select * from catalog_projection.documents")).rows
        .length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("006 media: canonical references, unknown rights private, explicit review, withdrawal and non-destructive retirement", async () => {
  const db = await fixture();
  try {
    const id = await insertDocument(db),
      a = await asset(db);
    await as(db, "asia_catalog_editor");
    await gallery(db, id, a.url);
    assert.equal(await visible(db, a.key), false);
    await assert.rejects(publish(db, id), /confirmed content rights/);
    for (const url of [
      a.url.replace("/images", "/%69mages"),
      a.url + "?preview=true",
      a.url.replace("/images", "%2Fimages"),
      "/admin/api/images/" + a.key,
    ])
      await assert.rejects(gallery(db, id, url), /canonical/);
    await assert.rejects(
      db.query("select catalog_projection.retire_media($1)", [a.key]),
      /Сначала/,
    );
    await assert.rejects(
      db.query("select catalog_projection.review_media($1,$2,$3)", [
        a.key,
        "licensed",
        null,
      ]),
      /evidence/,
    );
    await assert.rejects(
      db.query("select catalog_projection.review_media($1,$2,$3)", [
        a.key,
        "licensed",
        "https://",
      ]),
      /HTTPS/,
    );
    await db.query("select catalog_projection.review_media($1,$2,$3)", [
      a.key,
      "licensed",
      "https://example.invalid/TEST-PROOF",
    ]);
    await publish(db, id);
    await as(db, "asia_catalog_reader");
    assert.equal(await visible(db, a.key), true);
    await assert.rejects(
      db.query("select * from catalog_projection.media_assets"),
    );
    await assert.rejects(
      db.query("select catalog_projection.retire_media($1)", [a.key]),
    );
    await as(db, "asia_catalog_editor");
    await db.query("select catalog_projection.review_media($1,$2,$3)", [
      a.key,
      "restricted",
      null,
    ]);
    assert.equal(await visible(db, a.key), false);
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from catalog_projection.documents where id=$1",
          [id],
        )
      ).rows[0].status,
      "draft",
    );
    await db.query("select catalog_projection.review_media($1,$2,$3)", [
      a.key,
      "licensed",
      "https://example.invalid/TEST-PROOF",
    ]);
    assert.equal(
      await visible(db, a.key),
      false,
      "reapproval must not republish",
    );
    await db.query(
      "update catalog_projection.documents set document=jsonb_set(document,'{images}','[]'),revision=revision+1 where id=$1",
      [id],
    );
    await owner(db);
    const job = randomUUID();
    await db.query(
      "insert into catalog_ingest.jobs(id,provider,snapshot_at,countries) values($1,'test_006',now(),array['japan'])",
      [job],
    );
    await db.query(
      "insert into catalog_ingest.parts(job_id,ordinal,checksum,records) values($1,0,$2,$3::jsonb)",
      [
        job,
        "b".repeat(64),
        JSON.stringify([
          { product: { images: [{ url: a.url.replace("admin", "%61dmin") }] } },
        ]),
      ],
    );
    await as(db, "asia_catalog_editor");
    await assert.rejects(
      db.query("select catalog_projection.retire_media($1)", [a.key]),
      /используется/,
    );
    await owner(db);
    await db.query(
      "update catalog_ingest.parts set records='[{}]' where job_id=$1",
      [job],
    );
    await as(db, "asia_catalog_editor");
    await db.query("select catalog_projection.retire_media($1)", [a.key]);
    await assert.rejects(gallery(db, id, a.url), /missing or retired/);
    assert.equal(
      (await db.query("select id from catalog_projection.media_assets")).rows
        .length,
      1,
      "no physical asset deletion",
    );
    await assert.rejects(
      db.query("delete from catalog_projection.media_assets"),
    );
  } finally {
    await db.close();
  }
});

test("006 publication: explicit permission, exact approved content and monotonic revision prevent replay or forged approval", async () => {
  const db = await fixture();
  try {
    const d = document(),
      job = randomUUID();
    const external = {
      ...d,
      externalProduct: {
        provider: "test_006",
        external_product_id: "TEST",
        fingerprint: "a".repeat(64),
        source_status: "active",
        editorial_status: "approved",
        content_rights_status: "licensed",
        publication_readiness: "ready",
        rights_evidence: "https://example.invalid/TEST-PROOF",
      },
    };
    await db.query(
      "insert into catalog_ingest.jobs(id,provider,snapshot_at,countries) values($1,'test_006',now(),array['japan'])",
      [job],
    );
    await db.query(
      "insert into catalog_ingest.products(id,provider,external_product_id,country,document,last_job) values($1,'test_006','TEST','japan',$2::jsonb,$3)",
      [d.id, JSON.stringify(external), job],
    );
    await db.query(
      "update catalog_projection.documents set document=jsonb_set(document,'{verifiedAt}',to_jsonb($2::text)),revision=revision+1 where id=$1",
      [d.id, d.verifiedAt],
    );
    await as(db, "asia_catalog_editor");
    await assert.rejects(publish(db, d.id), /разрешение/);
    await assert.rejects(
      db.query(
        "insert into catalog_projection.publication_permissions values($1,1,1,'FORGED',now())",
        [d.id],
      ),
    );
    await assert.rejects(
      db.query(
        "update catalog_projection.documents set source_id=null where id=$1",
        [d.id],
      ),
      /immutable/,
    );
    await owner(db);
    const approved = (
      await db.query<{ revision: number }>(
        "select revision from catalog_projection.documents where id=$1",
        [d.id],
      )
    ).rows[0].revision;
    await db.query(
      "insert into catalog_projection.publication_permissions(product_id,approved_revision,source_revision,actor) select id,revision,source_revision,'TEST DBA APPROVAL' from catalog_projection.documents where id=$1",
      [d.id],
    );
    await as(db, "asia_catalog_editor");
    await assert.rejects(
      db.query(
        "update catalog_projection.documents set document=jsonb_set(document,'{title,ru}','\"UNVERSIONED EDIT\"') where id=$1",
        [d.id],
      ),
      /revision must increase/,
    );
    await assert.rejects(
      db.query(
        "update catalog_projection.documents set document=jsonb_set(jsonb_set(document,'{status}','\"published\"'),'{title,ru}','\"UNAPPROVED CHANGE\"'),revision=revision+1 where id=$1",
        [d.id],
      ),
      /approved document revision/,
    );
    await publish(db, d.id);
    await assert.rejects(
      db.query(
        "update catalog_projection.documents set document=jsonb_set(document,'{status}','\"draft\"'),revision=$2 where id=$1",
        [d.id, approved],
      ),
      /cannot decrease/,
    );
    await db.query(
      "update catalog_projection.documents set document=jsonb_set(document,'{status}','\"draft\"'),revision=revision+1 where id=$1",
      [d.id],
    );
    await assert.rejects(publish(db, d.id), /разрешение/);
    await as(db, "asia_catalog_reader");
    assert.equal(
      (await db.query("select * from catalog_projection.documents")).rows
        .length,
      0,
    );
  } finally {
    await db.close();
  }
});
