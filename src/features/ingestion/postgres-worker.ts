/** Server/CLI only. No client, credentials, network connection or automatic activation. */
import { randomUUID } from "node:crypto";
import {
  digest,
  prepareImport,
  type ExternalImportRecord,
} from "../admin/import-engine";
import {
  adminTourSchema,
  type AdminTaxonomy,
  type AdminTour,
} from "../admin/model";
import { feedScopeSchema } from "../admin/catalog-job-model";

export interface SQL {
  query<T>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Database extends SQL {
  transaction<T>(run: (tx: SQL) => Promise<T>): Promise<T>;
}
type Job = {
  id: string;
  provider: string;
  countries: string[];
  snapshot_at: Date | string;
  complete: boolean;
  cursor: number;
  parts: number;
  fence: number;
  owner: string;
  attempts: number;
  max_attempts: number;
};
const stamp = (value: Date | string) => new Date(value).toISOString();
const encoded = (value: unknown) => JSON.stringify(value);

/** Input is a normalized async stream, not a whole JSON array. An official transport
 * must yield ALL pages before this function seals a complete snapshot. */
export async function stageStream(
  db: Database,
  input: AsyncIterable<ExternalImportRecord>,
  manifest: unknown,
  taxonomy: AdminTaxonomy,
  allowSynthetic = false,
  batchSize = 250,
  holdForConfirmation = false,
  onPrepared?: (tx: SQL, id: string) => Promise<void>,
) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 250)
    throw new Error("Batch size must be 1..250");
  const scope = feedScopeSchema.parse(manifest);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(72619483)");
    await tx.query(
      "update catalog_ingest.jobs set state='failed',last_error='Staging lease expired; restage source' where state='staging' and lease_until<clock_timestamp()",
    );
    const conflict = await tx.query(
      "select id from catalog_ingest.jobs where provider=$1 and countries && $2::text[] and state not in ('completed','cancelled','failed')",
      [scope.provider, scope.countries],
    );
    if (conflict.rows.length) throw new Error("Overlapping active snapshot");
    const newer = await tx.query(
      "select id from catalog_ingest.jobs where provider=$1 and countries && $2::text[] and snapshot_at>$3::timestamptz",
      [scope.provider, scope.countries, scope.snapshot_at],
    );
    if (newer.rows.length) throw new Error("Stale snapshot");
    await tx.query(
      "insert into catalog_ingest.jobs(id,provider,countries,snapshot_at,complete,lease_until) values($1,$2,$3,$4,$5,clock_timestamp()+interval '5 minutes')",
      [id, scope.provider, scope.countries, scope.snapshot_at, scope.complete],
    );
  });
  let packet: ExternalImportRecord[] = [],
    bytes = 2,
    ordinal = 0;
  const flush = async () => {
    if (!packet.length) return;
    const rows = prepareImport(
      encoded(packet),
      "json",
      taxonomy,
      [],
      allowSynthetic,
    );
    if (rows.some((r) => r.action === "error"))
      throw new Error(rows.flatMap((r) => r.errors).join("; "));
    await db.transaction(async (tx) => {
      const alive = await tx.query(
        "update catalog_ingest.jobs set lease_until=clock_timestamp()+interval '5 minutes' where id=$1 and state='staging' and lease_until>clock_timestamp() returning id",
        [id],
      );
      if (!alive.rows.length) throw new Error("Staging lease lost");
      await tx.query(
        "insert into catalog_ingest.parts(job_id,ordinal,checksum,records) values($1,$2,$3,$4::jsonb)",
        [id, ordinal++, digest(packet), encoded(packet)],
      );
    });
    packet = [];
    bytes = 2;
  };
  try {
    for await (const item of input) {
      if (
        item.provider !== scope.provider ||
        stamp(item.last_synced_at) !== stamp(scope.snapshot_at) ||
        !scope.countries.includes(
          item.product.country as (typeof scope.countries)[number],
        )
      )
        throw new Error("Record outside snapshot scope");
      const size = Buffer.byteLength(encoded(item)) + 1;
      if (size > 4 * 1024 * 1024) throw new Error("Record exceeds 4 MiB");
      if (packet.length === batchSize || bytes + size > 4 * 1024 * 1024)
        await flush();
      packet.push(item);
      bytes += size;
      if (ordinal >= 4000) throw new Error("Snapshot limit exceeded");
    }
    await flush();
    if (!ordinal) throw new Error("Empty snapshot cannot be reconciled");
    // Duplicate identities across parts are detected in SQL without a JS-wide Set.
    const duplicates = await db.query(
      "select r->>'external_product_id' from catalog_ingest.parts p cross join lateral jsonb_array_elements(p.records) r where job_id=$1 group by r->>'external_product_id' having count(*)>1 limit 1",
      [id],
    );
    if (duplicates.rows.length)
      throw new Error("Duplicate source identity across packets");
    await db.transaction(async (tx) => {
      const sealed = await tx.query(
        "update catalog_ingest.jobs set parts=$2,sealed=true,state='queued',available_at=case when $3 then 'infinity'::timestamptz else clock_timestamp() end where id=$1 and state='staging' and lease_until>clock_timestamp() returning id",
        [id, ordinal, holdForConfirmation],
      );
      if (!sealed.rows.length) throw new Error("Staging lease lost");
      await onPrepared?.(tx, id);
    });
    return id;
  } catch (error) {
    await db.query(
      "update catalog_ingest.jobs set state='failed',last_error=$2 where id=$1",
      [id, String(error).slice(0, 2000)],
    );
    throw error;
  }
}

export async function claim(db: SQL, owner: string): Promise<Job | undefined> {
  // Exhausted crashed leases become observable terminal failures.
  await db.query(
    "update catalog_ingest.jobs set state='failed',last_error='Lease retry budget exhausted' where state='running' and lease_until<clock_timestamp() and attempts>=max_attempts",
  );
  return (
    await db.query<Job>("select * from catalog_ingest.claim($1,60)", [owner])
  ).rows[0];
}

/** One atomic packet. Row lock + fencing prevents expired owners from committing.
 * Retry this function with the same cursor: committed packets become no-ops. */
export async function processPacket(
  db: Database,
  lease: Job,
  expectedCursor: number,
  taxonomy: AdminTaxonomy,
  allowSynthetic = false,
) {
  return db.transaction(async (tx) => {
    const job = (
      await tx.query<Job>(
        "select * from catalog_ingest.jobs where id=$1 and owner=$2 and fence=$3 and ((state='running' and lease_until>clock_timestamp()) or state='completed') for update",
        [lease.id, lease.owner, lease.fence],
      )
    ).rows[0];
    if (!job) throw new Error("Lost lease");
    if (expectedCursor < job.cursor) return false;
    if (expectedCursor !== job.cursor) throw new Error("Checkpoint conflict");
    const part = (
      await tx.query<{ records: ExternalImportRecord[]; checksum: string }>(
        "select records,checksum from catalog_ingest.parts where job_id=$1 and ordinal=$2",
        [job.id, job.cursor],
      )
    ).rows[0];
    if (!part || digest(part.records) !== part.checksum)
      throw new Error("Packet checksum mismatch");
    const existing = await tx.query<{ document: AdminTour }>(
      "select document from catalog_ingest.products where provider=$1 and external_product_id=any($2::text[]) for update",
      [job.provider, part.records.map((r) => r.external_product_id)],
    );
    const rows = prepareImport(
      encoded(part.records),
      "json",
      taxonomy,
      existing.rows.map((r) => adminTourSchema.parse(r.document)),
      allowSynthetic,
    );
    if (rows.some((r) => r.action === "error"))
      throw new Error(rows.flatMap((r) => r.errors).join("; "));
    for (const row of rows) {
      const d = row.tour;
      if (!d?.externalProduct) throw new Error("Missing normalized document");
      // Even unchanged imports cannot carry publication into the ingestion workspace.
      d.status = "draft";
      d.verifiedAt = null;
      d.externalProduct.publication_readiness = "blocked";
      await tx.query(
        "insert into catalog_ingest.products(id,provider,external_product_id,country,document,last_job) values($1,$2,$3,$4,$5::jsonb,$6) on conflict(provider,external_product_id) do update set document=excluded.document,country=excluded.country,last_job=excluded.last_job,revision=catalog_ingest.products.revision+1",
        [
          d.id,
          job.provider,
          d.externalProduct.external_product_id,
          d.externalProduct.facts.country,
          encoded(d),
          job.id,
        ],
      );
      await tx.query(
        "insert into catalog_ingest.mappings(provider,kind,external_id,internal_id,product_id) values($1,'product',$2,$3::text,$3::text::uuid) on conflict(provider,kind,parent_external_id,external_id) do update set internal_id=excluded.internal_id,product_id=excluded.product_id",
        [job.provider, d.externalProduct.external_product_id, d.id],
      );
      for (const p of d.externalProduct.commercial.packages) {
        const packageRow = (
          await tx.query<{ id: string }>(
            "insert into catalog_ingest.packages(product_id,external_package_id,snapshot) values($1,$2,$3::jsonb) on conflict(product_id,external_package_id) do update set snapshot=excluded.snapshot returning id",
            [d.id, p.external_package_id, encoded(p)],
          )
        ).rows[0];
        await tx.query(
          "insert into catalog_ingest.mappings(provider,kind,parent_external_id,external_id,internal_id,package_id) values($1,'package',$2,$3,$4::text,$4::text::uuid) on conflict do nothing",
          [
            job.provider,
            d.externalProduct.external_product_id,
            p.external_package_id,
            packageRow.id,
          ],
        );
      }
    }
    const final = job.cursor + 1 === job.parts;
    if (final && job.complete)
      await tx.query(
        "update catalog_ingest.products set document=jsonb_set(jsonb_set(jsonb_set(document,'{externalProduct,source_status}','\"missing\"'),'{externalProduct,publication_readiness}','\"blocked\"'),'{verifiedAt}','null'),revision=revision+1 where provider=$1 and country=any($2::text[]) and last_job<>$3 and document->'externalProduct'->>'source_status'<>'discontinued'",
        [job.provider, job.countries, job.id],
      );
    await tx.query(
      "insert into catalog_ingest.events(job_id,cursor,event,details) values($1,$2,'packet_committed',$3::jsonb)",
      [
        job.id,
        job.cursor,
        encoded({
          created: rows.filter((r) => r.action === "create").length,
          updated: rows.filter((r) => r.action === "update").length,
          skipped: rows.filter((r) => r.action === "skip").length,
        }),
      ],
    );
    await tx.query(
      "update catalog_ingest.jobs set cursor=cursor+1,state=$2,attempts=0,lease_until=clock_timestamp()+interval '60 seconds',finished_at=case when $2='completed' then clock_timestamp() else null end where id=$1",
      [job.id, final ? "completed" : "running"],
    );
    return true;
  });
}

export async function retryLater(db: SQL, lease: Job, error: unknown) {
  await db.query(
    "with changed as (update catalog_ingest.jobs set state=case when attempts>=max_attempts then 'failed' else 'retry' end,available_at=clock_timestamp()+make_interval(secs=>least(3600,power(2,attempts)::int)),last_error=$4,owner=null,lease_until=null where id=$1 and owner=$2 and fence=$3 and state='running' and lease_until>clock_timestamp() returning id,cursor) insert into catalog_ingest.events(job_id,cursor,event,details) select id,cursor,'packet_failed',jsonb_build_object('message',$4::text) from changed",
    [lease.id, lease.owner, lease.fence, String(error).slice(0, 2000)],
  );
}
