import type { SQL } from "./postgres-worker";
import { adminTourSchema } from "../admin/model";

/** Private read boundary for a future authenticated admin adapter. Caller must
 * authorize BEFORE invoking; never expose the worker connection to a browser. */
export async function readDraftPage(
  db: SQL,
  after: string | null = null,
  limit = 25,
  country: string | null = null,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid page limit");
  const rows = await db.query<{ id: string; document: unknown }>(
    "select id,document from catalog_ingest.products where ($1::uuid is null or id>$1::uuid) and ($3::text is null or country=$3) order by id limit $2",
    [after, limit + 1, country],
  );
  return {
    items: rows.rows
      .slice(0, limit)
      .map((r) => adminTourSchema.parse(r.document)),
    next: rows.rows.length > limit ? rows.rows[limit - 1].id : null,
  };
}
