"use client";
import { useState } from "react";
import { CalendarDays, LockKeyhole } from "lucide-react";
import type { Locale } from "@/lib/catalog";
import type { Tour } from "../model";
import { tourLabels } from "../labels";
import { money } from "./cards";
export function BookingPreview({
  tour,
  locale,
  contactEnabled = false,
}: {
  tour: Tour;
  locale: Locale;
  contactEnabled?: boolean;
}) {
  const t = tourLabels[locale];
  const [adults, setAdults] = useState(2),
    [children, setChildren] = useState(0),
    [currency, setCurrency] = useState(tour.prices[0]?.currency ?? "USD"),
    [date, setDate] = useState("");
  const price = tour.prices.find((p) => p.currency === currency);
  const known =
    price?.adult !== null &&
    price?.adult !== undefined &&
    (children === 0 || price.child !== null);
  const total = known
    ? adults * (price?.adult ?? 0) + children * (price?.child ?? 0)
    : null;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: tour.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const available = tour.isDemo
    ? []
    : tour.availability.filter(
        (a) => a.status === "available" && a.remaining > 0 && a.date >= today,
      );
  const slot = available.find((a) => a.date === date);
  const tooMany = slot !== undefined && adults + children > slot.remaining;
  if (contactEnabled && !tour.isDemo)
    return (
      <>
        <aside className="booking-widget">
          <h2>
            {locale === "ru" ? "Информация и запрос" : "Activity enquiry"}
          </h2>
          <p>
            {locale === "ru"
              ? "Доступность и стоимость уточняются отдельно. Запрос не подтверждает бронирование."
              : "Availability and price require separate confirmation. An enquiry does not confirm a booking."}
          </p>
          <a className="primary-button" href="#inquiry-title">
            {locale === "ru" ? "Оставить запрос" : "Send an enquiry"}
          </a>
          <p className="booking-hint">
            {locale === "ru" ? "Без списания средств" : "No payment is taken"}
          </p>
        </aside>
        <div className="mobile-booking">
          <span>{locale === "ru" ? "Без оплаты" : "No payment"}</span>
          <a className="primary-button" href="#inquiry-title">
            {locale === "ru" ? "Оставить запрос" : "Send an enquiry"}
          </a>
        </div>
      </>
    );
  return (
    <>
      <aside
        id="booking-widget"
        className="booking-widget"
        aria-labelledby="booking-title"
      >
        <h2 id="booking-title">{t.booking}</h2>
        {tour.isDemo && <p className="demo-price-note">{t.testPrice}</p>}
        {tour.prices.length > 1 && (
          <label>
            {t.currency}
            <select
              aria-label={t.currency}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {tour.prices.map((p) => (
                <option key={p.currency}>{p.currency}</option>
              ))}
            </select>
          </label>
        )}
        {price && (
          <div className="price-lines">
            {price.adult !== null && (
              <div>
                <span>{t.from}</span>
                <strong>{money(price.adult, currency, locale)}</strong>
              </div>
            )}
            {price.child !== null && (
              <div>
                <span>
                  {t.child}
                  {price.childMinAge !== null && price.childMaxAge !== null
                    ? ` (${price.childMinAge}–${price.childMaxAge})`
                    : ""}
                </span>
                <strong>{money(price.child, currency, locale)}</strong>
              </div>
            )}
          </div>
        )}
        <label className="date-label">
          <CalendarDays size={16} />
          {t.date}
          <select
            aria-label={t.date}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={!available.length}
          >
            <option value="">{available.length ? t.date : t.noDates}</option>
            {available.map((a) => (
              <option key={a.date} value={a.date}>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "long",
                  timeZone: "UTC",
                }).format(new Date(`${a.date}T12:00:00Z`))}
              </option>
            ))}
          </select>
        </label>
        {!available.length && <p className="booking-hint">{t.noDatesHint}</p>}
        <div className="guest-controls">
          {(
            [
              { key: "adults", value: adults, set: setAdults, min: 1 },
              { key: "children", value: children, set: setChildren, min: 0 },
            ] as const
          ).map((g) => (
            <div key={g.key}>
              <span id={`${g.key}-label`}>{t[g.key]}</span>
              <div>
                <button
                  type="button"
                  disabled={g.value <= g.min}
                  aria-label={`${locale === "ru" ? "Уменьшить" : "Decrease"}: ${t[g.key]}`}
                  onClick={() => g.set(g.value - 1)}
                >
                  −
                </button>
                <output aria-labelledby={`${g.key}-label`}>{g.value}</output>
                <button
                  type="button"
                  disabled={g.value >= 20}
                  aria-label={`${locale === "ru" ? "Увеличить" : "Increase"}: ${t[g.key]}`}
                  onClick={() => g.set(g.value + 1)}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="booking-total" aria-live="polite">
          <span>{tour.isDemo ? t.sampleTotal : t.total}</span>
          <strong>
            {total === null ? t.priceUnknown : money(total, currency, locale)}
          </strong>
        </div>
        {tooMany && <p role="alert">{t.capacity}</p>}
        <button type="button" className="primary-button" disabled>
          <LockKeyhole size={16} />
          {t.blocked}
        </button>
        <p className="booking-hint">
          {locale === "ru"
            ? "Это предварительный просмотр. Данные не сохраняются, заявки и платежи не отправляются."
            : "This is a preview. Data is not saved; requests and payments are not sent."}
        </p>
      </aside>
      <div className="mobile-booking">
        <span>{tour.isDemo ? "DEMO" : t.blocked}</span>
        <a className="primary-button" href="#booking-widget">
          {t.booking}
        </a>
      </div>
    </>
  );
}
