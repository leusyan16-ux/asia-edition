import { createHash } from "node:crypto";
import { adminCountries as countries, type Locale, type Localized } from "@/lib/catalog";
import type { ExternalImportRecord } from "./import-engine";
import { localCategories } from "./local-taxonomy";
import type { Tour } from "../tours/model";

export const MAX_SAVED_HTML_BYTES = 16 * 1024 * 1024;
type Json = Record<string, unknown>;
const object = (v: unknown): Json =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
const list = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : v == null ? [] : [v];
function decode(value: string) {
  const entities: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,
    (raw, key: string) => {
      if (!key.startsWith("#")) return entities[key.toLowerCase()] ?? raw;
      const n =
        key[1].toLowerCase() === "x"
          ? parseInt(key.slice(2), 16)
          : parseInt(key.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : "";
    },
  );
}
const text = (v: unknown, limit = 20000) =>
  typeof v === "string"
    ? decode(
        v
          .replace(
            /<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,
            " ",
          )
          .replace(/<[^>]*>/g, " "),
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, limit)
    : "";
function attributes(tag: string) {
  const result: Record<string, string> = Object.create(null);
  for (const m of tag.matchAll(
    /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  ))
    result[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4]);
  return result;
}
function source(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(decode(value));
    if (
      u.protocol !== "https:" ||
      !["www.klook.com", "klook.com"].includes(u.hostname) ||
      u.username ||
      u.password ||
      u.port
    )
      return null;
    const match = u.pathname.match(
      /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?activity\/(\d+)(?:-[a-z0-9-]+)?\/?$/,
    );
    if (!match) return null;
    return {
      id: match[1],
      url: `https://www.klook.com${u.pathname.endsWith("/") ? u.pathname : u.pathname + "/"}`,
    };
  } catch {
    return null;
  }
}
export type SavedPageMapping = {
  source_url?: string;
  locale?: Locale;
  country?: string;
  location?: { slug: string; name: Localized };
  category?: string;
  title?: Partial<Localized>;
  description?: Partial<Localized>;
  packageTranslations?: Record<
    string,
    { title?: Partial<Localized>; description?: Partial<Localized> }
  >;
  asian_territory_verified?: boolean;
};
export function parseKlookSavedHtml(
  html: string,
  mapping: SavedPageMapping = {},
  capturedAt = new Date().toISOString(),
) {
  if (Buffer.byteLength(html, "utf8") > MAX_SAVED_HTML_BYTES)
    throw Error("HTML exceeds 16 MiB");
  const warnings: string[] = [],
    meta: Record<string, string> = Object.create(null),
    canonical: string[] = [];
  // Read inert metadata only. No script execution, resources, private API or app-state evaluation.
  const inert = html.replace(
    /<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,
    " ",
  );
  for (const m of inert.matchAll(/<(?:meta|link)\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    if (a.property || a.name)
      meta[(a.property || a.name).toLowerCase()] = a.content || "";
    if (a.rel?.toLowerCase().split(/\s+/).includes("canonical") && a.href)
      canonical.push(a.href);
  }
  const saved = html.match(/saved from url=\(\d+\)(https:\/\/[^\s<>]+)/i)?.[1];
  const sources = [...canonical, meta["og:url"], saved, mapping.source_url]
    .map(source)
    .filter((v) => v !== null);
  if (!sources.length)
    throw Error(
      "No valid Klook activity source URL; supply source_url in the local manifest",
    );
  if (new Set(sources.map((s) => s.id)).size !== 1)
    throw Error(
      "Conflicting product IDs in canonical/og:url/saved source/manifest",
    );
  const identity = sources[0];
  const documentTitle = text(
    inert.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1],
  );
  if (
    /just a moment|access denied|captcha|verify (?:you are|you're) human|attention required/i.test(
      documentTitle,
    )
  )
    throw Error("Challenge/denied page, not a product HTML export");
  const nodes: Json[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (
      attributes(m[1]).type?.toLowerCase().split(";")[0] !==
      "application/ld+json"
    )
      continue;
    try {
      const queue: unknown[] = list(JSON.parse(m[2].trim()));
      while (queue.length && nodes.length < 1000) {
        const node = object(queue.shift());
        nodes.push(node);
        queue.push(...list(node["@graph"]), ...list(node.mainEntity));
      }
    } catch {
      warnings.push("Malformed JSON-LD ignored; no JavaScript evaluated");
    }
  }
  const relevant = nodes.filter((n) =>
    list(n["@type"]).some((t) =>
      ["Product", "TouristTrip", "TouristAttraction", "Event"].includes(
        String(t),
      ),
    ),
  );
  const matched = relevant.filter(
    (n) => source(n.url || n["@id"])?.id === identity.id,
  );
  const primary =
    matched.length === 1
      ? matched[0]
      : relevant.length === 1 && !source(relevant[0].url || relevant[0]["@id"])
        ? relevant[0]
        : {};
  if (relevant.length && !Object.keys(primary).length)
    warnings.push("Ambiguous or unrelated JSON-LD entities ignored");
  const localeAttribute =
    attributes(inert.match(/<html\b[^>]*>/i)?.[0] || "").lang ||
    meta["og:locale"];
  const language = /^(ru|en)(?:[-_]|$)/i
    .exec(localeAttribute || "")?.[1]
    .toLowerCase() as Locale | undefined;
  const locale = language || mapping.locale;
  if (language && mapping.locale && language !== mapping.locale)
    throw Error("Manifest locale disagrees with saved HTML language");
  const name = text(
    primary.name ||
      meta["og:title"] ||
      inert.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1] ||
      documentTitle,
  ).replace(/\s*[-|–]\s*Klook(?: Travel)?\s*$/i, "");
  if (!name || /^klook(?:\.com)?$/i.test(name))
    throw Error(
      "No product title in saved HTML; page may be incomplete or blocked",
    );
  const description = text(
    primary.description || meta.description || meta["og:description"],
  );
  const address = object(
    primary.address ||
      object(primary.contentLocation).address ||
      object(primary.location).address,
  );
  const countryName = text(
    typeof address.addressCountry === "object"
      ? object(address.addressCountry).name
      : address.addressCountry,
  );
  const countryCodes: Record<string, string> = {
    TH: "thailand",
    VN: "vietnam",
    CN: "china",
    TR: "turkey",
    AE: "united-arab-emirates",
    ID: "indonesia",
    LK: "sri-lanka",
    MV: "maldives",
    IN: "india",
    MY: "malaysia",
    PH: "philippines",
    KR: "south-korea",
    JP: "japan",
    SG: "singapore",
      KH: "cambodia", LA: "laos", BN: "brunei", MM: "myanmar", TL: "timor-leste",
  };
  const addressCountry =
    countryCodes[countryName.toUpperCase()] ||
    countries.find((c) =>
      [c.slug, c.name.en, c.name.ru].some(
        (v) => v.toLowerCase() === countryName.toLowerCase(),
      ),
    )?.slug;
  const breadcrumbNodes = nodes.filter((n) =>
    list(n["@type"]).includes("BreadcrumbList"),
  );
  const breadcrumbs = breadcrumbNodes.flatMap((n) =>
    list(n.itemListElement).map((v) => {
      const item = object(object(v).item);
      return {
        name: text(item.name || object(v).name),
        url: String(item["@id"] || item.url || ""),
      };
    }),
  );
  const breadcrumbCountries = [
    ...new Set(
      breadcrumbs
        .filter((b) => /\/destination\/co\d+-/.test(b.url))
        .map(
          (b) =>
            countries.find((c) =>
              [c.slug, c.name.en, c.name.ru].some(
                (v) => v.toLowerCase() === b.name.toLowerCase(),
              ),
            )?.slug,
        )
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const breadcrumbCountry =
    breadcrumbCountries.length === 1 ? breadcrumbCountries[0] : undefined;
  if (
    addressCountry &&
    breadcrumbCountry &&
    addressCountry !== breadcrumbCountry
  )
    throw Error("Country conflict between address and breadcrumb");
  const extractedCountry = addressCountry || breadcrumbCountry;
  if (
    mapping.country &&
    extractedCountry &&
    mapping.country !== extractedCountry
  )
    throw Error("Manifest country disagrees with structured address");
  const country = extractedCountry || mapping.country;
  const cityCrumbs = [
    ...new Set(
      breadcrumbs
        .filter((b) => /\/destination\/c\d+-/.test(b.url))
        .map((b) => b.name)
        .filter(Boolean),
    ),
  ];
  const city =
    text(address.addressLocality) ||
    (cityCrumbs.length === 1 ? cityCrumbs[0] : "");
  const categoryLabel = text(
    typeof primary.category === "object"
      ? object(primary.category).name
      : primary.category,
  );
  const categoryAliases: Record<string, string> = {
    "theme parks": "parks",
    "water parks": "parks",
    "parks & gardens": "parks",
    "parks and gardens": "parks",
    "zoos & aquariums": "tickets",
    "observation decks": "tickets",
    "cable cars": "tickets",
    "events & shows": "shows",
    "shows & musicals": "shows",
    cruises: "sea",
    "airport transfers": "transfers",
  };
  const titleCategory = [
    [/(?:\bmuseum\b|\bмузе[йя])/i, "museums"],
    [/(?:\btransfer\b|трансфер)/i, "transfers"],
    [/(?:\bmusical\b|\bcabaret\b|\bshow\b|мюзикл|кабаре|шоу)/i, "shows"],
    [/(?:\bcruise\b|круиз)/i, "sea"],
    [/(?:\bgardens?\b|\btheme park\b|\bwaterpark\b|ботаническ)/i, "parks"],
    [
      /(?:\baquarium\b|\boceanarium\b|\bzoo\b|\bcable car\b|океанариум|зоопарк)/i,
      "tickets",
    ],
    [/(?:\btour\b|\bday trip\b|экскурси)/i, "tours"],
  ].find(([pattern]) => (pattern as RegExp).test(name))?.[1] as
    string | undefined;
  const explicitCategory =
    localCategories.find((c) =>
      [c.slug, c.name.ru, c.name.en].some(
        (v) => v.toLowerCase() === categoryLabel.toLowerCase(),
      ),
    )?.slug || categoryAliases[categoryLabel.toLowerCase()];
  const category = explicitCategory || mapping.category || titleCategory;
  const categoryOrigin = explicitCategory
    ? "source-label-mapped"
    : mapping.category
      ? "editorial-mapping"
      : titleCategory
        ? "title-inference-needs-review"
        : "missing";
  const location =
    mapping.location ||
    countries
      .find((c) => c.slug === country)
      ?.destinations.find(
        (d) =>
          city &&
          [d.name.ru, d.name.en].some(
            (v) => v.toLowerCase() === city.toLowerCase(),
          ),
      ) ||
    (city && country
      ? {
          slug: `${country}-${
            city
              .normalize("NFKD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")
              .slice(0, 75) ||
            createHash("sha256").update(city).digest("hex").slice(0, 12)
          }`,
          name: { ru: city, en: city },
        }
      : undefined);
  if (categoryOrigin === "title-inference-needs-review")
    warnings.push(
      "Category inferred from product title; editorial confirmation required",
    );
  if (
    location &&
    !mapping.location &&
    !countries.some((c) => c.destinations.some((d) => d.slug === location.slug))
  )
    warnings.push(
      "City label preserved from source; localized name needs review",
    );
  const title = { ru: mapping.title?.ru || "", en: mapping.title?.en || "" };
  const descriptions = {
    ru: mapping.description?.ru || "",
    en: mapping.description?.en || "",
  };
  if (locale) {
    if (name) title[locale] = name;
    if (description) descriptions[locale] = description;
  }
  const images: { reference: string; origin: string }[] = [];
  const image = (v: unknown, origin: string) => {
    const value =
      typeof v === "string"
        ? v
        : String(object(v).url || object(v).contentUrl || "");
    if (
      !value ||
      /(?:award|icon|logo|sprite)|\.svg(?:\?|$)/i.test(value) ||
      images.length >= 120
    )
      return;
    try {
      const u = new URL(value);
      if (
        u.protocol !== "https:" ||
        u.hostname !== "res.klook.com" ||
        u.username ||
        u.password
      )
        return;
    } catch {
      if (
        /^(?:\.?\/?[^:/]+_files\/|\.\/)/i.test(value) &&
        !value.includes("..")
      ) {
        if (!images.some((i) => i.reference === value))
          images.push({
            reference: value,
            origin: origin + ":local-saved-reference",
          });
      }
      return;
    }
    if (!images.some((i) => i.reference === value))
      images.push({ reference: value, origin });
  };
  list(primary.image).forEach((v) => image(v, "json-ld.image"));
  image(meta["og:image"], "meta.og:image");
  for (const m of inert.matchAll(/<img\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    image(a["data-src"] || a.src, "img:unverified-page-context");
  }
  const offers = list(primary.offers)
    .flatMap((o) => {
      const v = object(o);
      return list(v.offers).length ? list(v.offers) : [v];
    })
    .slice(0, 100)
    .map((o) => {
      const v = object(o);
      return {
        name: text(v.name),
        identifier: text(v.sku || v["@id"]),
        identifierMeaningUnverified: true,
        price:
          typeof v.price === "number" || typeof v.price === "string"
            ? v.price
            : null,
        lowPrice: v.lowPrice ?? null,
        highPrice: v.highPrice ?? null,
        currency: text(v.priceCurrency),
        validFrom: text(v.validFrom),
        validUntil: text(v.priceValidUntil || v.validThrough),
        url: source(v.url)?.url || null,
        priceSpecification: list(v.priceSpecification).map((p) => {
          const s = object(p);
          return {
            price: s.price ?? null,
            currency: text(s.priceCurrency),
            name: text(s.name),
          };
        }),
        verified: false,
      };
    });
  const headings = [...inert.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi)];
  const packageHeading = headings.findIndex((h) =>
    /^(?:Packages|Пакеты|Варианты пакетов)$/i.test(text(h[1])),
  );
  const start = headings[packageHeading];
  const packageSection = start
    ? inert.slice(
        start.index! + start[0].length,
        headings[packageHeading + 1]?.index,
      )
    : "";
  const packageNames = [
    ...packageSection.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3\s*>/gi),
  ]
    .slice(0, 100)
    .map((m) => text(m[1], 500));
  const visibleText = text(inert, 2 * 1024 * 1024);
  // Observed saved Klook DOM: package cards carry matching group-web-id/js-pkg-id.
  // Balance divs so a last card cannot inherit prices from the following detail panel.
  const packageCards = [
    ...inert.matchAll(/<div\b[^>]*\bid="group-web-id-(\d+)"[^>]*>/gi),
  ]
    .slice(0, 100)
    .flatMap((m) => {
      const a = attributes(m[0]);
      if (!a.class?.split(/\s+/).includes(`js-pkg-id-${m[1]}`)) return [];
      const tail = inert.slice(m.index! + m[0].length);
      let depth = 1,
        end = -1;
      for (const tag of tail.matchAll(/<\/?div\b[^>]*>/gi)) {
        depth += /^<\//.test(tag[0]) ? -1 : 1;
        if (!depth) {
          end = tag.index!;
          break;
        }
      }
      if (end < 0) return [];
      const card = tail.slice(0, end);
      const field = (className: string) =>
        text(
          card.match(
            new RegExp(
              `<div\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/div\\s*>`,
              "i",
            ),
          )?.[1],
        );
      const name = text(card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3\s*>/i)?.[1]);
      if (!name) return [];
      const priceText = field("price-block__main");
      const display = priceText.match(
        /(US\$|USD|SGD|S\$|THB|฿|VND|₫|IDR|Rp|JPY|KRW|₩|MYR|RM|EUR|GBP|AUD|CAD)\s*(\d[\d., ]*)/,
      );
      const currencyCodes: Record<string, string> = {
        US$: "USD",
        S$: "SGD",
        "฿": "THB",
        "₫": "VND",
        Rp: "IDR",
        "₩": "KRW",
        RM: "MYR",
      };
      const numeric = display?.[2].trim() || "";
      const amount = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(numeric)
        ? Number(numeric.replaceAll(",", ""))
        : null;
      return [
        {
          external_package_id: m[1],
          name,
          description: field("desc"),
          priceText,
          amount,
          currency: display ? currencyCodes[display[1]] || display[1] : null,
          retailText: text(
            card.match(
              /<span\b[^>]*class="[^"]*underline-price--strike[^"]*"[^>]*>([\s\S]*?)<\/span\s*>/i,
            )?.[1],
          ),
          conditions: [
            ...card.matchAll(
              /<span\b[^>]*class="title"[^>]*>([\s\S]*?)<\/span\s*>/gi,
            ),
          ].map((s) => text(s[1])),
          verified: false,
        },
      ];
    });
  const detailedHighlights = [
    ...inert.matchAll(
      /<h3\b[^>]*class="act-highlight-refined__title"[^>]*>([\s\S]*?)<\/h3\s*>[\s\S]*?<p\b[^>]*class="act-highlight-refined__desc"[^>]*>([\s\S]*?)<\/p\s*>/gi,
    ),
  ]
    .slice(0, 40)
    .map((m) => ({ title: text(m[1]), description: text(m[2]) }));
  for (const m of inert.matchAll(
    /<h3\b[^>]*class="highlights-content-title"[^>]*>([\s\S]*?)<\/h3\s*>\s*<div\b[^>]*class="highlights-content-desc"[^>]*>([\s\S]*?)<\/div\s*>/gi,
  )) {
    const title = text(m[1]);
    if (
      !detailedHighlights.some((h) => h.title === title) &&
      detailedHighlights.length < 40
    )
      detailedHighlights.push({ title, description: text(m[2]) });
  }
  const visiblePrices = [
    ...visibleText.matchAll(
      /(?:US\$|USD|SGD|S\$|THB|฿|VND|₫|IDR|Rp|JPY|¥|KRW|₩|MYR|RM)\s*[\d][\d.,]*/g,
    ),
  ]
    .slice(0, 100)
    .map((m) => ({ raw: m[0], verified: false }));
  const missing = [
    !name && "source title",
    !locale && "source locale",
    !title.ru && "Russian title",
    !title.en && "English title",
    !descriptions.ru && "Russian description",
    !descriptions.en && "English description",
    !country && "country",
    !location && "location mapping",
    !category && "category mapping",
    country === "turkey" &&
      !mapping.asian_territory_verified &&
      "Asian territory confirmation",
  ].filter((v): v is string => Boolean(v));
  let record: ExternalImportRecord | null = null;
  if (!missing.length && location && country)
    record = {
      provider: "klook",
      external_product_id: identity.id,
      source_url: identity.url,
      import_status: "needs_review",
      last_synced_at: capturedAt,
      test_data: false,
      product_type: "activity",
      packages: packageCards.map((p) => ({
        external_package_id: p.external_package_id,
        title: {
          ru:
            locale === "ru"
              ? p.name
              : mapping.packageTranslations?.[p.external_package_id]?.title
                  ?.ru || "",
          en:
            locale === "en"
              ? p.name
              : mapping.packageTranslations?.[p.external_package_id]?.title
                  ?.en || "",
        },
        description: {
          ru:
            locale === "ru"
              ? p.description
              : mapping.packageTranslations?.[p.external_package_id]
                  ?.description?.ru || "",
          en:
            locale === "en"
              ? p.description
              : mapping.packageTranslations?.[p.external_package_id]
                  ?.description?.en || "",
        },
        inclusions: { ru: [], en: [] },
        cancellation: null,
        prices: [],
      })),
      locations: [
        {
          slug: location.slug,
          country: country as Tour["country"],
          name: location.name,
          kind: "city",
          parent: null,
          asian_territory_verified: mapping.asian_territory_verified || false,
        },
      ],
      product: {
        slug: `klook-${identity.id}`,
        country,
        location: location.slug,
        city: location.slug,
        category,
        title,
        summary: descriptions,
        description: { ru: [descriptions.ru], en: [descriptions.en] },
        images: [],
        prices: [],
        availability: [],
        durationMinutes: null,
      },
    };
  warnings.push(
    "Prices, packages, image candidates and duration are observations only; no commercial verification or rights/publication approval granted",
  );
  return {
    record,
    observation: {
      external_product_id: identity.id,
      source_url: identity.url,
      captured_at: capturedAt,
      html_sha256: createHash("sha256").update(html).digest("hex"),
      locale: locale || null,
      title: name,
      description,
      country: extractedCountry || null,
      city,
      address: text(address.streetAddress),
      category: categoryLabel,
      normalized: {
        country: country || null,
        location: location || null,
        category: category || null,
        categoryOrigin,
        countryOrigin: addressCountry
          ? "address"
          : breadcrumbCountry
            ? "breadcrumb"
            : mapping.country
              ? "editorial-mapping"
              : "missing",
        cityOrigin: text(address.addressLocality)
          ? "address"
          : cityCrumbs.length === 1
            ? "breadcrumb"
            : mapping.location
              ? "editorial-mapping"
              : "missing",
      },
      duration:
        text(primary.duration) ||
        visibleText.match(
          /(?:Suggested duration|Рекомендуемая продолжительность)\s*[:：]?\s*([\d.,]+(?:\s*[-–]\s*[\d.,]+)?\s*(?:hour\(s\)|hours?|minutes?|ч(?:ас(?:а|ов)?)?|мин(?:ут)?))/i,
        )?.[1] ||
        "",
      offers,
      packageCards,
      detailedHighlights,
      metadataPrice: {
        amount: text(meta["product:price:amount"] || meta["og:price:amount"]),
        currency: text(
          meta["product:price:currency"] || meta["og:price:currency"],
        ),
        verified: false,
      },
      packageNames,
      visiblePrices,
      imageCandidates: images,
      missing,
      warnings,
    },
  };
}
