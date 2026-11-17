import { z } from "zod";
import { tourSchema } from "../tours/model";
const provider = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
export const providerMappingsSchema = z
  .object({
    products: z.array(
      z.object({
        provider,
        external_product_id: z.string().min(1),
        internal_product_id: z.uuid(),
      }),
    ),
    packages: z.array(
      z.object({
        provider,
        external_product_id: z.string().min(1),
        external_package_id: z.string().min(1),
        internal_package_id: z.uuid(),
      }),
    ),
    countries: z.array(
      z.object({
        provider,
        external_country_id: z.string().min(1),
        country: tourSchema.shape.country,
      }),
    ),
    locations: z.array(
      z.object({
        provider,
        external_location_id: z.string().min(1),
        country: tourSchema.shape.country,
        slug: z.string().regex(/^[a-z0-9-]+$/),
        kind: z.enum(["city", "resort", "destination"]),
      }),
    ),
    categories: z.array(
      z.object({
        provider,
        external_category_id: z.string().min(1),
        slug: z.string().regex(/^[a-z0-9-]+$/),
      }),
    ),
  })
  .superRefine((m, ctx) => {
    for (const [section, items] of Object.entries(m)) {
      const keys = new Set<string>();
      for (const item of items) {
        const key = JSON.stringify(
          Object.entries(item)
            .filter(([k]) => k === "provider" || k.startsWith("external_"))
            .sort(),
        );
        if (keys.has(key))
          ctx.addIssue({
            code: "custom",
            path: [section],
            message: "Duplicate provider mapping identity",
          });
        keys.add(key);
      }
    }
  });
export type ProviderMappings = z.infer<typeof providerMappingsSchema>;
// Populate only from documented official identifiers; there are no guessed Klook IDs here.
export const emptyProviderMappings: ProviderMappings = {
  products: [],
  packages: [],
  countries: [],
  locations: [],
  categories: [],
};
