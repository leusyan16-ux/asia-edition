import type { Tour } from "./model";
const quantity = (
  n: number,
  unit: "hour" | "minute" | "day",
  locale: "ru" | "en",
) =>
  new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-GB", {
    style: "unit",
    unit,
    unitDisplay: "long",
    maximumFractionDigits: 2,
  }).format(n);
export function sourceInformationFacts(document: {
  highlights: Tour["highlights"];
  externalProduct?: { source_metadata?: Record<string, unknown> } | null;
}) {
  const meta = document.externalProduct?.source_metadata;
  const original = meta?.original;
  const raw =
    original && typeof original === "object" && !Array.isArray(original)
      ? String(
          (original as Record<string, unknown>).duration_and_features_text ??
            "",
        )
      : "";
  const m =
    /^\s*(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*(годин(?:а|и|у)?|хвилин(?:а|и|у)?|день|дні|днів|hours?|minutes?|days?)(?:\s*(?:•|$))/iu.exec(
      raw,
    );
  let duration: Tour["title"] | undefined;
  if (m) {
    const unit = /год|hour/i.test(m[3])
      ? "hour"
      : /хвил|minute/i.test(m[3])
        ? "minute"
        : "day";
    const from = Number(m[1].replace(",", ".")),
      to = m[2] ? Number(m[2].replace(",", ".")) : null;
    if (from > 0 && (!to || to >= from))
      duration = {
        ru: to
          ? `${from}–${quantity(to, unit, "ru")}`
          : quantity(from, unit, "ru"),
        en: to
          ? `${from}–${quantity(to, unit, "en")}`
          : quantity(from, unit, "en"),
      };
  }
  const format = /приватна група|приватная группа|private group/iu.test(raw)
    ? { ru: "Частная группа", en: "Private group" }
    : /мала група|небольшая группа|small group/iu.test(raw)
      ? { ru: "Небольшая группа", en: "Small group" }
      : undefined;
  const pickupMentioned =
    /доступний трансфер|hotel pickup|pickup available/iu.test(raw)
      ? (true as const)
      : undefined;
  return {
    duration,
    format,
    pickupMentioned,
    highlights: {
      ru: document.highlights.ru.slice(0, 10),
      en: document.highlights.en.slice(0, 10),
    },
  };
}
