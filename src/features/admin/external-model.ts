import { z } from "zod";
import { tourSchema, priceSchema } from "@/features/tours/model";
const bilingual = z.object({
  ru: z.string().max(20000),
  en: z.string().max(20000),
});
export const productTypes = [
  "excursion",
  "tour",
  "ticket",
  "show",
  "entertainment",
  "park",
  "museum",
  "transfer",
  "activity",
] as const;
export const importedLocationSchema = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(120),
    country: tourSchema.shape.country,
    name: bilingual,
    kind: z.enum(["city", "resort", "destination"]),
    parent: z.string().nullable().default(null),
    asian_territory_verified: z.boolean().default(false),
  })
  .strict();
export const sourceFactsSchema = tourSchema
  .omit({
    id: true,
    status: true,
    isDemo: true,
    verifiedAt: true,
    featured: true,
    prices: true,
    availability: true,
    updatedAt: true,
    cancellation: true,
  })
  .extend({
    city: z.string().nullable().default(null),
    resort: z.string().nullable().default(null),
    product_type: z.enum(productTypes).default("activity"),
  });
export const packageSchema = z
  .object({
    external_package_id: z.string().trim().min(1).max(200),
    title: bilingual,
    description: bilingual.nullable().default(null),
    inclusions: z
      .object({ ru: z.array(z.string()), en: z.array(z.string()) })
      .default({ ru: [], en: [] }),
    cancellation: bilingual.nullable().default(null),
    prices: z.array(priceSchema).max(30).default([]),
  })
  .strict();
export const externalProductSchema = z.object({
  // Private provider observations, never included in the public Tour payload.
  source_metadata: z
    .record(z.string().max(80), z.json())
    .refine((v) => Object.keys(v).length <= 50)
    .optional(),
  provider: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  external_product_id: z.string().trim().min(1).max(200),
  source_url: z.url({ protocol: /^https$/ }).max(2048),
  import_status: z.enum(["pending", "needs_review", "reviewed", "failed"]),
  last_synced_at: z.iso.datetime({ offset: true }),
  test_data: z.boolean().default(false),
  source_status: z
    .enum(["active", "missing", "discontinued"])
    .default("active"),
  editorial_status: z
    .enum(["pending", "approved", "rejected"])
    .default("pending"),
  content_rights_status: z
    .enum(["unknown", "licensed", "restricted"])
    .default("unknown"),
  publication_readiness: z.enum(["blocked", "ready"]).default("blocked"),
  rights_evidence: z
    .url({ protocol: /^https$/ })
    .nullable()
    .default(null),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  facts: sourceFactsSchema,
  locations: z.array(importedLocationSchema).max(20).default([]),
  commercial: z.object({
    prices: z.array(priceSchema).max(30),
    packages: z.array(packageSchema).max(100),
    schedules: tourSchema.shape.departures,
    availability: tourSchema.shape.availability,
    cancellation: bilingual.nullable(),
  }),
});
export type ExternalProduct = z.infer<typeof externalProductSchema>;
export const importLogSchema = z.object({
  id: z.uuid(),
  batch_id: z.string().min(1).max(100),
  digest: z.string(),
  timestamp: z.iso.datetime({ offset: true }),
  actor: z.string(),
  format: z.enum(["csv", "json"]),
  status: z.enum(["committed", "rejected"]),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  rows: z
    .array(
      z.object({
        row: z.number().int(),
        key: z.string(),
        action: z.enum(["create", "update", "skip", "error"]),
        errors: z.array(z.string()),
      }),
    )
    .max(1000),
});
export type ImportLog = z.infer<typeof importLogSchema>;
