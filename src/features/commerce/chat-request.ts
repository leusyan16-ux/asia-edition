import { bookingTelegramUrl } from "../inquiries/booking-contact";
import type { Tour } from "../tours/model";
import type { CartLine } from "./model";

type Language = "ru" | "en";
type Product = Pick<Tour, "title" | "previewPrice" | "referencePrice">;

export function priceHint(tour: Product, ru: boolean) {
  const price = tour.previewPrice;
  const reference = tour.referencePrice;
  if (!price && !reference) return null;
  const amount = price?.amount ?? reference?.amount;
  const currency = price ? price.benchmark?.currency ?? "USD" : reference?.currency;
  const number = new Intl.NumberFormat(ru ? "ru" : "en");
  if (amount === undefined) return null;
  const range = price?.upper === undefined ? "" : `–${number.format(price.upper)}`;
  const from = price?.from ? (ru ? "от " : "from ") : "";
  const unit = price?.groupMax
    ? (ru ? `, за группу до ${price.groupMax} чел.` : `, per group of up to ${price.groupMax}`)
    : price?.benchmark?.unit === "person"
      ? (ru ? ", на человека" : ", per person")
      : price?.benchmark?.unit === "vehicle"
        ? (ru ? ", за автомобиль" : ", per vehicle")
        : "";
  return `${ru ? "Ориентир" : "Price guide"}: ${from}${number.format(amount)}${range} ${currency}${unit}`;
}

export function requestChatDraft(
  contact: string | undefined,
  id: string,
  locale: Language,
  lines: { line: CartLine; tour: Product }[],
) {
  const url = bookingTelegramUrl(contact);
  if (!url) return null;
  const ru = locale === "ru";
  const details = lines.map(({ line, tour }, index) => [
    `${index + 1}. ${tour.title[locale]}`,
    `${line.date} · ${ru ? "Взрослые" : "Adults"}: ${line.adults} · ${ru ? "Дети" : "Children"}: ${line.children}`,
    priceHint(tour, ru),
  ].filter(Boolean).join("\n"));
  const text = [
    `ASIA EDITION · ${ru ? "Заявка" : "Request"} ${id}`,
    ...details,
    ru
      ? "Пожалуйста, уточните наличие мест и актуальную стоимость."
      : "Please confirm availability and the current price.",
  ].join("\n\n");
  const deepLink = new URL(url);
  deepLink.searchParams.set("text", text);
  return { url: deepLink.href.length <= 2000 ? deepLink.href : url, text };
}
