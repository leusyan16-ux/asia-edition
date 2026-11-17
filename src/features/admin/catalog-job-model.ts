import { z } from "zod";
import { tourSchema } from "../tours/model";
export const feedScopeSchema = z
  .object({
    provider: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    countries: z.array(tourSchema.shape.country).min(1).max(13),
    complete: z.boolean().default(false),
    snapshot_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export const catalogJobSchema = z.object({
  id: z.uuid(),
  created_at: z.iso.datetime({ offset: true }),
  actor: z.string(),
  scope: feedScopeSchema,
  digest: z.string(),
  phase: z.enum(["prepared", "running", "failed", "completed", "cancelled"]),
  cursor: z.number().int().nonnegative(),
  processed: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  discontinued: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  errors: z.array(z.string()),
  parts: z.array(
    z.object({ count: z.number().int().min(1).max(250), digest: z.string() }),
  ),
  identities: z.array(z.string()),
  total: z.number().int().min(1).max(100000),
  preview: z.object({
    created: z.number(),
    updated: z.number(),
    skipped: z.number(),
    failed: z.number(),
  }),
  mapping: z.array(
    z.object({
      external_product_id: z.string(),
      internal_product_id: z.uuid().nullable(),
      package_ids: z.array(z.string()),
      country: z.string(),
      city: z.string().nullable(),
      category: z.string(),
    }),
  ),
});
export type CatalogJob = z.infer<typeof catalogJobSchema>;
