import { randomUUID } from "node:crypto";
import { validationError } from "./errors";
import {
  emptyTour,
  validateTour,
  type AdminTour,
  type AdminTaxonomy,
} from "./model";
export const csvColumns = [
  "slug",
  "country",
  "location",
  "city",
  "resort",
  "category",
  "title_ru",
  "title_en",
  "summary_ru",
  "summary_en",
  "description_ru",
  "description_en",
  "duration_minutes",
  "currency",
  "adult_price",
  "child_price",
  "child_min_age",
  "child_max_age",
  "timezone",
  "image_url",
  "image_alt_ru",
  "image_alt_en",
  "itinerary_json",
  "inclusions_ru",
  "inclusions_en",
  "exclusions_ru",
  "exclusions_en",
  "pickup_ru",
  "pickup_en",
  "cancellation_ru",
  "cancellation_en",
  "schedule_json",
  "slots_json",
  "operator_id",
  "featured",
  "is_demo",
  "gallery_json",
  "prices_json",
  "faq_json",
  "pickup_locations_json",
  "meeting_points_json",
  "highlights_ru",
  "highlights_en",
  "transportation_ru",
  "transportation_en",
  "meeting_ru",
  "meeting_en",
  "schedule_ru",
  "schedule_en",
  "booking_conditions_ru",
  "booking_conditions_en",
  "seo_title_ru",
  "seo_title_en",
  "seo_description_ru",
  "seo_description_en",
  "languages",
] as const;
export const csvTemplate = "\uFEFF" + csvColumns.join(",") + "\r\n";
// RFC 4180: escaped quotes, quoted newlines, CRLF, UTF-8 BOM. No spreadsheet evaluation.
export function parseCSV(
  source: string,
  maxRows = 1000,
  maxBytes = 2 * 1024 * 1024,
): string[][] {
  if (Buffer.byteLength(source) > maxBytes)
    throw new Error("CSV превышает 2 МБ");
  source = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
      continue;
    }
    if (c === '"') {
      if (value || closed) throw new Error("Кавычка вне начала поля");
      quoted = true;
    } else if (c === ",") {
      row.push(value);
      value = "";
      closed = false;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(value);
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      value = "";
      closed = false;
    } else {
      if (closed) throw new Error("Символ после закрывающей кавычки");
      value += c;
    }
  }
  if (quoted) throw new Error("Незакрытая кавычка");
  if (value || row.length || closed) {
    row.push(value);
    rows.push(row);
  }
  if (rows.length > maxRows + 1)
    throw new Error(`Не более ${maxRows} строк за один импорт`);
  return rows;
}
export type ImportRow = {
  row: number;
  slug: string;
  title: string;
  errors: string[];
  tour?: AdminTour;
};
export function previewCSV(
  source: string,
  taxonomy: AdminTaxonomy,
  existing: Pick<AdminTour, "slug">[],
): ImportRow[] {
  const rows = parseCSV(source);
  if (!rows.length) throw new Error("CSV пуст");
  const headers = rows.shift()!;
  if (new Set(headers).size !== headers.length)
    throw new Error("Повтор заголовков");
  if (
    headers.some((h) => !csvColumns.includes(h as (typeof csvColumns)[number]))
  )
    throw new Error("Неизвестная колонка. Используйте шаблон");
  for (const h of [
    "slug",
    "country",
    "location",
    "category",
    "title_ru",
    "title_en",
  ])
    if (!headers.includes(h)) throw new Error(`Отсутствует колонка ${h}`);
  const seen = new Set(existing.map((t) => t.slug));
  return rows.map((cells, index) => {
    const entry: ImportRow = {
      row: index + 2,
      slug: "",
      title: "",
      errors: [],
    };
    try {
      if (cells.length !== headers.length)
        throw new Error("Число полей не совпадает с заголовком");
      const r = Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
      entry.slug = r.slug;
      entry.title = r.title_ru;
      if (seen.has(r.slug))
        throw new Error("Такой адрес уже существует или повторяется в CSV");
      seen.add(r.slug);
      const number = (key: string) => {
        if (!r[key]) return null;
        const n = Number(r[key]);
        if (!Number.isFinite(n)) throw new Error(`Некорректное число: ${key}`);
        return n;
      };
      const lines = (key: string) =>
        (r[key] || "")
          .split(/\r?\n|\|/)
          .map((s) => s.trim())
          .filter(Boolean);
      const bool = (key: string) => {
        if (r[key] && !["true", "false"].includes(r[key]))
          throw new Error(`${key}: используйте true или false`);
        return r[key] === "true";
      };
      const json = (key: string) => {
        try {
          return r[key] ? JSON.parse(r[key]) : [];
        } catch {
          throw new Error(`Некорректный JSON: ${key}`);
        }
      };
      const t = emptyTour(randomUUID());
      const operator = taxonomy.operators.find((o) => o.id === r.operator_id);
      Object.assign(t, {
        slug: r.slug,
        country: r.country,
        location: r.location,
        city: r.city || null,
        resort: r.resort || null,
        category: r.category,
        title: { ru: r.title_ru, en: r.title_en },
        summary: { ru: r.summary_ru || "", en: r.summary_en || "" },
        description: {
          ru: lines("description_ru"),
          en: lines("description_en"),
        },
        durationMinutes: number("duration_minutes"),
        timezone: r.timezone || "UTC",
        featured: bool("featured"),
        isDemo: bool("is_demo"),
        operator: operator ? { id: operator.id, name: operator.name } : null,
        itinerary: json("itinerary_json"),
        departures: json("schedule_json"),
        slots: json("slots_json"),
        faq: json("faq_json"),
        pickupLocations: json("pickup_locations_json"),
        meetingPoints: json("meeting_points_json"),
        highlights: { ru: lines("highlights_ru"), en: lines("highlights_en") },
        languages: (r.languages || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        seo: {
          title: { ru: r.seo_title_ru || "", en: r.seo_title_en || "" },
          description: {
            ru: r.seo_description_ru || "",
            en: r.seo_description_en || "",
          },
        },
      });
      if (r.operator_id && !operator)
        throw new Error("Неизвестный operator_id");
      for (const key of ["inclusions", "exclusions"] as const)
        t[key] = { ru: lines(`${key}_ru`), en: lines(`${key}_en`) };
      for (const key of [
        "pickup",
        "cancellation",
        "transportation",
        "meeting",
        "schedule",
        "bookingConditions",
      ] as const) {
        const column = key === "bookingConditions" ? "booking_conditions" : key;
        t[key] =
          r[`${column}_ru`] || r[`${column}_en`]
            ? { ru: r[`${column}_ru`] || "", en: r[`${column}_en`] || "" }
            : null;
      }
      if (r.image_url)
        t.images = [
          {
            url: r.image_url,
            alt: { ru: r.image_alt_ru || "", en: r.image_alt_en || "" },
          },
        ];
      if (r.currency || r.adult_price || r.child_price)
        t.prices = [
          {
            currency: r.currency,
            adult: number("adult_price"),
            child: number("child_price"),
            childMinAge: number("child_min_age"),
            childMaxAge: number("child_max_age"),
            validFrom: null,
            validUntil: null,
            verifiedAt: null,
          },
        ];
      if (r.gallery_json) {
        if (r.image_url)
          throw new Error("Используйте gallery_json или image_url, не оба");
        t.images = json("gallery_json");
      }
      if (r.prices_json) {
        if (r.currency || r.adult_price || r.child_price)
          throw new Error(
            "Используйте prices_json или отдельные поля цены, не оба",
          );
        t.prices = json("prices_json");
      }
      entry.tour = validateTour(t, taxonomy);
    } catch (error) {
      entry.errors = [validationError(error)];
    }
    return entry;
  });
}
