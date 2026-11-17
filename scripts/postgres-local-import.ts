/** Explicit localhost development CLI. Stop Next first: one embedded DB owner. */
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  embeddedDatabase,
  roleDatabase,
} from "../src/features/ingestion/embedded";
import {
  stageStream,
  type Database,
} from "../src/features/ingestion/postgres-worker";
import { runOneJob } from "../src/features/ingestion/runner";
import { readNDJSON } from "../src/features/ingestion/stream";
import {
  projectionTaxonomy,
  newWorkerOwner,
} from "../src/features/ingestion/projection";
async function main() {
  const [profile, file, manifest] = process.argv.slice(2);
  if (!profile || !file || !manifest)
    throw new Error(
      "Usage: postgres-local-import.ts <profile> <normalized.ndjson> <manifest.json>",
    );
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";
  process.env.ADMIN_MODE = "local";
  process.env.TOUR_DATA_SOURCE = "postgres";
  process.env.POSTGRES_LOCAL_PROFILE = profile;
  const db = await embeddedDatabase();
  try {
    const worker = roleDatabase(
      db as unknown as Database,
      "asia_catalog_worker",
    );
    const taxonomy = await projectionTaxonomy(
      roleDatabase(db as unknown as Database, "asia_catalog_editor"),
    );
    const synthetic = /^(test|qa)-/.test(profile);
    const id = await stageStream(
      worker,
      readNDJSON(createReadStream(file, { highWaterMark: 65536 })),
      JSON.parse(await readFile(manifest, "utf8")),
      taxonomy,
      synthetic,
      50,
    );
    await runOneJob(worker, newWorkerOwner(), taxonomy, undefined, synthetic);
    console.log(
      JSON.stringify({
        id,
        profile,
        status: "draft-only",
        path: ".admin-postgres/" + profile,
      }),
    );
  } finally {
    await db.close();
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Import failed");
  process.exitCode = 1;
});
