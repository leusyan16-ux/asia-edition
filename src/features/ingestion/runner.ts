import {
  claim,
  processPacket,
  retryLater,
  type Database,
} from "./postgres-worker";
import type { AdminTaxonomy } from "../admin/model";

/** Supervisor calls again after idle/backoff. Abort only between atomic packets.
 * Deploy separately from Next request handlers, with a server-only DB connection. */
export async function runOneJob(
  db: Database,
  owner: string,
  taxonomy: AdminTaxonomy,
  signal?: AbortSignal,
  allowSynthetic = false,
) {
  const lease = await claim(db, owner);
  if (!lease) return false;
  try {
    for (let cursor = lease.cursor; cursor < lease.parts; cursor++) {
      if (signal?.aborted)
        throw new Error("Worker stopping; resume from checkpoint");
      await processPacket(db, lease, cursor, taxonomy, allowSynthetic);
    }
  } catch (error) {
    await retryLater(db, lease, error);
    throw error;
  }
  return true;
}
