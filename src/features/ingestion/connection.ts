import type { Database, SQL } from "./postgres-worker";

/** Structural pg-compatible pool interface: no driver, credentials or connection
 * is created here. Inject a dedicated server-only pool after deployment approval. */
export interface PoolClient extends SQL {
  release(): void;
}
export interface Pool extends SQL {
  connect(): Promise<PoolClient>;
}
export function roleDatabase(
  db: Database,
  role: "asia_catalog_reader" | "asia_catalog_editor" | "asia_catalog_worker",
): Database {
  const transaction = async <T>(run: (tx: SQL) => Promise<T>) =>
    db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      return run(tx);
    });
  return {
    transaction,
    query: (sql, params) => transaction((tx) => tx.query(sql, params)),
  };
}
export function transactionalDatabase(pool: Pool): Database {
  return {
    query: (sql, parameters) => pool.query(sql, parameters),
    async transaction(run) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Bound lock waits and packet execution; a failed packet retains checkpoint.
        await client.query("SET LOCAL lock_timeout='5s'");
        await client.query("SET LOCAL statement_timeout='45s'");
        const result = await run(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
