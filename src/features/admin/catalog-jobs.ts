import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  catalogJobSchema,
  feedScopeSchema,
  type CatalogJob,
} from "./catalog-job-model";
import {
  localDirectory,
  readLocalState,
  updateLocalState,
} from "./local-store";
import {
  prepareImport,
  summary,
  digest,
  isTestProfile,
  type ImportFormat,
} from "./import-engine";
import {
  adminTourSchema,
  missingInformation,
  type AdminTaxonomy,
} from "./model";
export const LARGE_FEED_LIMITS = {
  maxRows: 100000,
  maxBytes: 50 * 1024 * 1024,
};

export async function stageCatalogJob(
  content: string,
  format: ImportFormat,
  manifest: unknown,
  taxonomy: AdminTaxonomy,
  actor: string,
  directory = localDirectory(),
) {
  const scope = feedScopeSchema.parse(manifest);
  if (new Set(scope.countries).size !== scope.countries.length)
    throw new Error("Повтор страны в scope");
  const state = await readLocalState(directory);
  if (
    (state.catalogJobs || []).some(
      (j) =>
        j.scope.provider === scope.provider &&
        !["completed", "cancelled"].includes(j.phase) &&
        j.scope.countries.some((c) => scope.countries.includes(c)),
    )
  )
    throw new Error("Для этого provider/scope уже есть незавершённый импорт");
  const rows = prepareImport(
    content,
    format,
    taxonomy,
    state.tours,
    isTestProfile(directory),
    LARGE_FEED_LIMITS,
  );
  if (rows.some((r) => r.errors.length))
    return {
      job: null,
      summary: summary(rows),
      errors: rows
        .filter((r) => r.errors.length)
        .slice(0, 1000)
        .map((r) => ({ row: r.row, errors: r.errors })),
    };
  const incoming = rows.map((r) => r.tour!.externalProduct!);
  if (
    incoming.some(
      (p) =>
        p.provider !== scope.provider ||
        !scope.countries.includes(p.facts.country) ||
        p.last_synced_at !== scope.snapshot_at,
    )
  )
    throw new Error(
      "Feed должен соответствовать provider, странам и snapshot_at",
    );
  const jobId = randomUUID();
  // Store immutable normalized packets once; never resend/revalidate a 100k-row feed for every packet.
  const records = incoming.map((p) => {
    const { product_type, ...facts } = p.facts;
    return {
      provider: p.provider,
      external_product_id: p.external_product_id,
      source_url: p.source_url,
      import_status: "needs_review",
      last_synced_at: p.last_synced_at,
      test_data: p.test_data,
      source_status:
        p.source_status === "discontinued" ? "discontinued" : "active",
      product_type,
      locations: p.locations,
      packages: p.commercial.packages,
      product: {
        ...facts,
        prices: p.commercial.prices,
        departures: p.commercial.schedules,
        availability: p.commercial.availability,
        cancellation: p.commercial.cancellation,
      },
    };
  });
  const chunks: (typeof records)[] = [];
  let chunk: typeof records = [];
  let chunkBytes = 40;
  for (const record of records) {
    const recordBytes = Buffer.byteLength(JSON.stringify(record)) + 1;
    if (recordBytes + 40 > 8 * 1024 * 1024)
      throw new Error("Один продукт превышает лимит пакета 8 МБ");
    if (
      chunk.length &&
      (chunk.length >= 250 || chunkBytes + recordBytes > 8 * 1024 * 1024)
    ) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 40;
    }
    chunk.push(record);
    chunkBytes += recordBytes;
  }
  if (chunk.length) chunks.push(chunk);
  const job = catalogJobSchema.parse({
    id: jobId,
    created_at: new Date().toISOString(),
    actor,
    scope,
    digest: digest(content),
    phase: "prepared",
    cursor: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    discontinued: 0,
    missing: 0,
    errors: [],
    total: rows.length,
    preview: summary(rows),
    identities: incoming.map((p) => p.external_product_id),
    parts: chunks.map((c) => ({
      count: c.length,
      digest: digest(JSON.stringify({ schema_version: 1, products: c })),
    })),
    mapping: rows.map((r) => ({
      external_product_id: r.tour!.externalProduct!.external_product_id,
      internal_product_id: r.action === "create" ? null : r.tour!.id,
      package_ids: r.tour!.externalProduct!.commercial.packages.map(
        (p) => p.external_package_id,
      ),
      country: r.tour!.country,
      city: r.tour!.city,
      category: r.tour!.category,
    })),
  });
  const folder = path.join(directory, "catalog-jobs", jobId);
  await mkdir(folder, { recursive: true });
  for (let i = 0; i < chunks.length; i++)
    await writeFile(
      path.join(folder, `${i}.json`),
      JSON.stringify({ schema_version: 1, products: chunks[i] }),
      { flag: "wx", mode: 0o600 },
    );
  await updateLocalState((current) => {
    if (
      (current.catalogJobs || []).some(
        (j) =>
          j.scope.provider === scope.provider &&
          !["completed", "cancelled"].includes(j.phase) &&
          j.scope.countries.some((c) => scope.countries.includes(c)),
      )
    )
      throw new Error("Для этого provider/scope уже есть незавершённый импорт");
    if (
      scope.complete &&
      current.tours.some(
        (t) =>
          t.externalProduct?.provider === scope.provider &&
          scope.countries.includes(t.externalProduct.facts.country) &&
          Date.parse(t.externalProduct.last_synced_at) >
            Date.parse(scope.snapshot_at),
      )
    )
      throw new Error("Полный feed старее данных каталога");
    return {
      state: { ...current, catalogJobs: [...(current.catalogJobs || []), job] },
      value: job,
    };
  }, directory);
  return { job, summary: summary(rows), errors: [] };
}

export async function advanceCatalogJob(
  id: string,
  expectedCursor: number,
  taxonomy: AdminTaxonomy,
  directory = localDirectory(),
) {
  z.uuid().parse(id);
  z.number().int().nonnegative().parse(expectedCursor);
  const snapshot = await readLocalState(directory),
    job = snapshot.catalogJobs?.find((j) => j.id === id);
  if (!job) throw new Error("Импорт не найден");
  if (job.phase === "cancelled") throw new Error("Импорт отменён");
  if (job.phase === "completed" || expectedCursor < job.cursor) return job; // Network retry: acknowledge committed checkpoint, never apply another packet.
  if (expectedCursor !== job.cursor)
    throw new Error("Контрольная точка устарела");
  let content: string | null = null;
  if (job.cursor < job.parts.length) {
    content = await readFile(
      path.join(directory, "catalog-jobs", id, `${job.cursor}.json`),
      "utf8",
    );
    if (digest(content) !== job.parts[job.cursor].digest)
      throw new Error("Контрольная сумма пакета не совпадает");
  }
  return updateLocalState((state) => {
    const current = state.catalogJobs?.find((j) => j.id === id);
    if (!current) throw new Error("Импорт не найден");
    if (current.phase === "cancelled") throw new Error("Импорт отменён");
    if (current.cursor !== expectedCursor) return { state, value: current };
    let next: CatalogJob = { ...current, phase: "running", errors: [] };
    if (content !== null) {
      const rows = prepareImport(
        content,
        "json",
        taxonomy,
        state.tours,
        isTestProfile(directory),
      );
      if (rows.some((r) => r.errors.length)) {
        next = {
          ...next,
          phase: "failed",
          errors: rows.flatMap((r) => r.errors).slice(0, 1000),
        };
        return {
          state: {
            ...state,
            catalogJobs: state.catalogJobs!.map((j) =>
              j.id === id ? next : j,
            ),
          },
          value: next,
        };
      }
      const merged = new Map(state.tours.map((t) => [t.id, t]));
      for (const row of rows) {
        const tour = row.tour!;
        merged.set(
          tour.id,
          adminTourSchema.parse({
            ...tour,
            updatedAt: new Date(
              Math.max(Date.now(), Date.parse(tour.updatedAt) || 0) + 1,
            ).toISOString(),
          }),
        );
        const mapping = next.mapping.find(
          (m) =>
            m.external_product_id === tour.externalProduct!.external_product_id,
        );
        if (mapping) mapping.internal_product_id = tour.id;
      }
      const counts = summary(rows);
      next = {
        ...next,
        cursor: next.cursor + 1,
        processed: next.processed + rows.length,
        created: next.created + counts.created,
        updated: next.updated + counts.updated,
        skipped: next.skipped + counts.skipped,
        discontinued:
          next.discontinued +
          rows.filter(
            (r) => r.tour!.externalProduct!.source_status === "discontinued",
          ).length,
      };
      state = { ...state, tours: [...merged.values()] };
    } else {
      // Only an explicitly complete, fully committed feed may mark omissions; never delete them.
      const seen = new Set(next.identities);
      if (next.scope.complete)
        state = {
          ...state,
          tours: state.tours.map((t) => {
            const p = t.externalProduct;
            if (
              !p ||
              p.provider !== next.scope.provider ||
              !next.scope.countries.includes(p.facts.country) ||
              seen.has(p.external_product_id) ||
              p.source_status === "discontinued"
            )
              return t;
            if (
              Date.parse(p.last_synced_at) > Date.parse(next.scope.snapshot_at)
            )
              throw new Error(
                "Новые данные появились после начала feed; сверка остановлена",
              );
            next.missing++;
            return {
              ...t,
              status: "draft" as const,
              verifiedAt: null,
              updatedAt: new Date().toISOString(),
              externalProduct: {
                ...p,
                source_status: "missing" as const,
                publication_readiness: "blocked" as const,
              },
            };
          }),
        };
      next = { ...next, phase: "completed" };
    }
    return {
      state: {
        ...state,
        catalogJobs: state.catalogJobs!.map((j) => (j.id === id ? next : j)),
      },
      value: next,
    };
  }, directory);
}

export async function cancelCatalogJob(
  id: string,
  directory = localDirectory(),
) {
  z.uuid().parse(id);
  return updateLocalState((state) => {
    const job = state.catalogJobs?.find((j) => j.id === id);
    if (!job) throw new Error("Импорт не найден");
    const next = { ...job, phase: "cancelled" as const };
    return {
      state: {
        ...state,
        catalogJobs: state.catalogJobs!.map((j) => (j.id === id ? next : j)),
      },
      value: next,
    };
  }, directory);
}

export async function reviewExternalProduct(
  id: string,
  review: unknown,
  directory = localDirectory(),
) {
  const input = z
    .object({
      editorial_status: z.enum(["pending", "approved", "rejected"]),
      content_rights_status: z.enum(["unknown", "licensed", "restricted"]),
      rights_evidence: z.url({ protocol: /^https$/ }).nullable(),
    })
    .strict()
    .parse(review);
  if (input.content_rights_status === "licensed" && !input.rights_evidence)
    throw new Error("Укажите подтверждение прав");
  return updateLocalState((state) => {
    const t = state.tours.find((t) => t.id === id);
    if (!t?.externalProduct) throw new Error("Внешний продукт не найден");
    const ready =
      input.editorial_status === "approved" &&
      input.content_rights_status === "licensed" &&
      t.externalProduct.source_status === "active" &&
      !missingInformation(t).length;
    const tour = {
      ...t,
      status: "draft" as const,
      verifiedAt: ready ? t.verifiedAt : null,
      updatedAt: new Date().toISOString(),
      externalProduct: {
        ...t.externalProduct,
        ...input,
        publication_readiness: ready
          ? ("ready" as const)
          : ("blocked" as const),
      },
    };
    return {
      state: {
        ...state,
        tours: state.tours.map((old) => (old.id === id ? tour : old)),
      },
      value: tour,
    };
  }, directory);
}
