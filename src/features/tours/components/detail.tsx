import Link from "next/link";
import { InformationTourDetail } from "./information-detail";
import { Check, Minus, Clock, Languages, MapPin, Bus } from "lucide-react";
import { countries, type Locale } from "@/lib/catalog";
import type { Tour, TourTaxonomy } from "../model";
import { tourLabels } from "../labels";
import { TourGallery } from "./gallery";
import { BookingPreview } from "./booking-preview";
import { TourCards, duration } from "./cards";
import { EditorialDetail, type EditorialContext } from "./editorial-detail";
const present = (list: string[]) => list.filter((s) => s.trim());
export function TourDetail({
  tour,
  locale,
  related,
  taxonomy,
  editorial,
  contactEnabled = false,
  bookingContactEnabled = false,
}: {
  tour: Tour;
  locale: Locale;
  related: Tour[];
  taxonomy: TourTaxonomy;
  editorial?: EditorialContext;
  contactEnabled?: boolean;
  bookingContactEnabled?: boolean;
}) {
  if (editorial)
    return (
      <EditorialDetail
        tour={tour}
        locale={locale}
        taxonomy={taxonomy}
        context={editorial}
      />
    );
  const t = tourLabels[locale],
    country = countries.find((c) => c.slug === tour.country),
    location = taxonomy.locations.find(
      (l) => l.slug === tour.location && l.country === tour.country,
    );
  if (tour.informationOnly)
    return (
      <InformationTourDetail
        tour={tour}
        locale={locale}
        taxonomy={taxonomy}
        related={related}
        bookingContactEnabled={bookingContactEnabled}
      />
    );
  const faq = tour.faq.filter(
    (f) => f.question[locale].trim() && f.answer[locale].trim(),
  );
  const itinerary = tour.itinerary.filter(
    (s) => s.title[locale].trim() || s.description[locale].trim(),
  );
  const hasMeeting =
    tour.meeting?.[locale] ||
    tour.pickup?.[locale] ||
    tour.pickupLocations.length ||
    tour.meetingPoints.length;
  const sections = [
    ["overview", t.overview, present(tour.description[locale]).length],
    ["itinerary", t.itinerary, itinerary.length],
    [
      "services",
      t.included,
      present(tour.inclusions[locale]).length +
        present(tour.exclusions[locale]).length,
    ],
    ["meeting", t.meeting, hasMeeting],
    [
      "conditions",
      t.cancellation,
      tour.cancellation?.[locale] || tour.bookingConditions?.[locale],
    ],
    ["faq", t.faq, faq.length],
  ];
  return (
    <div className="tour-detail">
      <div className="tour-shell">
        <nav
          className="breadcrumbs"
          aria-label={locale === "ru" ? "Навигационная цепочка" : "Breadcrumbs"}
        >
          <Link href={`/${locale}/tours`}>{t.openCatalog}</Link>
          <span>/</span>
          {country && (
            <>
              <Link href={`/${locale}/countries/${country.slug}`}>
                {country.name[locale]}
              </Link>
              <span>/</span>
            </>
          )}
          {location && (
            <Link
              href={`/${locale}/countries/${tour.country}/${tour.location}`}
            >
              {location.name[locale]}
            </Link>
          )}
        </nav>
        {tour.isDemo && (
          <div className="tour-demo-banner">
            <strong>{t.demo}</strong>
            <p>{t.demoNotice}</p>
          </div>
        )}
        <div className="tour-title">
          <h1>{tour.title[locale]}</h1>
          <p>{tour.summary[locale]}</p>
          <div className="tour-facts">
            {tour.durationMinutes && (
              <span>
                <Clock size={17} />
                {duration(tour.durationMinutes, locale)}
              </span>
            )}
            {tour.languages.length > 0 && (
              <span>
                <Languages size={17} />
                {tour.languages.map((l) => l.toUpperCase()).join(" / ")}
              </span>
            )}
            {location && (
              <span>
                <MapPin size={17} />
                {location.name[locale]}
              </span>
            )}
          </div>
        </div>
        <TourGallery images={tour.images} locale={locale} />
        <div className="tour-content-grid">
          <div className="tour-prose">
            <nav className="tour-section-nav" aria-label={t.overview}>
              {sections
                .filter((s) => s[2])
                .map((s) => (
                  <a key={String(s[0])} href={`#${s[0]}`}>
                    {s[1]}
                  </a>
                ))}
            </nav>
            {present(tour.highlights[locale]).length > 0 && (
              <section>
                <h2>{t.highlights}</h2>
                <ul className="highlight-list">
                  {present(tour.highlights[locale]).map((h) => (
                    <li key={h}>
                      <Check size={19} />
                      {h}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {present(tour.description[locale]).length > 0 && (
              <section id="overview">
                <h2>{t.overview}</h2>
                {present(tour.description[locale]).map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </section>
            )}
            {(tour.transportation?.[locale] ||
              tour.schedule?.[locale] ||
              tour.departures.length > 0) && (
              <section className="practical-info">
                {tour.transportation?.[locale] && (
                  <div>
                    <Bus size={20} />
                    <div>
                      <h3>{t.transport}</h3>
                      <p>{tour.transportation[locale]}</p>
                    </div>
                  </div>
                )}
                {(tour.schedule?.[locale] || tour.departures.length > 0) && (
                  <div>
                    <Clock size={20} />
                    <div>
                      <h3>{t.schedule}</h3>
                      {tour.schedule?.[locale] && (
                        <p>{tour.schedule[locale]}</p>
                      )}
                      {tour.departures.map((d, i) => (
                        <p key={i}>
                          {d.weekdays
                            .map((day) =>
                              new Intl.DateTimeFormat(locale, {
                                weekday: "short",
                                timeZone: "UTC",
                              }).format(new Date(Date.UTC(2026, 0, 4 + day))),
                            )
                            .join(", ")}{" "}
                          · {d.time.slice(0, 5)} · {d.validFrom} —{" "}
                          {d.validUntil}
                        </p>
                      ))}
                      <small>{tour.timezone}</small>
                    </div>
                  </div>
                )}
              </section>
            )}
            {itinerary.length > 0 && (
              <section id="itinerary">
                <h2>{t.itinerary}</h2>
                <ol className="itinerary">
                  {itinerary.map((step, i) => (
                    <li key={i}>
                      <span className="itinerary-number">{i + 1}</span>
                      <div>
                        <h3>{step.title[locale]}</h3>
                        {step.durationMinutes !== null &&
                          step.durationMinutes > 0 && (
                            <small>
                              {duration(step.durationMinutes, locale)}
                            </small>
                          )}
                        <p>{step.description[locale]}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {(present(tour.inclusions[locale]).length > 0 ||
              present(tour.exclusions[locale]).length > 0) && (
              <section id="services" className="services-grid">
                {[
                  {
                    label: t.included,
                    items: tour.inclusions[locale],
                    Icon: Check,
                  },
                  {
                    label: t.excluded,
                    items: tour.exclusions[locale],
                    Icon: Minus,
                  },
                ]
                  .filter((s) => present(s.items).length)
                  .map((s) => (
                    <div key={s.label}>
                      <h2>{s.label}</h2>
                      <ul>
                        {present(s.items).map((item) => (
                          <li key={item}>
                            <s.Icon size={17} />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </section>
            )}
            {Boolean(hasMeeting) && (
              <section id="meeting">
                <h2>{t.meeting}</h2>
                {tour.meeting?.[locale] && (
                  <>
                    <h3>{t.point}</h3>
                    <p>{tour.meeting[locale]}</p>
                  </>
                )}
                {tour.coordinates && (
                  <a
                    className="text-link"
                    href={`https://www.openstreetmap.org/?mlat=${tour.coordinates.lat}&mlon=${tour.coordinates.lng}#map=16/${tour.coordinates.lat}/${tour.coordinates.lng}`}
                  >
                    {locale === "ru" ? "Открыть карту" : "Open map"}
                    <MapPin size={16} />
                  </a>
                )}
                {tour.meetingPoints.map((p, i) => (
                  <div key={i}>
                    <h3>{p.name[locale]}</h3>
                    <p>{p.address[locale]}</p>
                    {p.lat !== null && p.lng !== null && (
                      <a
                        className="text-link"
                        href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}`}
                      >
                        {locale === "ru" ? "Открыть карту" : "Open map"}
                      </a>
                    )}
                  </div>
                ))}
                {tour.pickup?.[locale] && (
                  <>
                    <h3>{t.pickup}</h3>
                    <p>{tour.pickup[locale]}</p>
                  </>
                )}
                {tour.pickupLocations.map((p, i) => (
                  <div key={i}>
                    <h3>{p.name[locale]}</h3>
                    <p>{p.address[locale]}</p>
                    {p.instructions?.[locale] && (
                      <p>{p.instructions[locale]}</p>
                    )}
                  </div>
                ))}
              </section>
            )}
            {(tour.cancellation?.[locale] ||
              tour.bookingConditions?.[locale]) && (
              <section id="conditions">
                <h2>{t.cancellation}</h2>
                {tour.cancellation?.[locale] && (
                  <p>{tour.cancellation[locale]}</p>
                )}
                {tour.bookingConditions?.[locale] && (
                  <>
                    <h3>{t.conditions}</h3>
                    <p>{tour.bookingConditions[locale]}</p>
                  </>
                )}
              </section>
            )}
            {faq.length > 0 && (
              <section id="faq">
                <h2>{t.faq}</h2>
                {faq.map((f, i) => (
                  <details className="tour-faq" key={i}>
                    <summary>{f.question[locale]}</summary>
                    <p>{f.answer[locale]}</p>
                  </details>
                ))}
              </section>
            )}
            {tour.operator && (
              <section>
                <h2>{t.supplier}</h2>
                <p>{tour.operator.name}</p>
              </section>
            )}
          </div>
          <BookingPreview
            tour={tour}
            locale={locale}
            contactEnabled={contactEnabled}
          />
        </div>
        {related.length > 0 && (
          <section className="related-tours">
            <h2>{t.related}</h2>
            <TourCards items={related} locale={locale} />
          </section>
        )}
      </div>
    </div>
  );
}
