import { z } from "zod";
import { isAllowedTour } from "@/lib/geography";
import type { Tour, TourQuery, TourPage } from "./model";
const numeric = z.coerce.number().finite().nonnegative();
export const querySchema = z
  .object({
    country: z.string().max(80).optional(),
    location: z.string().max(80).optional(),
    category: z.string().max(80).optional(),
    search: z.string().max(120).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("USD"),
    minPrice: numeric.optional(),
    maxPrice: numeric.optional(),
    duration: z.enum(["short", "half", "full", "multi"]).optional(),
    sort: z
      .enum(["featured", "price-asc", "price-desc", "duration"])
      .default("featured"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .refine(
    (q) =>
      q.minPrice === undefined ||
      q.maxPrice === undefined ||
      q.minPrice <= q.maxPrice,
    { message: "Minimum price exceeds maximum", path: ["minPrice"] },
  );
export function parseQuery(
  params: Record<string, string | string[] | undefined>,
  locale: "ru" | "en",
): TourQuery {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "string" && v !== ""),
  );
  const parsed = querySchema.safeParse(clean);
  return {
    ...(parsed.success ? parsed.data : querySchema.parse({})),
    locale,
    pageSize: 9,
    invalid: !parsed.success,
  };
}
export function selectTours(
  tours: Tour[],
  query: TourQuery,
  requireVerification = true,
  approvedSearchIndex?: ReadonlyMap<string, string>,
): TourPage {
  const q = query.search?.trim().toLocaleLowerCase();
  const price = (t: Tour) =>
    t.prices.find((p) => p.currency === query.currency)?.adult ??
    (t.informationOnly && t.referencePrice && t.referencePrice.currency === (query.currency ?? "USD") ? t.referencePrice.amount :
      t.previewPrice && (t.previewPrice.benchmark?.currency ?? "USD") === (query.currency ?? "USD") ? t.previewPrice.amount : null);
  const filtered = tours
    .filter((tour) => approvedSearchIndex ? approvedSearchIndex.has(tour.slug) : isAllowedTour(tour))
    .filter(
      (t) =>
        t.status === "published" &&
        (!requireVerification || t.isDemo || t.verifiedAt !== null),
    )
    .filter(
      (t) =>
        (!query.country || t.country === query.country) &&
        (!query.location || t.location === query.location) &&
        (!query.category || t.category === query.category),
    )
    .filter(
      (t) =>
        !q ||
        (approvedSearchIndex?.get(t.slug) ?? [...Object.values(t.title), ...Object.values(t.summary)]
          .join(" ")
          .toLocaleLowerCase())
          .includes(q),
    )
    .filter((t) => {
      const p = price(t);
      return (
        (query.minPrice === undefined || (p !== null && p >= query.minPrice)) &&
        (query.maxPrice === undefined || (p !== null && p <= query.maxPrice))
      );
    })
    .filter((t) => {
      if (!query.duration) return true;
      const d = t.durationMinutes;
      if (d === null) return false;
      return query.duration === "short"
        ? d < 180
        : query.duration === "half"
          ? d >= 180 && d < 360
          : query.duration === "full"
            ? d >= 360 && d <= 720
            : d > 720;
    });
  filtered.sort((a, b) => {
    if (query.sort === "price-asc" || query.sort === "price-desc") {
      const ap = price(a),
        bp = price(b);
      if (ap === null) return bp === null ? 0 : 1;
      if (bp === null) return -1;
      return query.sort === "price-asc" ? ap - bp : bp - ap;
    }
    if (query.sort === "duration")
      return (a.durationMinutes ?? Infinity) - (b.durationMinutes ?? Infinity);
    return (
      Number(b.featured) - Number(a.featured) || a.slug.localeCompare(b.slug)
    );
  });
  return {
    items: filtered.slice(
      (query.page - 1) * query.pageSize,
      query.page * query.pageSize,
    ),
    total: filtered.length,
  };
}
export function queryLink(locale: string, query: TourQuery, page: number) {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (
      !["locale", "pageSize", "page", "invalid"].includes(key) &&
      value !== undefined &&
      value !== ""
    )
      p.set(key, String(value));
  p.set("page", String(page));
  return `/${locale}/tours?${p}`;
}
