import Link from "next/link";
import { countries, type Locale } from "@/lib/catalog";
import type { Tour, TourTaxonomy } from "../model";
import { TourGallery } from "./gallery";
import { PreviewTourPrice, TourCards, money } from "./cards";
import { commerceEnabled } from "@/features/commerce/config";
import { AddToRequest, FavoriteButton } from "@/features/commerce/components";
import { visitorGuidance } from "../visitor-guidance";
import { destinationPhoto } from "../destination-photo";
import { TourPhoto } from "./photo";
export function InformationTourDetail({
  tour,
  locale,
  taxonomy,
  related,
  bookingContactEnabled,
}: {
  tour: Tour;
  locale: Locale;
  taxonomy: TourTaxonomy;
  related: Tour[];
  bookingContactEnabled: boolean;
}) {
  const ru = locale === "ru",
    country = countries.find((c) => c.slug === tour.country),
    location = taxonomy.locations.find(
      (l) => l.slug === tour.location && l.country === tour.country,
    ),
    category = taxonomy.categories.find((c) => c.slug === tour.category),
    facts = tour.informationFacts;
  const guidance = visitorGuidance(tour);
  const fallback = destinationPhoto(tour.country, locale);
  const faq = ru
    ? [
        [
          "Как выбрать дату и вариант программы?",
          "Укажите желаемую дату, число взрослых и детей и интересующий вариант в заявке. До оформления необходимо согласовать доступность, время начала и окончательную стоимость.",
        ],
        [
          "Что входит в выбранный вариант?",
          "Питание, трансфер, входные билеты и дополнительные занятия зависят от программы и пакета. Уточните состав услуг перед оформлением; неуказанные услуги не следует считать включёнными.",
        ],
        [
          "Как узнать место встречи и правила отмены?",
          "Запросите точный адрес или условия встречи в отеле, время возвращения и правила отмены для выбранного варианта до оплаты. Заявка сама по себе не подтверждает бронирование.",
        ],
      ]
    : [
        [
          "How do I choose a date and an activity option?",
          "Include your preferred date, number of adults and children, and activity option in your request. Availability, start time and the final price need to be agreed before booking.",
        ],
        [
          "What is included in my option?",
          "Meals, transfers, entry tickets and additional activities depend on the selected programme and package. Check the inclusions before booking; unspecified services should not be assumed to be included.",
        ],
        [
          "Where do we meet and what are the cancellation terms?",
          "Ask for the meeting address or hotel pickup arrangements, return time and cancellation terms for your selected option before paying. Sending a request does not confirm a reservation.",
        ],
      ];
  return (
    <article className="tour-detail editorial-detail">
      <div className="tour-shell">
        <nav
          className="breadcrumbs"
          aria-label={ru ? "Навигация" : "Breadcrumbs"}
        >
          <Link href={`/${locale}/tours`}>
            {ru ? "Все экскурсии" : "All activities"}
          </Link>
          <span>/</span>
          <Link href={`/${locale}/countries/${tour.country}`}>
            {country?.name[locale]}
          </Link>
          <span>/</span>
          <span>{location?.name[locale]}</span>
        </nav>
        <header className="editorial-heading">
          <h1>{tour.title[locale]}</h1>
          <div className="activity-meta">
            <span>{category?.name[locale]}</span>
            {facts?.duration && <span>{facts.duration[locale]}</span>}
            {facts?.format && <span>{facts.format[locale]}</span>}
          </div>
          {bookingContactEnabled && (
            <a className="primary-button" href="#booking-request-title">
              {ru ? "Уточнить детали поездки" : "Ask about this activity"}
            </a>
          )}
        </header>
        {tour.images.length > 0 ? (
          <TourGallery
            images={tour.images}
            locale={locale}
            fallbackImage={fallback}
          />
        ) : (
          fallback && (
            <figure className="destination-context-photo">
              <TourPhoto
                src={fallback.src}
                alt={fallback.alt}
                contextLabel={fallback.label}
                resolution="detail"
                fill
                sizes="(max-width:750px) 100vw, 85vw"
                priority
              />
            </figure>
          )
        )}
        <nav
          className="activity-sections"
          aria-label={ru ? "Разделы экскурсии" : "Activity sections"}
        >
          {tour.description[locale].length > 0 && (
            <a href="#activity-overview">{ru ? "Об экскурсии" : "Overview"}</a>
          )}
          {Boolean(facts?.highlights[locale].length) && (
            <a href="#activity-highlights">{ru ? "Главное" : "Highlights"}</a>
          )}
          <a href="#activity-prepare">
            {ru ? "Перед поездкой" : "Before you go"}
          </a>
          <a href="#activity-questions">{ru ? "Вопросы" : "Questions"}</a>
        </nav>
        <div className="editorial-columns">
          <div className="editorial-reading">
            {tour.description[locale].length > 0 && (
              <section id="activity-overview">
                <h2>{ru ? "Об экскурсии" : "About this activity"}</h2>
                {tour.description[locale].map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </section>
            )}
            {Boolean(facts?.highlights[locale].length) && (
              <section
                id="activity-highlights"
                className="activity-content-section"
              >
                <h2>{ru ? "Главные впечатления" : "Experience highlights"}</h2>
                <ul className="activity-highlights">
                  {facts!.highlights[locale].map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </section>
            )}
            <section id="activity-prepare" className="activity-content-section">
              <h2>{ru ? "Перед поездкой" : "Before you go"}</h2>
              {guidance.length > 0 && (
                <div className="official-visitor-guidance">
                  <p>
                    {ru
                      ? "Рекомендации по посещению места. Они не определяют состав услуг и условия выбранного пакета."
                      : "Guidance for visiting the destination. It does not define the inclusions or terms of your chosen package."}
                  </p>
                  {guidance.map((g) => (
                    <div key={g.id}>
                      <ul className="activity-highlights">
                        {g.tips.map((tip, i) => (
                          <li key={i}>{tip[locale]}</li>
                        ))}
                      </ul>
                      <p className="activity-request-note">
                        {ru ? "Официальный источник: " : "Official source: "}
                        <a
                          href={g.source}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {g.publisher}
                        </a>
                        {ru ? " · Проверено " : " · Checked "}
                        <time dateTime={g.checkedAt}>30.10.2026</time>
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <p>
                {ru
                  ? "Чтобы выбрать подходящий вариант, подготовьте желаемую дату, состав группы и важные для вас пожелания. Программа и набор услуг могут отличаться между пакетами одной активности."
                  : "To choose the right option, prepare your preferred date, group size and any important preferences. Programmes and services may differ between packages for the same activity."}
              </p>
              <ul className="activity-highlights">
                <li>
                  {ru
                    ? "Уточните точку встречи, время начала и возвращения."
                    : "Check the meeting point, start time and return arrangements."}
                </li>
                <li>
                  {ru
                    ? "Сообщите о детях, ограничениях подвижности и других индивидуальных потребностях."
                    : "Mention children, mobility requirements and other individual needs."}
                </li>
                <li>
                  {ru
                    ? "До оформления согласуйте выбранный пакет, состав услуг и правила отмены."
                    : "Agree on the package, inclusions and cancellation terms before booking."}
                </li>
              </ul>
            </section>
            <section
              id="activity-questions"
              className="activity-content-section"
            >
              <h2>{ru ? "Частые вопросы" : "Frequently asked questions"}</h2>
              {faq.map(([q, a]) => (
                <details className="activity-faq" key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </section>
          </div>
          <aside className="editorial-facts activity-facts">
            <h2>{ru ? "Коротко о поездке" : "At a glance"}</h2>
            <dl>
              <div>
                <dt>{ru ? "Страна" : "Country"}</dt>
                <dd>{country?.name[locale]}</dd>
              </div>
              <div>
                <dt>{ru ? "Направление" : "Destination"}</dt>
                <dd>{location?.name[locale]}</dd>
              </div>
              <div>
                <dt>{ru ? "Тип активности" : "Activity type"}</dt>
                <dd>{category?.name[locale]}</dd>
              </div>
              {facts?.duration && (
                <div>
                  <dt>{ru ? "Продолжительность" : "Duration"}</dt>
                  <dd>{facts.duration[locale]}</dd>
                </div>
              )}
              {facts?.format && (
                <div>
                  <dt>{ru ? "Формат" : "Format"}</dt>
                  <dd>{facts.format[locale]}</dd>
                </div>
              )}
              {facts?.pickupMentioned && (
                <div>
                  <dt>{ru ? "Трансфер" : "Pickup"}</dt>
                  <dd>
                    {ru
                      ? "Есть варианты с трансфером — уточните точку и условия"
                      : "Pickup options are listed; confirm the location and conditions"}
                  </dd>
                </div>
              )}
            </dl>
            {tour.referencePrice ? (
              <div className="editorial-source">
                <strong>
                  {money(
                    tour.referencePrice.amount,
                    tour.referencePrice.currency,
                    locale,
                  )}
                </strong>
                {tour.referencePrice.verification && <p>
                  {ru ? "За взрослого. Действует до" : "Per adult. Valid through"}{" "}
                  <time dateTime={tour.referencePrice.verification.validUntil}>{tour.referencePrice.verification.validUntil}</time>.
                </p>}
                <p>
                  {ru
                    ? "Цена по каталогу. Итоговая стоимость зависит от даты и выбранного пакета."
                    : "Catalog price. The final price depends on your date and selected package."}
                </p>
              </div>
            ) : tour.previewPrice && (
              <div className="editorial-source">
                <PreviewTourPrice price={tour.previewPrice} locale={locale} showSources />
              </div>
            )}
            {bookingContactEnabled && (
              <>
                <a className="primary-button" href="#booking-request-title">
                  {ru ? "Уточнить детали поездки" : "Ask about this activity"}
                </a>
                <p className="activity-request-note">
                  {ru
                    ? "Стоимость и места согласовываются отдельно. Оплата на сайте не взимается."
                    : "Pricing and availability are arranged separately. No payment is taken on this website."}
                </p>
              </>
            )}
            {commerceEnabled() && (
              <a className="primary-button" href={`#activity-request-${tour.slug}`}>
                {ru ? "Выбрать дату и участников" : "Choose date and guests"}
              </a>
            )}
            {!bookingContactEnabled && !commerceEnabled() && (
              <p className="activity-request-note">
                {ru
                  ? "Бронирование и оплата пока недоступны."
                  : "Booking and payment are currently unavailable."}
              </p>
            )}
          </aside>
        </div>
        {commerceEnabled() && (
          <>
            <FavoriteButton slug={tour.slug} locale={locale} />
            <AddToRequest slug={tour.slug} locale={locale} />
          </>
        )}
        {related.length > 0 && (
          <section className="activity-content-section">
            <h2>
              {ru ? "Ещё в этом направлении" : "More in this destination"}
            </h2>
            <TourCards items={related} locale={locale} />
          </section>
        )}
      </div>
    </article>
  );
}
