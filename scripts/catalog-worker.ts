import { createApprovedPostgresPool } from "../src/features/ingestion/pg-pool";
import { roleDatabase } from "../src/features/ingestion/connection";
import {
  startSupervisor,
  attachShutdown,
} from "../src/features/ingestion/supervisor";
import { projectionTaxonomy } from "../src/features/ingestion/projection";
// No .env auto-loading, migrations or synthetic inventory. Explicit operator action only.
async function main() {
  const worker = createApprovedPostgresPool("asia_catalog_worker"),
    editor = createApprovedPostgresPool("asia_catalog_editor");
  const supervisor = startSupervisor(
    roleDatabase(worker.database, "asia_catalog_worker"),
    () =>
      projectionTaxonomy(roleDatabase(editor.database, "asia_catalog_editor")),
    {
      onError: () =>
        console.error(
          "catalog_worker_packet_failed; inspect private SQL journal",
        ),
      allowSynthetic: false,
    },
  );
  attachShutdown(supervisor, async () => {
    await Promise.all([worker.close(), editor.close()]);
  });
  await supervisor.finished;
}
void main().catch(() => {
  console.error(
    "catalog_worker_start_failed; verify approved server configuration",
  );
  process.exitCode = 1;
});
