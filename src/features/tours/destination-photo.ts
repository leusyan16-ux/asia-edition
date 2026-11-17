import { countries, type Locale } from "@/lib/catalog";

/** Contextual country photography is never presented as evidence of a tour itinerary. */
export function destinationPhoto(countrySlug: string, locale: Locale) {
  const country = countries.find((c) => c.slug === countrySlug);
  if (!country || country.image.endsWith(".svg")) return undefined;
  return {
    src: country.image,
    alt:
      locale === "ru"
        ? `Пейзаж направления: ${country.name.ru}`
        : `Destination view: ${country.name.en}`,
    label:
      locale === "ru"
        ? `Фото направления · ${country.name.ru}`
        : `Destination photo · ${country.name.en}`,
  };
}
