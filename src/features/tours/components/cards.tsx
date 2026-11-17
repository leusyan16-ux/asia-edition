import Link from "next/link";
import { TourPhoto as Image } from "./photo";
import { ArrowUpRight, Clock, MapPin } from "lucide-react";
import { countries, type Locale } from "@/lib/catalog";
import type { Tour } from "../model";
import { tourLabels } from "../labels";
import { destinationPhoto } from "../destination-photo";
import { commerceEnabled } from "@/features/commerce/config";
import { FavoriteButton } from "@/features/commerce/favorite-button";
export function money(value: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
export function duration(value: number, locale: Locale) {
  const t = tourLabels[locale];
  return `${Math.floor(value / 60) ? `${Math.floor(value / 60)} ${t.hours}` : ""}${value % 60 ? ` ${value % 60} ${t.minutes}` : ""}`.trim();
}
export function PreviewTourPrice({ price, locale }: { price: NonNullable<Tour["previewPrice"]>; locale: Locale; showSources?: boolean }) {
  const ru = locale === "ru";
  const currency = price.benchmark?.currency ?? "USD";
  return <>
    <strong>{price.from ? (ru ? "От " : "From ") : ""}{money(price.amount, currency, locale)}
      {price.upper !== undefined && ` – ${money(price.upper, currency, locale)}`}</strong>
    {price.benchmark && <span>{price.benchmark.unit === "vehicle" ? (ru ? "За автомобиль" : "Per vehicle") : (ru ? "На человека" : "Per person")}</span>}
    {price.groupMax && <span>{ru ? `За группу до ${price.groupMax} человек` : `Per group of up to ${price.groupMax}`}</span>}
  </>;
}
export function TourCards({
  items,
  locale,
  currency = "USD",
}: {
  items: Tour[];
  locale: Locale;
  currency?: string;
}) {
  const t = tourLabels[locale];
  return (
    <div className="tour-grid">
      {items.map((tour) => {
        const price =
          tour.prices.find((p) => p.currency === currency) ?? tour.prices[0];
        const country = countries.find((c) => c.slug === tour.country);
        const fallback = destinationPhoto(tour.country, locale);
        return (
          <article className="tour-card" key={tour.id}>
            {commerceEnabled()&&<FavoriteButton slug={tour.slug} locale={locale} compact/>}
            <Link
              href={`/${locale}/tours/${tour.slug}`}
              className="tour-card-image"
              aria-label={`${t.view}: ${tour.title[locale]}`}
            >
              {tour.images[0] && (
                <Image
                  unoptimized={
                    tour.images[0].url.startsWith("/images/admin/") ||
                    tour.images[0].url.startsWith(
                      "https://cdn.getyourguide.com/",
                    )
                  }
                  src={tour.images[0].url}
                  fallbackImage={fallback}
                  alt={tour.images[0].alt[locale]}
                  fill
                  sizes="(max-width:750px) 90vw, 33vw"
                />
              )}
              {!tour.images.length && fallback && (
                <Image
                  src={fallback.src}
                  alt={fallback.alt}
                  contextLabel={fallback.label}
                  fill
                  sizes="(max-width:750px) 90vw, 33vw"
                />
              )}
              {!tour.images.length && !fallback && (
                <div className="tour-card-placeholder">
                  <MapPin size={32} strokeWidth={1} aria-hidden="true" />
                  <span>{country?.name[locale]}</span>
                  <small>
                    {locale === "ru" ? "Без фотографии" : "No photograph"}
                  </small>
                </div>
              )}
              {tour.isDemo && <span className="demo-tag">DEMO</span>}
            </Link>
            <div className="tour-card-body">
              <div className="tour-card-meta">
                <span>{country?.name[locale]}</span>
                {tour.durationMinutes && (
                  <span>
                    <Clock size={14} />
                    {duration(tour.durationMinutes, locale)}
                  </span>
                )}
              </div>
              <h3>
                <Link href={`/${locale}/tours/${tour.slug}`}>
                  {tour.title[locale]}
                </Link>
              </h3>
              {tour.summary[locale] && <p>{tour.summary[locale]}</p>}
              <div className="tour-card-price">
                <div>
                  {tour.informationOnly && tour.referencePrice ? (
                    <>
                      <strong>
                        {money(
                          tour.referencePrice.amount,
                          tour.referencePrice.currency,
                          locale,
                        )}
                      </strong>
                      <span>
                        {tour.referencePrice.verification
                          ? (locale === "ru" ? "За взрослого" : "Per adult")
                          : locale === "ru"
                          ? "Ориентир из каталога"
                          : "Source price estimate"}
                      </span>
                    </>
                  ) : price?.adult !== null && price?.adult !== undefined ? (
                    <>
                      <strong>
                        {money(price.adult, price.currency, locale)}
                      </strong>
                      <span>{tour.isDemo ? t.testPrice : t.from}</span>
                    </>
                  ) : tour.previewPrice ? (
                    <PreviewTourPrice price={tour.previewPrice} locale={locale} />
                  ) : (
                    <span>
                      {tour.informationOnly
                        ? locale === "ru"
                          ? "Стоимость по запросу"
                          : "Price on request"
                        : t.unpriced}
                    </span>
                  )}
                </div>
                <Link
                  href={`/${locale}/tours/${tour.slug}`}
                  aria-label={`${t.view}: ${tour.title[locale]}`}
                >
                  <ArrowUpRight />
                </Link>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
