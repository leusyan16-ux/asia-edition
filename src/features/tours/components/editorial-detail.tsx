import { isAllowedCountry } from "@/lib/geography";
import Link from "next/link";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { adminCountries as countries, type Locale } from "@/lib/catalog";
import type { Tour, TourTaxonomy } from "../model";

export type EditorialContext = {
  city: string | null;
  sourceUrl: string;
  checkedOn: string;
};
const labels = {
  ru: {
    catalog: "Каталог",
    about: "Об объекте",
    facts: "Сведения об объекте",
    country: "Страна",
    city: "Город",
    category: "Категория",
    venue: "Объект / направление",
    kind: "Информационная карточка",
    draft: "Не опубликовано",
    notice:
      "Редакционный материал ASIA EDITION. Эта карточка знакомит с объектом или активностью и не является предложением бронирования.",
    source: "Официальный источник",
    checked: "Дата снимка источника",
    sourceNote:
      "Источник подтверждает сведения об объекте. Коммерческие условия и право продажи услуг не подтверждены.",
    noPhoto: "Без фотографии",
    photoNote:
      "В карточке используются только текстовые сведения; изображение не добавлено.",
    back: "Вернуться в каталог",
  },
  en: {
    catalog: "Catalog",
    about: "About this place",
    facts: "Place information",
    country: "Country",
    city: "City",
    category: "Category",
    venue: "Place / destination",
    kind: "Information card",
    draft: "Unpublished",
    notice:
      "An ASIA EDITION editorial reference. This card introduces a place or activity and is not a booking offer.",
    source: "Official source",
    checked: "Source snapshot date",
    sourceNote:
      "The source supports facts about the place. Commercial terms and permission to sell services have not been confirmed.",
    noPhoto: "Without photography",
    photoNote:
      "This entry uses textual information only; no image has been added.",
    back: "Return to catalog",
  },
};

export function EditorialDetail({
  tour,
  locale,
  taxonomy,
  context,
}: {
  tour: Tour;
  locale: Locale;
  taxonomy: TourTaxonomy;
  context: EditorialContext;
}) {
  const t = labels[locale];
  const country = countries.find((c) => c.slug === tour.country);
  const venue = taxonomy.locations.find(
    (l) => l.slug === tour.location && l.country === tour.country,
  );
  const city = taxonomy.locations.find(
    (l) => l.slug === context.city && l.country === tour.country,
  );
  const category = taxonomy.categories.find((c) => c.slug === tour.category);
  const facts = [
    { label: t.country, value: country?.name[locale] },
    { label: t.city, value: city?.name[locale] },
    { label: t.category, value: category?.name[locale] },
    { label: t.venue, value: venue?.name[locale] },
  ].filter((f) => f.value?.trim());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(context.checkedOn)
    ? new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
        dateStyle: "long",
        timeZone: "UTC",
      }).format(new Date(context.checkedOn + "T00:00:00Z"))
    : null;
  const paragraphs = tour.description[locale].filter((p) => p.trim());
  return (
    <article className="tour-detail editorial-detail" lang={locale}>
      <div className="tour-shell">
        <nav
          className="breadcrumbs"
          aria-label={locale === "ru" ? "Навигационная цепочка" : "Breadcrumbs"}
        >
          <Link href={`/${locale}/tours`}>{t.catalog}</Link>
          {country && (
            <>
              <span aria-hidden="true">/</span>
              {isAllowedCountry(country.slug) ? <Link href={`/${locale}/countries/${country.slug}`}>{country.name[locale]}</Link> : <span>{country.name[locale]}</span>}
            </>
          )}
          {venue && (
            <>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{venue.name[locale]}</span>
            </>
          )}
        </nav>
        <header className="editorial-heading">
          <h1>{tour.title[locale]}</h1>
          <div className="editorial-status">
            <span>
              <BookOpen size={17} aria-hidden="true" />
              {t.kind}
            </span>
            {tour.status !== "published" && <span>{t.draft}</span>}
          </div>
          <p className="editorial-intro">{t.notice}</p>
        </header>
        <div className="editorial-columns">
          <div className="editorial-reading">
            {paragraphs.length > 0 && (
              <section aria-labelledby="editorial-about">
                <h2 id="editorial-about">{t.about}</h2>
                {paragraphs.map((p, i) => (
                  <p
                    key={i}
                    className={
                      p === tour.summary[locale]
                        ? "editorial-annotation"
                        : undefined
                    }
                  >
                    {p}
                  </p>
                ))}
              </section>
            )}
            {!tour.images.length && (
              <div className="editorial-media-note">
                <strong>{t.noPhoto}</strong>
                <p>{t.photoNote}</p>
              </div>
            )}
          </div>
          <aside
            className="editorial-facts"
            aria-labelledby="editorial-facts-title"
          >
            <h2 id="editorial-facts-title">{t.facts}</h2>
            <dl>
              {facts.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
            <div className="editorial-source">
              <a
                href={context.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.source}
                <ArrowUpRight size={18} aria-hidden="true" />
              </a>
              {date && (
                <p>
                  {t.checked}
                  <br />
                  <time dateTime={context.checkedOn}>{date}</time>
                </p>
              )}
              <p>{t.sourceNote}</p>
            </div>
          </aside>
        </div>
      </div>
    </article>
  );
}
