import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdir } from "node:fs/promises";
import { postgresDirectory } from "./config";
export { roleDatabase } from "./connection";
export const inventoryMigrations = [
  "202610100001_tour_inventory.sql",
  "202610100002_admin.sql",
  "202610140003_external_import_foundation.sql",
  "202610180004_catalog_worker.sql",
];
/** Only embedded PostgreSQL: this module contains no network connector. */
export async function initializeEmbedded(db: PGlite) {
  const exists = await db.query<{ schema: string | null }>(
    "select to_regnamespace('catalog_projection')::text schema",
  );
  if (exists.rows[0].schema) {
    await upgradeLocalUploads(db);
    return;
  }
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;",
  );
  for (const file of inventoryMigrations)
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  await db.exec(await readFile("supabase/catalog-worker-role.sql", "utf8"));
  await db.exec(
    await readFile(
      "supabase/migrations/202610180005_catalog_projection.sql",
      "utf8",
    ),
  );
  await upgradeLocalUploads(db);
}
async function upgradeLocalUploads(db: PGlite) {
  const present = await db.query<{ name: string | null }>(
    "select to_regclass('catalog_ingest.uploads')::text name",
  );
  if (!present.rows[0].name)
    await db.exec(
      await readFile(
        "supabase/migrations/202610180006_local_uploads_media.sql",
        "utf8",
      ),
    );
  const launch = await db.query<{ name: string | null }>(
    "select to_regclass('catalog_projection.inquiries')::text name",
  );
  if (!launch.rows[0].name)
    await db.exec(
      await readFile(
        "supabase/migrations/202610220007_launch_workflows.sql",
        "utf8",
      ),
    );
}
const registry = globalThis as typeof globalThis & {
  asiaEmbedded?: Map<string, Promise<PGlite>>;
};
export function embeddedDatabase() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.ADMIN_MODE !== "local" ||
    process.env.TOUR_DATA_SOURCE !== "postgres"
  )
    throw new Error("Embedded PostgreSQL disabled");
  const directory = postgresDirectory();
  registry.asiaEmbedded ??= new Map();
  let ready = registry.asiaEmbedded.get(directory);
  if (!ready) {
    ready = (async () => {
      await mkdir(directory, { recursive: true });
      const db = new PGlite(directory);
      await db.waitReady;
      await initializeEmbedded(db);
      return db;
    })();
    registry.asiaEmbedded.set(directory, ready);
    ready.catch(() => registry.asiaEmbedded?.delete(directory));
  }
  return ready;
}
