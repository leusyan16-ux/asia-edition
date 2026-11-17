import { isAllowedCountry } from "@/lib/geography";
import "server-only";
import { headers } from "next/headers";
import {
  readLocalPublicPage,
  readLocalPublicBySlug,
  readLocalSourceLocations,
} from "@/features/admin/local-store";
import { countries } from "@/lib/catalog";
import { localCategories } from "@/features/admin/local-taxonomy";
import { localCatalogAllowed, localTourPayload } from "./local-catalog";
import type { TourRepository } from "./model";
import { postgresSelected, assertLocalPostgres } from "../ingestion/config";
import { nativeSelected } from "../ingestion/native-config";
export async function requireLocalCatalog() {
  const host = (await headers()).get("host") || "";
  if (postgresSelected()) {
    if (nativeSelected()) return;
    assertLocalPostgres(host);
    return;
  }
  if (
    !localCatalogAllowed(
      process.env.NODE_ENV,
      process.env.ADMIN_MODE,
      process.env.TOUR_DATA_SOURCE,
      host,
    )
  )
    throw new Error(
      "Local catalog requires development, localhost, ADMIN_MODE=local and TOUR_DATA_SOURCE=local",
    );
}
export function localTourRepository(): TourRepository {
  return {
    async list(query) {
      await requireLocalCatalog();
      const page = await readLocalPublicPage(query);
      // Local publication is a development preview, not supplier verification.
      return { ...page, items: page.items.map((t) => localTourPayload(t)) };
    },
    async bySlug(slug) {
      await requireLocalCatalog();
      const tour = await readLocalPublicBySlug(slug);
      return tour ? localTourPayload(tour) : null;
    },
    async taxonomy() {
      await requireLocalCatalog();
      return {
        locations: [
          ...countries.flatMap((c) =>
            c.destinations.map((d) => ({
              slug: d.slug,
              country: c.slug,
              name: d.name,
            })),
          ),
          ...(await readLocalSourceLocations(undefined, true)),
        ].filter(
          (l, i, a) =>
            isAllowedCountry(l.country) && a.findIndex((o) => o.slug === l.slug && o.country === l.country) ===
            i,
        ),
        categories: localCategories,
      };
    },
  };
}
