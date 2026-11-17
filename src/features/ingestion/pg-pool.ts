import { Pool as NativePool } from "pg";
import { createServerPool, type ManagedPool } from "./pool";
import type { SQL } from "./postgres-worker";
import { nativeSettings, type CatalogRole } from "./native-config";
export function createApprovedPostgresPool(role: CatalogRole) {
  const settings = nativeSettings(role);
  return createServerPool((poolSettings) => {
    const pool = new NativePool({
      ...poolSettings,
      connectionString: settings.connectionString,
      ssl: settings.ssl,
      statement_timeout: 45000,
      idle_in_transaction_session_timeout: 60000,
    });
    pool.on("error", () => console.error("catalog_pool_failure"));
    return {
      query: adaptQuery(pool),
      async connect() {
        const client = await pool.connect();
        return { query: adaptQuery(client), release: () => client.release() };
      },
      end: () => pool.end(),
    };
  }, settings.max);
}
function adaptQuery(client: {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}): SQL["query"] {
  return async <T>(sql: string, params?: unknown[]) => ({
    rows: (await client.query(sql, params)).rows as T[],
  });
}
/** Prepared native pool. Lazy construction, no env reads; network access is still
 * restricted to loopback. Current Next adapter uses embedded PostgreSQL instead. */
export function createLoopbackPostgresPool(connectionString: string, max = 4) {
  const url = new URL(connectionString);
  if (url.search || url.hash)
    throw new Error("PostgreSQL URL query overrides are disabled");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error(
      "Only an explicitly configured loopback PostgreSQL server is allowed",
    );
  return createServerPool((settings) => {
    const pool = new NativePool({
      ...settings,
      connectionString,
      statement_timeout: 45000,
      idle_in_transaction_session_timeout: 60000,
    });
    pool.on("error", () =>
      console.error("PostgreSQL pool error; inspect server monitoring"),
    );
    const managed: ManagedPool = {
      query: adaptQuery(pool),
      async connect() {
        const client = await pool.connect();
        return { query: adaptQuery(client), release: () => client.release() };
      },
      end: () => pool.end(),
    };
    return managed;
  }, max);
}
