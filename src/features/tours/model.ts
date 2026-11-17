import { z } from "zod";

export const localText = z.object({ ru: z.string(), en: z.string() });
const safeImage = z
  .string()
  .refine(
    (value) =>
      /^\/images\/[a-z0-9./_-]+$/i.test(value) || /^https:\/\//.test(value),
    "Use a local image or an HTTPS URL",
  );
export const priceSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    adult: z.number().nonnegative().nullable(),
    child: z.number().nonnegative().nullable(),
    childMinAge: z.number().int().min(0).nullable(),
    childMaxAge: z.number().int().min(0).nullable(),
  })
  .refine(
    (p) =>
      p.childMinAge === null ||
      p.childMaxAge === null ||
      p.childMinAge <= p.childMaxAge,
    "Invalid child age range",
  );
export const tourSchema = z.object({
  informationOnly: z.literal(true).optional(),
  informationFacts: z
    .object({
      duration: localText.optional(),
      format: localText.optional(),
      pickupMentioned: z.literal(true).optional(),
      highlights: z.object({
        ru: z.array(z.string().min(1)).max(10),
        en: z.array(z.string().min(1)).max(10),
      }),
    })
    .optional(),
  referencePrice: z
    .object({
      amount: z.number().positive(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      sourceUrl: z.string().url(),
      capturedAt: z.iso.datetime(),
      verification: z.object({
        verifiedAt: z.iso.datetime({ offset: true }),
        validFrom: z.iso.date(),
        validUntil: z.iso.date(),
      }).optional(),
    })
    .optional(),
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  country: z.enum([
    "thailand",
    "vietnam",
    "china",
    "turkey",
    "united-arab-emirates",
    "indonesia",
    "sri-lanka",
    "maldives",
    "india",
    "malaysia",
    "philippines",
    "south-korea",
    "japan",
    "singapore",
    "brunei",
    "cambodia",
    "laos",
    "myanmar",
    "timor-leste",
  ]),
  location: z.string(),
  category: z.string(),
  routeCountries: z.array(z.string().max(80)).max(30).default([]),
  status: z.enum(["draft", "published", "unavailable"]),
  isDemo: z.boolean(),
  verifiedAt: z.string().nullable(),
  featured: z.boolean(),
  title: localText,
  summary: localText,
  description: z.object({ ru: z.array(z.string()), en: z.array(z.string()) }),
  highlights: z.object({ ru: z.array(z.string()), en: z.array(z.string()) }),
  images: z.array(z.object({ url: safeImage, alt: localText })),
  durationMinutes: z.number().int().positive().nullable(),
  transportation: localText.nullable(),
  languages: z.array(z.string()),
  schedule: localText.nullable(),
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA timezone"),
  departures: z
    .array(
      z.object({
        weekdays: z.array(z.number().int().min(0).max(6)),
        time: z.string(),
        validFrom: z.iso.date(),
        validUntil: z.iso.date(),
      }),
    )
    .default([]),
  pickupLocations: z
    .array(
      z.object({
        name: localText,
        address: localText,
        location: z.string(),
        instructions: localText.nullable(),
      }),
    )
    .default([]),
  meetingPoints: z
    .array(
      z.object({
        name: localText,
        address: localText,
        lat: z.number().min(-90).max(90).nullable(),
        lng: z.number().min(-180).max(180).nullable(),
      }),
    )
    .default([]),
  itinerary: z.array(
    z.object({
      title: localText,
      description: localText,
      durationMinutes: z.number().int().nonnegative().nullable(),
    }),
  ),
  inclusions: z.object({ ru: z.array(z.string()), en: z.array(z.string()) }),
  exclusions: z.object({ ru: z.array(z.string()), en: z.array(z.string()) }),
  meeting: localText.nullable(),
  pickup: localText.nullable(),
  coordinates: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .nullable(),
  prices: z.array(priceSchema),
  availability: z.array(
    z.object({
      date: z.iso.date(),
      remaining: z.number().int().nonnegative(),
      status: z.enum(["available", "sold_out", "closed"]),
    }),
  ),
  cancellation: localText.nullable(),
  bookingConditions: localText.nullable(),
  faq: z.array(z.object({ question: localText, answer: localText })),
  operator: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  seo: z.object({ title: localText, description: localText }),
  updatedAt: z.string(),
});
export type PreviewPrice = {
  amount: number;
  upper?: number;
  groupMax?: number;
  from?: boolean;
  benchmark?: { currency: string; unit: "person" | "vehicle"; sources: string[] };
  budget?: { low: number; high: number; sample: number; broad: boolean };
};
export type Tour = z.infer<typeof tourSchema> & { previewPrice?: PreviewPrice };
export type TourPrice = z.infer<typeof priceSchema>;
export type TourQuery = {
  country?: string;
  location?: string;
  category?: string;
  search?: string;
  currency?: string;
  minPrice?: number;
  maxPrice?: number;
  duration?: "short" | "half" | "full" | "multi";
  sort?: "featured" | "price-asc" | "price-desc" | "duration";
  page: number;
  pageSize: number;
  locale: "ru" | "en";
  invalid?: boolean;
};
export type TourPage = { items: Tour[]; total: number };
export type TourTaxonomy = {
  locations: {
    slug: string;
    country: string;
    name: { ru: string; en: string };
  }[];
  categories: { slug: string; name: { ru: string; en: string } }[];
};
export interface TourRepository {
  list(query: TourQuery): Promise<TourPage>;
  bySlug(slug: string): Promise<Tour | null>;
  taxonomy(): Promise<TourTaxonomy>;
}
