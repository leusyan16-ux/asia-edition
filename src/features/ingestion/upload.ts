import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  parseInput,
  prepareImport,
  digest,
  type ImportFormat,
  type ExternalImportRecord,
} from "../admin/import-engine";
import {
  adminTourSchema,
  type AdminTour,
  type AdminTaxonomy,
} from "../admin/model";
import { feedScopeSchema } from "../admin/catalog-job-model";
import {
  stageStream,
  processPacket,
  retryLater,
  type Database,
} from "./postgres-worker";
export const UPLOAD_LIMITS = { maxBytes: 8 * 1024 * 1024, maxRows: 20000 };
type Preview = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { row: number; message: string }[];
  rows: { row: number; title: string; action: string }[];
};
type UploadJob = {
  id: string;
  state: string;
  cursor: number;
  parts: number;
  provider: string;
  sealed: boolean;
  last_error: string | null;
  attempts: number;
  available_at: unknown;
};
export async function uploadJob(db: Database, id: string) {
  z.uuid().parse(id);
  const job = (
    await db.query<UploadJob>(
      "select id,provider,state,cursor,parts,sealed,last_error,attempts,available_at from catalog_ingest.jobs where id=$1",
      [id],
    )
  ).rows[0];
  if (!job) throw new Error("Задание не найдено");
  const counts = (
    await db.query<{ created: number; updated: number; skipped: number }>(
      "select coalesce(sum((details->>'created')::int),0)::int created,coalesce(sum((details->>'updated')::int),0)::int updated,coalesce(sum((details->>'skipped')::int),0)::int skipped from catalog_ingest.events where job_id=$1 and event='packet_committed'",
      [id],
    )
  ).rows[0];
  return { ...job, ...counts };
}
export async function prepareUpload(
  db: Database,
  content: string,
  format: ImportFormat,
  filename: string,
  taxonomy: AdminTaxonomy,
  actor: string,
  allowTest = false,
) {
  if (Buffer.byteLength(content) > UPLOAD_LIMITS.maxBytes)
    throw new Error("Файл превышает 8 МБ");
  const checksum = digest({ content, format });
  const prior = (
    await db.query<{ job_id: string | null; state: string; preview: Preview }>(
      "select job_id,state,preview from catalog_ingest.uploads where digest=$1",
      [checksum],
    )
  ).rows[0];
  if (prior?.job_id && prior.state === "prepared") {
    const job = await uploadJob(db, prior.job_id);
    if (job.state !== "cancelled")
      return { preview: prior.preview, job, replayed: true };
  }
  let raw: unknown[];
  try {
    raw = parseInput(content, format, taxonomy, UPLOAD_LIMITS);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(
        "Ошибка синтаксиса файла. Проверьте JSON и кодировку UTF-8",
      );
    throw error;
  }
  const preview: Preview = {
    total: raw.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    rows: [],
  };
  const ids = new Set<string>(),
    slugs = new Set<string>(),
    locations = new Map<string, string>(),
    failedRows = new Set<number>(),
    actions = new Map<number, "created" | "updated" | "skipped">();
  const addError = (row: number, message: string) => {
    if (!failedRows.has(row)) {
      preview.failed++;
      const action = actions.get(row);
      if (action) preview[action]--;
      failedRows.add(row);
    }
    if (preview.errors.length < 100)
      preview.errors.push({ row, message: message.slice(0, 1000) });
  };
  const records = raw as ExternalImportRecord[];
  for (let offset = 0; offset < raw.length; offset += 50) {
    const packet = records.slice(offset, offset + 50);
    const existing = await db.query<{ document: AdminTour }>(
      "select document from catalog_ingest.products where provider=any($1::text[]) and external_product_id=any($2::text[])",
      [
        packet.map((r) => r?.provider ?? ""),
        packet.map((r) => r?.external_product_id ?? ""),
      ],
    );
    const rows = prepareImport(
      JSON.stringify(packet),
      "json",
      taxonomy,
      existing.rows.map((r) => adminTourSchema.parse(r.document)),
      allowTest,
    );
    const owners = (
      await db.query<{
        slug: string;
        provider: string | null;
        external_product_id: string | null;
      }>("select * from catalog_projection.slug_owners($1)", [
        rows.map((r) => r.slug),
      ])
    ).rows;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i],
        item = packet[i],
        row = offset + i + 1;
      if (r.action === "error") {
        const parseError = (item as unknown as { parse_error?: string })
          ?.parse_error;
        addError(row, parseError ?? r.errors.join("; "));
        continue;
      }
      if (
        owners.some(
          (o) =>
            o.slug === r.slug &&
            (o.provider !== item.provider ||
              o.external_product_id !== item.external_product_id),
        )
      ) {
        addError(row, "Адрес карточки уже используется другим продуктом");
        continue;
      }
      const key = JSON.stringify([item.provider, item.external_product_id]);
      if (ids.has(key) || slugs.has(r.slug)) {
        addError(row, "Повтор product ID или адреса карточки в файле");
        continue;
      }
      ids.add(key);
      slugs.add(r.slug);
      for (const location of r.tour!.externalProduct!.locations) {
        const key = location.country + "/" + location.slug,
          value = digest(location);
        if (locations.has(key) && locations.get(key) !== value)
          addError(row, "Противоречивые данные направления: " + key);
        locations.set(key, value);
      }
      if (failedRows.has(row)) continue;
      const action = (
        { create: "created", update: "updated", skip: "skipped" } as const
      )[r.action];
      preview[action]++;
      actions.set(row, action);
      if (preview.rows.length < 20)
        preview.rows.push({ row, title: r.title, action: r.action });
    }
  }
  if (preview.failed) return { preview, job: null, replayed: false };
  const scope = feedScopeSchema.parse({
    provider: records[0].provider,
    countries: [...new Set(records.map((r) => r.product.country))],
    snapshot_at: records[0].last_synced_at,
    complete: false,
  });
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (
      r.provider !== scope.provider ||
      Date.parse(r.last_synced_at) !== Date.parse(scope.snapshot_at)
    ) {
      addError(
        i + 1,
        "В одном файле нужны одинаковые provider и last_synced_at",
      );
    }
  }
  if (preview.failed) return { preview, job: null, replayed: false };
  const reserved = await db.query(
    "insert into catalog_ingest.uploads(digest,actor,filename,format,state) values($1,$2,$3,$4,'preparing') on conflict(digest) do update set state='preparing',updated_at=now() where catalog_ingest.uploads.state='failed' or (catalog_ingest.uploads.state='preparing' and catalog_ingest.uploads.updated_at<now()-interval '5 minutes') or (catalog_ingest.uploads.state='prepared' and exists(select 1 from catalog_ingest.jobs j where j.id=catalog_ingest.uploads.job_id and j.state='cancelled')) returning id",
    [checksum, actor, filename.slice(0, 120), format],
  );
  if (!reserved.rows.length)
    throw new Error("Этот файл уже подготавливается. Обновите список заданий");
  try {
    async function* input() {
      yield* records;
    }
    const id = await stageStream(
      db,
      input(),
      scope,
      taxonomy,
      allowTest,
      50,
      true,
      async (tx, jobId) => {
        await tx.query(
          "update catalog_ingest.uploads set job_id=$2,state='prepared',preview=$3::jsonb,updated_at=now() where digest=$1",
          [checksum, jobId, JSON.stringify(preview)],
        );
      },
    );
    return { preview, job: await uploadJob(db, id), replayed: false };
  } catch (error) {
    await db.query(
      "update catalog_ingest.uploads set state='failed',updated_at=now() where digest=$1",
      [checksum],
    );
    throw error;
  }
}
export async function releaseUpload(db: Database, id: string) {
  return db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(72619483)");
    const job = (
      await tx.query<{
        provider: string;
        countries: string[];
        snapshot_at: string;
        sealed: boolean;
        state: string;
        lease_live: boolean;
      }>(
        "select provider,countries,snapshot_at,sealed,state,coalesce(lease_until>clock_timestamp(),false) lease_live from catalog_ingest.jobs where id=$1 for update",
        [id],
      )
    ).rows[0];
    if (!job?.sealed) throw new Error("Подготовка задания не завершена");
    if (
      job.state === "completed" ||
      (job.state === "running" && job.lease_live)
    )
      return;
    const conflict = await tx.query(
      "select id from catalog_ingest.jobs where id<>$1 and provider=$2 and countries && $3::text[] and (state not in ('completed','cancelled','failed') or snapshot_at>$4::timestamptz)",
      [id, job.provider, job.countries, job.snapshot_at],
    );
    if (conflict.rows.length)
      throw new Error("Конфликт с другим или более новым заданием");
    await tx.query(
      "update catalog_ingest.jobs set state='queued',available_at=clock_timestamp(),attempts=0,last_error=null,owner=null,lease_until=null where id=$1",
      [id],
    );
  });
}
export async function stepUpload(
  db: Database,
  id: string,
  cursor: number,
  taxonomy: AdminTaxonomy,
  allowTest = false,
) {
  const before = await uploadJob(db, id);
  if (before.state === "completed" || Number(before.cursor) > cursor)
    return before;
  const lease = (
    await db.query<
      NonNullable<Awaited<ReturnType<typeof import("./postgres-worker").claim>>>
    >("select * from catalog_ingest.claim_specific($1,$2)", [
      id,
      "upload-" + randomUUID(),
    ])
  ).rows[0];
  if (!lease) return uploadJob(db, id);
  try {
    await processPacket(db, lease, cursor, taxonomy, allowTest);
    await db.query(
      "update catalog_ingest.jobs set state='queued',owner=null,lease_until=null where id=$1 and fence=$2 and owner=$3 and state='running'",
      [id, lease.fence, lease.owner],
    );
  } catch (error) {
    await retryLater(db, lease, error);
    throw error;
  }
  return uploadJob(db, id);
}
