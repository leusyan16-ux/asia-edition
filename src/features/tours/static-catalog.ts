import {sourceInformationFacts} from "./information-facts";
import { createHash } from "node:crypto";
import { z } from "zod";
import { adminDocumentSchema } from "../admin/model";
import { localTourPayload } from "./local-catalog";
import { tourSchema, type PreviewPrice, type TourTaxonomy } from "./model";
import { selectTours } from "./query";
import { countries } from "@/lib/catalog";
import { categories } from "./labels";
import { isAllowedCountry, isAllowedTour } from "@/lib/geography";
import { editorialSummary } from "./editorial-summary";
import previewPrices from "./preview-prices.json";
import marketPrices from "./preview-market-prices.json";
import budgetPrices from "./preview-budget-prices.json";
import catalogReview from "./catalog-review.json";

// Reviews bind to the entire edited document. Reimport/edit invalidates consent.
export function publicationDigest(document: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(adminDocumentSchema.parse(document)))
    .digest("hex");
}
export const staticReviewSchema = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  publicationApproved: z.literal(true),
  imagesApproved: z.literal(true),
  geographyApproved: z.literal(true),
});
const informationScope = z.enum(["titles-editorial-text-only", "titles-source-text-images", "titles-source-details-images", "source-reference-prices-editorial", "source-details-verified-prices"]);

export const informationReviewSchema = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  scope: informationScope,
  approvedAt: z.iso.datetime(),
});
export function informationDigest(tour: unknown) {
  return createHash("sha256").update(JSON.stringify(tourSchema.parse(tour))).digest("hex");
}
export function approvedSourceImage(url: string) {
  try { const u=new URL(url);return u.protocol==='https:' && u.hostname==='cdn.getyourguide.com' && u.pathname.startsWith('/image/') && !u.username && !u.password && !u.port && !u.hash && !u.search; } catch { return false; }
}

function currentPriceWindow(price: {verifiedAt: string; validFrom: string; validUntil: string}, now: Date) {
  const today = now.toISOString().slice(0, 10);
  return Date.parse(price.verifiedAt) <= now.getTime() && price.validFrom <= today && today <= price.validUntil;
}

/** Explicitly approved information projection, independent of commercial publication.
 * Source drafts are read only; media needs its own scope, commercial data stays private.
 */
export function compileInformationCatalog(documents: unknown[], reviews: unknown[], taxonomy: TourTaxonomy, now = new Date()) {
  const approvals = new Map(reviews.map(r => { const a = informationReviewSchema.parse(r); return [a.digest, a]; }));
  const keys = new Set<string>(), slugs = new Set<string>(), ids = new Set<string>();
  const records: z.infer<typeof snapshotSchema>["records"] = [];
  const rejected: {index:number;reason:string}[] = [];
  for (const [index, document] of documents.entries()) try {
    const t = adminDocumentSchema.parse(document), e = t.externalProduct;
    const approval = approvals.get(publicationDigest(t));
    if (!approval || Date.parse(approval.approvedAt) > now.getTime()) throw Error("Explicit text publication approval missing or stale");
    if (!e || e.test_data || t.isDemo || t.archived || !t.visible || e.source_status !== "active" || !isAllowedTour(t)) throw Error("Ineligible source/geography");
    if (!taxonomy.locations.some(l=>l.slug===t.location && l.country===t.country) || !taxonomy.categories.some(c=>c.slug===t.category)) throw Error("Unknown geography/category");
    const key=JSON.stringify([e.provider,e.external_product_id]);
    if (keys.has(key)||slugs.has(t.slug)||ids.has(t.id)) throw Error("Duplicate source/slug/id");
    if (![t.title.ru,t.title.en,...t.description.ru,...t.description.en].every(s=>s.trim())) throw Error("Missing RU/EN text");
    // A published information document is not a published commercial source tour.
    const expandedScope = approval.scope === "source-reference-prices-editorial";
    const verifiedPriceScope = approval.scope === "source-details-verified-prices";
    const detailsScope=approval.scope === "titles-source-details-images" || verifiedPriceScope;
    const mediaScope = detailsScope || approval.scope === "titles-source-text-images" || expandedScope;
    const references = e.source_metadata?.image_references;
    const images = mediaScope && Array.isArray(references) ? [...new Set(references.filter((u):u is string => typeof u === 'string' && approvedSourceImage(u)))].map(url=>({url,alt:t.title})) : [];
    const description = mediaScope ? {
      ru:t.description.ru.filter(p=>!/^Программа «|Подробный маршрут и условия требуют подтверждения/u.test(p)),
      en:t.description.en.filter(p=>!/The detailed itinerary and conditions require confirmation\./u.test(p)),
    } : t.description;
    const place=taxonomy.locations.find(l=>l.slug===t.location&&l.country===t.country)!.name;
    const summary=expandedScope ? editorialSummary(t.title,place) : null;
    const raw=e.source_metadata?.original;
    const rawPrice=raw && typeof raw==='object' && !Array.isArray(raw) ? raw.display_price_text : null;
    const price=typeof rawPrice==='string' ? /^\s*(\d+(?:[.,]\d+)?)\s+([A-Z]{3})\s*$/.exec(rawPrice.replaceAll('\u00a0',' ')) : null;
    const candidates = verifiedPriceScope ? t.prices.flatMap(p => {
      const { adult, currency, verifiedAt, validFrom, validUntil } = p;
      if (!adult || !verifiedAt || !validFrom || !validUntil) return [];
      const verification = {verifiedAt, validFrom, validUntil};
      return currentPriceWindow(verification, now) ? [{amount:adult,currency,sourceUrl:e.source_url,capturedAt:e.last_synced_at,verification}] : [];
    }) : [];
    const referencePrice = candidates.length === 1 ? candidates[0]
      : expandedScope && price && Number(price[1].replace(',','.'))>0 ? {amount:Number(price[1].replace(',','.')),currency:price[2],sourceUrl:e.source_url,capturedAt:e.last_synced_at} : undefined;
    const tour = tourSchema.parse({...localTourPayload(t,true), informationOnly:true, status:"published", verifiedAt:null,
      ...(mediaScope ? {description,summary:{ru:description.ru[0]??'',en:description.en[0]??''},seo:{title:t.title,description:{ru:description.ru[0]??t.title.ru,en:description.en[0]??t.title.en}}} : {}),
      ...(summary ? {summary,description:{ru:description.ru.length?description.ru:[summary.ru],en:description.en.length?description.en:[summary.en]},seo:{title:t.title,description:summary}} : {}),
      referencePrice,
      informationFacts:detailsScope?sourceInformationFacts(t):undefined,
      images, prices:[],availability:[], durationMinutes:null,operator:null,
      itinerary:[],highlights:{ru:[],en:[]}, inclusions:{ru:[],en:[]},exclusions:{ru:[],en:[]},
      transportation:null,languages:[],schedule:null,departures:[],pickupLocations:[],meetingPoints:[],
      meeting:null,pickup:null,coordinates:null,cancellation:null,bookingConditions:null,faq:[],featured:false,
    });
    keys.add(key);slugs.add(t.slug);ids.add(t.id);
    records.push({tour,priceWindows:[],informationApproval:{scope:approval.scope,approvedAt:approval.approvedAt,digest:informationDigest(tour)}});
  } catch(e) { rejected.push({index,reason:e instanceof Error?e.message:"Invalid information document"}); }
  return {snapshot:snapshotSchema.parse({version:1,taxonomy:{...taxonomy,locations:taxonomy.locations.filter(l=>isAllowedCountry(l.country))},records}),rejected};
}
export const snapshotSchema = z.object({
  version: z.literal(1),
  taxonomy: z.object({
    locations: z.array(
      z.object({
        slug: z.string(),
        country: z.string(),
        name: z.object({ ru: z.string(), en: z.string() }),
      }),
    ),
    categories: z.array(
      z.object({
        slug: z.string(),
        name: z.object({ ru: z.string(), en: z.string() }),
      }),
    ),
  }),
  records: z.array(
    z.object({
      tour: tourSchema,
      informationApproval: z.object({
        scope: informationScope,
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        approvedAt: z.iso.datetime(),
      }).optional(),
      priceWindows: z.array(
        z.object({
          priceIndex: z.number().int().nonnegative(),
          validFrom: z.iso.date(),
          validUntil: z.iso.date(),
        }),
      ),
    }),
  ),
});
export function compileStaticCatalog(
  documents: unknown[],
  reviews: unknown[],
  taxonomy: TourTaxonomy,
  now = new Date(),
) {
  const approved = new Set(
    reviews.map((r) => staticReviewSchema.parse(r).digest),
  );
  const keys = new Set<string>(),
    slugs = new Set<string>(),
    ids = new Set<string>();
  const records: z.infer<typeof snapshotSchema>["records"] = [];
  const rejected: { index: number; reason: string }[] = [];
  for (const [index, document] of documents.entries()) {
    try {
      const t = adminDocumentSchema.parse(document),
        e = t.externalProduct;
      if (!isAllowedTour(t)) throw Error("Geography outside Southeast Asia or excluded route");
      if (
        !e || t.informationOnly ||
        e.test_data ||
        t.isDemo ||
        t.status !== "published" ||
        !t.visible ||
        t.archived ||
        !t.verifiedAt ||
        !Number.isFinite(Date.parse(t.verifiedAt)) ||
        Date.parse(t.verifiedAt) > now.getTime()
      )
        throw Error("Not a verified, explicitly published real product");
      if (
        e.source_status !== "active" ||
        e.editorial_status !== "approved" ||
        e.content_rights_status !== "licensed" ||
        e.publication_readiness !== "ready" ||
        !e.rights_evidence
      )
        throw Error("Source/editorial/rights/publication approval missing");
      if (!approved.has(publicationDigest(t)))
        throw Error("Separate publication and image approval missing or stale");
      if (
        !t.title.ru.trim() ||
        !t.title.en.trim() ||
        !t.description.ru.some((v) => v.trim()) ||
        !t.description.en.some((v) => v.trim())
      )
        throw Error("RU/EN content missing");
      if (
        !t.images.length ||
        t.images.some(
          (i) =>
            !i.url.startsWith("/images/") ||
            i.url.includes("..") ||
            i.url.startsWith("/images/admin/"),
        )
      )
        throw Error(
          "Use approved bundled public images; private and remote images cannot be exported",
        );
      if (
        !taxonomy.locations.some(
          (l) => l.slug === t.location && l.country === t.country,
        ) ||
        !taxonomy.categories.some((c) => c.slug === t.category)
      )
        throw Error("Unknown geography/category");
      const today = now.toISOString().slice(0, 10);
      t.prices = t.prices.filter(
        (p) =>
          p.verifiedAt &&
          Date.parse(p.verifiedAt) <= now.getTime() &&
          p.validFrom &&
          p.validUntil &&
          p.validFrom <= today &&
          p.validUntil >= today &&
          (p.adult !== null || p.child !== null),
      );
      if (!t.prices.length)
        throw Error(
          "Current verified price with explicit validity dates missing",
        );
      const key = JSON.stringify([e.provider, e.external_product_id]);
      if (keys.has(key) || slugs.has(t.slug) || ids.has(t.id))
        throw Error("Duplicate provider/product, slug or ID");
      keys.add(key);
      slugs.add(t.slug);
      ids.add(t.id);
      records.push({
        tour: { ...localTourPayload(t, false, today), availability: [] },
        priceWindows: t.prices.map((p, priceIndex) => ({
          priceIndex,
          validFrom: p.validFrom!,
          validUntil: p.validUntil!,
        })),
      });
    } catch (error) {
      rejected.push({
        index,
        reason: error instanceof Error ? error.message : "Invalid document",
      });
    }
  }
  return {
    snapshot: snapshotSchema.parse({ version: 1, taxonomy: { ...taxonomy, locations: taxonomy.locations.filter((l) => isAllowedCountry(l.country)) }, records }),
    rejected,
  };
}
export function staticCatalogRepository(input: unknown, now = new Date()) {
  const snapshot = snapshotSchema.parse(input),
    today = now.toISOString().slice(0, 10);
  const estimates: Readonly<Record<string, PreviewPrice>> = previewPrices;
  const budgets: Readonly<Record<string, PreviewPrice>> = budgetPrices;
  const showPreviewPrices = process.env.VERCEL_ENV === "preview" && process.env.COMMERCE_ENVIRONMENT === "staging";
  const market = new Map<string, PreviewPrice>();
  if (showPreviewPrices) {
    for (const { ids, amount, upper, from, currency, unit, sources } of marketPrices) {
      for (const id of ids) market.set(`getyourguide-${id}`, {
        amount, upper, from,
        benchmark: { currency, unit: unit === "vehicle" ? "vehicle" : "person", sources },
      });
    }
  }
  const tours = snapshot.records
    .filter(r=>!catalogReview.hidden.some(item=>item.slug===r.tour.slug))
    .filter((r) => isAllowedTour(r.tour))
    .filter(
      (r) =>
        r.tour.status === "published" && !r.tour.isDemo &&
        (r.tour.informationOnly
          ? r.informationApproval &&
            r.informationApproval.digest === informationDigest(r.tour) &&
            Date.parse(r.informationApproval.approvedAt) <= now.getTime() &&
            !r.tour.prices.length &&
            (!r.tour.informationFacts || ["titles-source-details-images", "source-details-verified-prices"].includes(r.informationApproval.scope)) &&
            (r.informationApproval.scope !== "titles-editorial-text-only" ? r.tour.images.every(i=>approvedSourceImage(i.url)) : !r.tour.images.length) &&
            (!r.tour.referencePrice || r.informationApproval.scope === (r.tour.referencePrice.verification ? "source-details-verified-prices" : "source-reference-prices-editorial")) &&
            !r.tour.availability.length && r.tour.durationMinutes === null
          : r.tour.verifiedAt),
    )
    .map((r) => ({
      ...r.tour,
      previewPrice: showPreviewPrices && r.tour.informationOnly ? estimates[r.tour.slug] ?? market.get(r.tour.slug) ?? budgets[r.tour.slug] : undefined,
      referencePrice: r.tour.referencePrice?.verification && !currentPriceWindow(r.tour.referencePrice.verification, now) ? undefined : r.tour.referencePrice,
      availability: [],
      prices: r.tour.prices.filter((p, priceIndex) =>
        r.priceWindows.some(
          (w) =>
            w.priceIndex === priceIndex &&
            w.validFrom <= today &&
            w.validUntil >= today,
        ),
      ),
    }));
  const activeLocations = new Set(tours.map(t => `${t.country}/${t.location}`));
  const bySlug = new Map(tours.map(tour => [tour.slug, tour]));
  const searchIndex = new Map(tours.map(tour => [
    tour.slug,
    [...Object.values(tour.title), ...Object.values(tour.summary)].join(" ").toLocaleLowerCase(),
  ]));
  const taxonomy = {
      locations: [
        ...new Map(
          [
            ...countries.flatMap((c) =>
              c.destinations.map((d) => ({
                slug: d.slug,
                country: c.slug,
                name: d.name,
              })),
            ),
            ...snapshot.taxonomy.locations.filter((l) => isAllowedCountry(l.country)),
          ].map((l) => [`${l.country}/${l.slug}`, l]),
        ).values(),
      ].filter(l => activeLocations.has(`${l.country}/${l.slug}`)),
      categories: [
        ...new Map(
          [...categories, ...snapshot.taxonomy.categories].map((c) => [
            c.slug,
            c,
          ]),
        ).values(),
      ],
  };
  return {
    list: async (query: Parameters<typeof selectTours>[1]) =>
      selectTours(tours, query, false, searchIndex),
    bySlug: async (slug: string) => bySlug.get(slug) ?? null,
    taxonomy: async () => taxonomy,
  };
}
