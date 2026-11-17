import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { tourSchema, type TourRepository } from "./model";
import { demoTour } from "./demo";
import { selectTours } from "./query";
import { countries } from "@/lib/catalog";
import { categories } from "./labels";
import { localTourRepository } from "./local-repository";
import { postgresPublicRepository } from "../ingestion/runtime";
import { publicPreviewOnly } from "@/lib/public-preview";
import snapshot from "./published-catalog.json";
import { staticCatalogRepository } from "./static-catalog";
import { isAllowedCountry, isAllowedTour } from "@/lib/geography";
let staticRepository: { expiresAt: number; repository: TourRepository } | undefined;
// Opt-in, public read-only adapter. No service-role key or write operation is exposed.
export function getTourRepository(): TourRepository {
  if (process.env.TOUR_DATA_SOURCE === "static" ||
      (process.env.NODE_ENV === "production" && !process.env.TOUR_DATA_SOURCE)) {
    const now = new Date();
    if (!staticRepository || now.getTime() >= staticRepository.expiresAt) {
      const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      staticRepository = {
        expiresAt: Math.min(nextDay, now.getTime() + 60 * 60 * 1000),
        repository: staticCatalogRepository(snapshot, now),
      };
    }
    return staticRepository.repository;
  }
  if (!publicPreviewOnly() && process.env.TOUR_DATA_SOURCE === "postgres")
    return postgresPublicRepository();
  if (!publicPreviewOnly() && process.env.TOUR_DATA_SOURCE === "local")
    return localTourRepository();
  if (publicPreviewOnly() || process.env.TOUR_DATA_SOURCE !== "supabase")
    return {
      list: async (q) => selectTours([demoTour], q),
      bySlug: async (slug) => (slug === demoTour.slug ? demoTour : null),
      taxonomy: async () => ({
        locations: countries.flatMap((c) =>
          c.destinations.map((d) => ({
            slug: d.slug,
            country: c.slug,
            name: d.name,
          })),
        ),
        categories,
      }),
    };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error("Supabase read-only inventory is not configured");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async taxonomy() {
      const [locations, categories] = await Promise.all([
        client.from("locations").select("slug,country_slug,name_ru,name_en"),
        client.from("categories").select("slug,name_ru,name_en"),
      ]);
      if (locations.error || categories.error)
        throw new Error("Unable to load destination filters");
      return {
        locations: (locations.data ?? []).filter((l) => isAllowedCountry(l.country_slug)).map((l) => ({
          slug: l.slug,
          country: l.country_slug,
          name: { ru: l.name_ru, en: l.name_en },
        })),
        categories: (categories.data ?? []).map((c) => ({
          slug: c.slug,
          name: { ru: c.name_ru, en: c.name_en },
        })),
      };
    },
    async list(query) {
      const { data, error } = await client.rpc("tour_catalog", {
        filters: query,
      });
      if (error) throw new Error("Unable to load verified inventory");
      const result = z
        .object({
          items: z.array(tourSchema),
          total: z.number().int().nonnegative(),
        })
        .parse(data);
      // Fail closed on a legacy backend page until its region policy is aligned.
      // Do not return misleading totals or partial pagination from an old RPC.
      if (result.items.some((t) => !isAllowedTour(t)))
        throw new Error("Backend geography policy requires regional alignment");
      return result;
    },
    async bySlug(slug) {
      const { data, error } = await client.rpc("tour_detail", {
        tour_slug: slug,
      });
      if (error) throw new Error("Unable to load verified tour");
      const tour = data ? tourSchema.parse(data) : null;
      return tour && isAllowedTour(tour) ? tour : null;
    },
  };
}
