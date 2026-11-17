import { z } from "zod";
import { isAllowedTour } from "@/lib/geography";
import { externalProductSchema } from "./external-model";
import {
  tourSchema,
  priceSchema,
  type TourTaxonomy,
} from "@/features/tours/model";

export const adminDocumentSchema = tourSchema.extend({
  externalProduct: externalProductSchema.nullable().default(null),
  archived: z.boolean().default(false),
  visible: z.boolean().default(true),
  city: z.string().max(120).nullable().default(null),
  resort: z.string().max(120).nullable().default(null),
  prices: z
    .array(
      priceSchema.safeExtend({
        validFrom: z.iso.date().nullable().default(null),
        validUntil: z.iso.date().nullable().default(null),
        verifiedAt: z.iso.datetime({ offset: true }).nullable().default(null),
      }),
    )
    .max(30),
  slots: z
    .array(
      z.object({
        date: z.iso.date(),
        time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
        capacity: z.number().int().min(0).max(100000),
        reserved: z.number().int().min(0),
        status: z.enum(["available", "sold_out", "closed"]),
        verifiedAt: z.iso.datetime({ offset: true }).nullable(),
      }),
    )
    .max(2000)
    .default([]),
});
export const adminTourSchema = adminDocumentSchema.superRefine((t, ctx) => {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });
  for (const lang of ["ru", "en"] as const)
    if (!t.title[lang].trim())
      issue(["title", lang], `Укажите название (${lang.toUpperCase()})`);
  if (t.slug.length > 120) issue(["slug"], "Адрес слишком длинный");
  if (t.images.length > 40) issue(["images"], "Не более 40 фотографий");
  if (
    t.verifiedAt &&
    !z.iso.datetime({ offset: true }).safeParse(t.verifiedAt).success
  )
    issue(["verifiedAt"], "Некорректная дата проверки");
  if (t.archived && t.status === "published")
    issue(["status"], "Архивная экскурсия не может быть опубликована");
  t.prices.forEach((p, i) => {
    if (p.adult === null && p.child === null)
      issue(["prices", i], "Укажите хотя бы одну цену");
    if (p.validFrom && p.validUntil && p.validFrom > p.validUntil)
      issue(["prices", i], "Начало периода позже окончания");
    if (
      [p.adult, p.child].some(
        (v) =>
          v !== null &&
          (v > 9999999999.99 ||
            Math.abs(v * 100 - Math.round(v * 100)) > 0.001),
      )
    )
      issue(["prices", i], "Цена: максимум 2 знака после запятой");
  });
  if (new Set(t.prices.map((p) => p.currency)).size !== t.prices.length)
    issue(
      ["prices"],
      "Одна строка на валюту; измените действующий период в этой строке",
    );
  t.departures.forEach((d, i) => {
    if (
      !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(d.time) ||
      d.validFrom > d.validUntil ||
      !d.weekdays.length
    )
      issue(
        ["departures", i],
        "Проверьте время, дни недели и период расписания",
      );
  });
  t.slots.forEach((s, i) => {
    if (
      s.reserved > s.capacity ||
      !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s.time)
    )
      issue(["slots", i], "Проверьте вместимость, занятые места и время");
  });
  if (
    new Set(t.slots.map((s) => `${s.date}/${s.time.slice(0, 5)}`)).size !==
    t.slots.length
  )
    issue(["slots"], "Повтор даты и времени отправления");
  t.meetingPoints.forEach((p, i) => {
    if ((p.lat === null) !== (p.lng === null))
      issue(["meetingPoints", i], "Укажите обе координаты");
  });
  if (t.status === "published")
    if (
      t.externalProduct &&
      (t.externalProduct.source_status !== "active" ||
        t.externalProduct.editorial_status !== "approved" ||
        t.externalProduct.content_rights_status !== "licensed" ||
        t.externalProduct.publication_readiness !== "ready")
    )
      issue(
        ["status"],
        "Внешний продукт: требуется редакционная проверка, подтверждение прав и готовность к публикации",
      );
  if (t.status === "published")
    for (const message of missingInformation(t)) issue(["status"], message);
});
export type AdminTour = z.infer<typeof adminTourSchema>;
export const adminSummarySchema = adminDocumentSchema
  .pick({
    id: true,
    slug: true,
    country: true,
    status: true,
    archived: true,
    visible: true,
    featured: true,
    isDemo: true,
    title: true,
    updatedAt: true,
  })
  .extend({ missing: z.array(z.string()) });
export type AdminSummary = z.infer<typeof adminSummarySchema>;
export type AdminTaxonomy = Omit<TourTaxonomy, "locations"> & {
  locations: (TourTaxonomy["locations"][number] & {
    kind?: "city" | "resort" | "destination";
    parent?: string | null;
  })[];
  operators: { id: string; name: string; verifiedAt: string | null }[];
};
export function missingInformation(
  t: z.infer<typeof tourSchema>,
  verifiedOperators?: readonly string[],
): string[] {
  const errors: string[] = [];
  for (const lang of ["ru", "en"] as const) {
    if (!t.title[lang].trim()) errors.push(`Название ${lang.toUpperCase()}`);
    if (!t.description[lang].some((p) => p.trim()))
      errors.push(`Описание ${lang.toUpperCase()}`);
  }
  if (!t.images.length) errors.push("Добавьте фотографию");
  if (!t.durationMinutes) errors.push("Укажите длительность");
  if (!t.isDemo && (!t.operator || !t.verifiedAt))
    errors.push("Подтвердите оператора и дату проверки экскурсии");
  if (
    !t.isDemo &&
    t.operator &&
    verifiedOperators &&
    !verifiedOperators.includes(t.operator.id)
  )
    errors.push("Оператор ещё не проверен");
  return errors;
}
export function validateTour(
  input: unknown,
  taxonomy: AdminTaxonomy,
): AdminTour {
  const t = adminTourSchema.parse(input);
  if (t.status === "published" && !isAllowedTour(t))
    throw new Error("Публикация разрешена только для маршрутов Юго-Восточной Азии без территории РФ");
  if (
    !taxonomy.locations.some(
      (l) => l.slug === t.location && l.country === t.country,
    )
  )
    throw new Error("Направление не относится к выбранной стране");
  for (const [slug, kind] of [
    [t.city, "city"],
    [t.resort, "resort"],
  ] as const)
    if (
      slug &&
      !taxonomy.locations.some(
        (l) => l.slug === slug && l.country === t.country && l.kind === kind,
      )
    )
      throw new Error("Город или курорт не относится к выбранной стране");
  if (!taxonomy.categories.some((c) => c.slug === t.category))
    throw new Error("Неизвестная категория");
  if (t.operator) {
    const op = taxonomy.operators.find((o) => o.id === t.operator?.id);
    if (!op) throw new Error("Выберите существующего оператора");
    if (t.status === "published" && !t.isDemo && !op.verifiedAt)
      throw new Error("Оператор ещё не проверен");
    t.operator = { id: op.id, name: op.name };
  }
  if (
    t.pickupLocations.some(
      (p) =>
        !taxonomy.locations.some(
          (l) => l.slug === p.location && l.country === t.country,
        ),
    )
  )
    throw new Error("Место забора должно относиться к стране экскурсии");
  return t;
}
export function emptyTour(id: string): AdminTour {
  return {
    ...tourSchema.parse({
      id,
      slug: "new-excursion",
      country: "vietnam",
      location: "",
      category: "nature",
      status: "draft",
      isDemo: false,
      verifiedAt: null,
      featured: false,
      title: { ru: "", en: "" },
      summary: { ru: "", en: "" },
      description: { ru: [], en: [] },
      highlights: { ru: [], en: [] },
      images: [],
      durationMinutes: null,
      transportation: null,
      languages: [],
      schedule: null,
      timezone: "UTC",
      itinerary: [],
      inclusions: { ru: [], en: [] },
      exclusions: { ru: [], en: [] },
      meeting: null,
      pickup: null,
      coordinates: null,
      prices: [],
      availability: [],
      cancellation: null,
      bookingConditions: null,
      faq: [],
      operator: null,
      seo: { title: { ru: "", en: "" }, description: { ru: "", en: "" } },
      updatedAt: "",
    }),
    prices: [],
    archived: false,
    visible: true,
    city: null,
    resort: null,
    slots: [],
    externalProduct: null,
  };
}
