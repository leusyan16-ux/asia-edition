import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { geographyError } from "@/lib/geography";
import { csvColumns, parseCSV, previewCSV } from "./csv";
import {
  adminDocumentSchema,
  adminTourSchema,
  emptyTour,
  validateTour,
  type AdminTour,
  type AdminTaxonomy,
} from "./model";
import {
  externalProductSchema,
  packageSchema,
  importedLocationSchema,
  sourceFactsSchema,
  productTypes,
  type ImportLog,
} from "./external-model";
import { validationError } from "./errors";
import {
  updateLocalState,
  type LocalState,
  localDirectory,
} from "./local-store";
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024,
  MAX_IMPORT_ROWS = 5000,
  IMPORT_BATCH_SIZE = 250;
const metaSchema = z
  .object({
    provider: externalProductSchema.shape.provider,
    source_metadata: externalProductSchema.shape.source_metadata,
    external_product_id: externalProductSchema.shape.external_product_id,
    source_url: externalProductSchema.shape.source_url,
    import_status: externalProductSchema.shape.import_status,
    last_synced_at: externalProductSchema.shape.last_synced_at,
    test_data: z.boolean().default(false),
    source_status: z.enum(["active", "discontinued"]).default("active"),
    product_type: z.enum(productTypes).default("activity"),
    packages: z.array(packageSchema).max(100).default([]),
    locations: z.array(importedLocationSchema).max(20).default([]),
    product: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ExternalImportRecord = z.input<typeof metaSchema>;
export type ImportFormat = "csv" | "json";
export type PlannedRow = {
  row: number;
  key: string;
  slug: string;
  title: string;
  action: "create" | "update" | "skip" | "error";
  errors: string[];
  tour?: AdminTour;
  expected?: string;
};
const extraColumns = [
  "provider",
  "external_product_id",
  "source_url",
  "import_status",
  "last_synced_at",
  "test_data",
  "product_type",
  "packages_json",
  "locations_json",
  "availability_json",
  "source_status",
];
export const externalCSVTemplate =
  "\uFEFF" + [...extraColumns, ...csvColumns].join(",") + "\r\n";
export const externalJSONTemplate = JSON.stringify(
  { schema_version: 1, products: [] },
  null,
  2,
);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const encodeCSV = (v: string) => '"' + v.replaceAll('"', '""') + '"';
export function parseInput(
  content: string,
  format: ImportFormat,
  taxonomy: AdminTaxonomy,
  limits = { maxRows: MAX_IMPORT_ROWS, maxBytes: MAX_IMPORT_BYTES },
): unknown[] {
  if (Buffer.byteLength(content) > limits.maxBytes)
    throw new Error(
      `Файл превышает ${Math.ceil(limits.maxBytes / 1048576)} МБ`,
    );
  if (format === "json") {
    const raw = JSON.parse(content.replace(/^\uFEFF/, ""));
    const products = Array.isArray(raw)
      ? raw
      : z
          .object({
            schema_version: z.literal(1),
            products: z.array(z.unknown()),
          })
          .strict()
          .parse(raw).products;
    if (!products.length || products.length > limits.maxRows)
      throw new Error(`В файле должно быть 1–${limits.maxRows} продуктов`);
    return products;
  }
  const rows = parseCSV(content, limits.maxRows, limits.maxBytes),
    headers = rows.shift();
  if (!headers || !rows.length) throw new Error("CSV пуст");
  if (
    new Set(headers).size !== headers.length ||
    headers.some((h) => ![...csvColumns, ...extraColumns].includes(h))
  )
    throw new Error("Повтор или неизвестная колонка CSV");
  for (const h of [
    ...extraColumns.slice(0, 5),
    "slug",
    "country",
    "location",
    "category",
    "title_ru",
    "title_en",
  ])
    if (!headers.includes(h)) throw new Error("Отсутствует колонка " + h);
  return rows.map((cells) => {
    try {
      if (cells.length !== headers.length)
        throw new Error("Число полей не совпадает с заголовком");
      const r = Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
      const locations = r.locations_json
        ? z.array(importedLocationSchema).parse(JSON.parse(r.locations_json))
        : [];
      const augmented = {
        ...taxonomy,
        locations: [...taxonomy.locations, ...locations],
      };
      const baseHeaders = headers.filter((h) =>
        csvColumns.includes(h as (typeof csvColumns)[number]),
      );
      const parsed = previewCSV(
        baseHeaders.join(",") +
          "\n" +
          baseHeaders.map((h) => encodeCSV(r[h])).join(","),
        augmented,
        [],
      )[0];
      if (parsed.errors.length) throw new Error(parsed.errors.join("; "));
      const product = { ...parsed.tour! } as Record<string, unknown>;
      for (const k of [
        "id",
        "updatedAt",
        "externalProduct",
        "status",
        "verifiedAt",
        "archived",
        "visible",
        "featured",
        "isDemo",
      ])
        delete product[k];
      if (r.availability_json)
        product.availability = JSON.parse(r.availability_json);
      if (r.test_data && !["true", "false"].includes(r.test_data))
        throw new Error("test_data: true или false");
      return {
        provider: r.provider,
        external_product_id: r.external_product_id,
        source_url: r.source_url,
        import_status: r.import_status,
        last_synced_at: r.last_synced_at,
        test_data: r.test_data === "true",
        source_status: r.source_status || "active",
        product_type: r.product_type || "activity",
        packages: r.packages_json ? JSON.parse(r.packages_json) : [],
        locations,
        product,
      };
    } catch (e) {
      return { parse_error: validationError(e) };
    }
  });
}
export function prepareImport(
  content: string,
  format: ImportFormat,
  taxonomy: AdminTaxonomy,
  existing: AdminTour[],
  allowTest = false,
  limits?: { maxRows: number; maxBytes: number },
) {
  const raw = parseInput(content, format, taxonomy, limits);
  const seen = new Set<string>(),
    batchLocations = new Map<string, string>(),
    slugs = new Map(existing.map((t) => [t.slug, t.id]));
  const identities = new Map(
    existing
      .filter((t) => t.externalProduct)
      .map((t) => [
        JSON.stringify([
          t.externalProduct!.provider,
          t.externalProduct!.external_product_id,
        ]),
        t,
      ]),
  );
  return raw.map((value, index): PlannedRow => {
    const row: PlannedRow = {
      row: index + (format === "csv" ? 2 : 1),
      key: "",
      slug: "",
      title: "",
      action: "error",
      errors: [],
    };
    try {
      if (value && typeof value === "object" && "parse_error" in value)
        throw new Error(String(value.parse_error));
      const input = metaSchema.parse(value);
      const geography = geographyError({
        ...input.product,
        locations: input.locations,
      });
      if (geography) throw new Error(geography);
      for (const p of input.packages) {
        const error = geographyError({ ...p, country: input.product.country });
        if (error) throw new Error(error);
      }
      row.key = JSON.stringify([input.provider, input.external_product_id]);
      if (seen.has(row.key))
        throw new Error("Повтор provider + external_product_id в файле");
      seen.add(row.key);
      if (input.test_data && !allowTest)
        throw new Error(
          "Тестовые продукты разрешены только в отдельном профиле .admin-local/test-* или qa-*",
        );
      const previous = identities.get(row.key);
      if (
        previous &&
        Date.parse(input.last_synced_at) <
          Date.parse(previous.externalProduct!.last_synced_at)
      )
        throw new Error("Снимок источника старее уже сохранённого");
      if (previous && previous.externalProduct!.test_data !== input.test_data)
        throw new Error("Нельзя смешивать тестовый и реальный продукт");
      const reserved = [
        "id",
        "status",
        "verifiedAt",
        "archived",
        "visible",
        "featured",
        "externalProduct",
        "updatedAt",
        "isDemo",
      ];
      if (
        Object.keys(input.product).some(
          (k) => reserved.includes(k) || !(k in adminDocumentSchema.shape),
        )
      )
        throw new Error(
          "Недопустимое поле product. Используйте нормализованный формат",
        );
      for (const location of input.locations) {
        const identity = JSON.stringify([location.country, location.slug]);
        const fingerprint = digest(location);
        if (
          batchLocations.has(identity) &&
          batchLocations.get(identity) !== fingerprint
        )
          throw new Error("Конфликт мест внутри файла");
        batchLocations.set(identity, fingerprint);
        if (location.country !== input.product.country)
          throw new Error("Место относится к другой стране");
        if (location.country === "turkey" && !location.asian_territory_verified)
          throw new Error("Подтвердите азиатскую территорию Турции");
        const known = taxonomy.locations.find(
          (l) => l.country === location.country && l.slug === location.slug,
        );
        if (
          known &&
          (known.kind !== location.kind ||
            digest(known.name) !== digest(location.name))
        )
          throw new Error("Конфликт существующего направления");
      }
      const augmented = {
        ...taxonomy,
        locations: [...taxonomy.locations, ...input.locations],
      };
      const normalized = validateTour(
        {
          ...emptyTour(previous?.id || randomUUID()),
          ...input.product,
          status: "draft",
          isDemo: input.test_data,
          verifiedAt: null,
        },
        augmented,
      );
      if (normalized.slots.some((s) => s.reserved !== 0))
        throw new Error("Импорт не меняет занятые места");
      if (
        new Set(input.packages.map((p) => p.external_package_id)).size !==
        input.packages.length
      )
        throw new Error("Повтор external_package_id");
      const facts = sourceFactsSchema.parse({
        ...normalized,
        product_type: input.product_type,
      });
      const commercial = {
        prices: normalized.prices.map((p) => ({ ...p })),
        packages: input.packages,
        schedules: normalized.departures,
        availability: normalized.availability,
        cancellation: normalized.cancellation,
      };
      const fingerprint = digest({
        ...(input.source_metadata
          ? { source_metadata: input.source_metadata }
          : {}),
        facts,
        commercial,
        locations: input.locations,
        source_url: input.source_url,
        test_data: input.test_data,
      });
      const external = externalProductSchema.parse({
        ...input,
        facts,
        commercial,
        fingerprint,
        import_status: "needs_review",
      });
      row.slug = previous?.slug || normalized.slug;
      row.title = previous?.title.ru || normalized.title.ru;
      if (!previous && slugs.has(normalized.slug))
        throw new Error("Адрес принадлежит другому продукту");
      if (!previous) slugs.set(normalized.slug, normalized.id);
      row.expected = previous?.updatedAt;
      if (
        previous?.externalProduct?.fingerprint === fingerprint &&
        (previous.externalProduct.source_status ?? "active") ===
          input.source_status
      ) {
        row.action = "skip";
        row.tour = {
          ...previous,
          externalProduct: {
            ...previous.externalProduct,
            last_synced_at: input.last_synced_at,
          },
        };
        return row;
      }
      row.action = previous ? "update" : "create";
      row.tour = adminTourSchema.parse(
        previous
          ? {
              ...previous,
              status: "draft",
              verifiedAt: null,
              externalProduct: external,
            }
          : {
              ...normalized,
              prices: [],
              slots: [],
              availability: [],
              departures: [],
              externalProduct: external,
            },
      );
      return row;
    } catch (e) {
      row.errors = [validationError(e)];
      return row;
    }
  });
}
export function previewDigest(
  content: string,
  format: ImportFormat,
  existing: AdminTour[],
  offset: number,
  limit: number,
) {
  return digest({
    content,
    format,
    offset,
    limit,
    versions: existing.map((t) => [t.id, t.updatedAt]).sort(),
  });
}
export function isTestProfile(directory: string) {
  return /(?:^|[\\/])(?:test|qa)-[a-z0-9_-]+$/i.test(directory);
}
export async function commitExternalImport(
  input: {
    content: string;
    format: ImportFormat;
    offset: number;
    limit: number;
    batch_id: string;
    preview_digest: string;
  },
  taxonomy: AdminTaxonomy,
  actor: string,
  directory = localDirectory(),
) {
  return updateLocalState((state) => {
    const payloadDigest = digest({
      content: input.content,
      format: input.format,
      offset: input.offset,
      limit: input.limit,
    });
    const previous = state.imports.find((l) => l.batch_id === input.batch_id);
    if (previous) {
      if (previous.digest !== payloadDigest)
        throw new Error("batch_id уже использован для другого пакета");
      return { state, value: previous };
    }
    if (
      previewDigest(
        input.content,
        input.format,
        state.tours,
        input.offset,
        input.limit,
      ) !== input.preview_digest
    )
      throw new Error(
        "Данные изменились после проверки. Повторите предварительный просмотр",
      );
    const all = prepareImport(
      input.content,
      input.format,
      taxonomy,
      state.tours,
      isTestProfile(directory),
    );
    const rows = all.slice(input.offset, input.offset + input.limit);
    if (!rows.length) throw new Error("Пустой пакет");
    const errors = all.filter((r) => r.action === "error");
    const rejected = errors.length > 0;
    const log: ImportLog = {
      id: randomUUID(),
      batch_id: input.batch_id,
      digest: payloadDigest,
      timestamp: new Date().toISOString(),
      actor,
      format: input.format,
      status: rejected ? "rejected" : "committed",
      created: rejected ? 0 : rows.filter((r) => r.action === "create").length,
      updated: rejected ? 0 : rows.filter((r) => r.action === "update").length,
      skipped: rejected ? 0 : rows.filter((r) => r.action === "skip").length,
      failed: errors.length,
      rows: (rejected ? errors.slice(0, 1000) : rows).map(
        ({ row, key, action, errors }) => ({ row, key, action, errors }),
      ),
    };
    if (rejected)
      return {
        state: { ...state, imports: [...state.imports, log] },
        value: log,
      };
    const merged = new Map(state.tours.map((t) => [t.id, t]));
    for (const row of rows) {
      const t = row.tour!;
      merged.set(
        t.id,
        adminTourSchema.parse({
          ...t,
          updatedAt: new Date(
            Math.max(Date.now(), Date.parse(t.updatedAt) || 0) + 1,
          ).toISOString(),
        }),
      );
    }
    return {
      state: {
        ...state,
        tours: [...merged.values()],
        imports: [...state.imports, log],
      },
      value: log,
    };
  }, directory);
}
export function summary(rows: PlannedRow[]) {
  return {
    created: rows.filter((r) => r.action === "create").length,
    updated: rows.filter((r) => r.action === "update").length,
    skipped: rows.filter((r) => r.action === "skip").length,
    failed: rows.filter((r) => r.action === "error").length,
  };
}
export function importTaxonomy(
  taxonomy: AdminTaxonomy,
  state: LocalState,
): AdminTaxonomy {
  return {
    ...taxonomy,
    locations: [
      ...taxonomy.locations,
      ...state.tours.flatMap((t) => t.externalProduct?.locations || []),
    ].filter(
      (l, i, a) =>
        a.findIndex((o) => o.country === l.country && o.slug === l.slug) === i,
    ),
  };
}
// Append-only validation results; product records remain untouched.
export async function recordImportErrors(
  content: string,
  format: ImportFormat,
  actor: string,
  rows: Pick<PlannedRow, "row" | "key" | "errors">[],
  directory = localDirectory(),
) {
  const fingerprint = digest({ content, format, errors: rows });
  const batch_id = "validation-" + fingerprint;
  return updateLocalState((state) => {
    const prior = state.imports.find((l) => l.batch_id === batch_id);
    if (prior) return { state, value: prior };
    const log: ImportLog = {
      id: randomUUID(),
      batch_id,
      digest: fingerprint,
      timestamp: new Date().toISOString(),
      actor,
      format,
      status: "rejected",
      created: 0,
      updated: 0,
      skipped: 0,
      failed: rows.length,
      rows: rows
        .slice(0, 1000)
        .map((r) => ({ ...r, action: "error" as const })),
    };
    return {
      state: { ...state, imports: [...state.imports, log] },
      value: log,
    };
  }, directory);
}
