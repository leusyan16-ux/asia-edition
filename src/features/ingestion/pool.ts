import { transactionalDatabase, type Pool } from "./connection";
export interface ManagedPool extends Pool {
  end(): Promise<void>;
}
export type PoolSettings = {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  allowExitOnIdle: boolean;
};
/** Inject the driver's factory later; never reads an URL or opens a connection.
 * Separate factories/logins for reader, editor and worker are required. */
export function createServerPool(
  factory: (settings: PoolSettings) => ManagedPool,
  max = 4,
) {
  if (!Number.isInteger(max) || max < 1 || max > 20)
    throw new Error("Pool max must be 1..20");
  const pool = factory({
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    allowExitOnIdle: true,
  });
  let closed = false;
  return {
    database: transactionalDatabase(pool),
    async close() {
      if (!closed) {
        closed = true;
        await pool.end();
      }
    },
  };
}
