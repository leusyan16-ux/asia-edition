import "server-only";
import { publicPreviewOnly } from "@/lib/public-preview";
import { headers } from "next/headers";
import { connection } from "next/server";
import { assertLocalPostgres } from "./config";
import { roleDatabase } from "./connection";
import type { Database } from "./postgres-worker";
import { projectionRepository } from "./projection";
import type { TourRepository } from "../tours/model";
import { startSupervisor, attachShutdown } from "./supervisor";
import { projectionTaxonomy } from "./projection";
import { nativeSelected, type CatalogRole } from "./native-config";
import { createApprovedPostgresPool } from "./pg-pool";
const state = globalThis as typeof globalThis & {
  asiaNativePools?: Map<
    CatalogRole,
    ReturnType<typeof createApprovedPostgresPool>
  >;
  asiaPoolShutdown?: boolean;
  asiaSupervisor?: ReturnType<typeof startSupervisor>;
};
export async function postgresFor(
  role: "asia_catalog_reader" | "asia_catalog_editor" | "asia_catalog_worker",
) {
  if (publicPreviewOnly())
    throw new Error("Server functions are disabled on the public preview");
  if (nativeSelected()) {
    await connection(); // Never connect while prerendering a build.
    state.asiaNativePools ??= new Map();
    if (!state.asiaPoolShutdown) {
      state.asiaPoolShutdown = true;
      const close = () => {
        void Promise.all(
          [...state.asiaNativePools!.values()].map((p) => p.close()),
        ).catch(() => console.error("catalog_pool_shutdown_failure"));
      };
      process.once("SIGTERM", close);
      process.once("SIGINT", close);
    }
    let pool = state.asiaNativePools.get(role);
    if (!pool) {
      pool = createApprovedPostgresPool(role);
      state.asiaNativePools.set(role, pool);
    }
    return roleDatabase(pool.database, role);
  }
  assertLocalPostgres((await headers()).get("host") ?? "");
  const engine = await (await import("./embedded")).embeddedDatabase();
  const db = engine as unknown as Database;
  if (process.env.POSTGRES_LOCAL_WORKER === "on" && !state.asiaSupervisor) {
    state.asiaSupervisor = startSupervisor(
      roleDatabase(db, "asia_catalog_worker"),
      () => projectionTaxonomy(roleDatabase(db, "asia_catalog_editor")),
      {
        allowSynthetic: /^(test|qa)-/.test(
          process.env.POSTGRES_LOCAL_PROFILE ?? "",
        ),
        onError: () =>
          console.error(
            "Local catalog worker: packet failed; check private import journal",
          ),
      },
    );
    attachShutdown(state.asiaSupervisor, () => engine.close());
  }
  return roleDatabase(db, role);
}
export function postgresPublicRepository(): TourRepository {
  return {
    list: async (query) =>
      projectionRepository(await postgresFor("asia_catalog_reader")).list(
        query,
      ),
    bySlug: async (slug) =>
      projectionRepository(await postgresFor("asia_catalog_reader")).bySlug(
        slug,
      ),
    taxonomy: async () =>
      projectionRepository(await postgresFor("asia_catalog_reader")).taxonomy(),
  };
}
