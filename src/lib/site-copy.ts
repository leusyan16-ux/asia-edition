import { copy, type Locale } from "./catalog";
export function launchSurface(env: Partial<NodeJS.ProcessEnv> = process.env) {
  return (
    env.NODE_ENV === "production" &&
    (env.TOUR_DATA_SOURCE === "static" ||
      (env.TOUR_DATA_SOURCE === "postgres" && env.POSTGRES_RUNTIME === "native"))
  );
}
/** Production wording describes request-only operation; local demo labels stay intact. */
export function siteCopy(
  locale: Locale,
  env: Partial<NodeJS.ProcessEnv> = process.env,
) {
  if (!launchSurface(env)) return copy[locale];
  if (env.TOUR_DATA_SOURCE === "static") return {
    ...copy[locale],
    ...(locale === "ru" ? {
      sample: "Направления Юго-Восточной Азии",
      collectionText: "Откройте страны Юго-Восточной Азии — пейзажи, культуру и достопримечательности для вашего путешествия.",
      notice: "Бронирование и оплата пока недоступны. Фотографии направлений иллюстративные.",
      future: "Откройте экскурсии и впечатления в каталоге.",
      countryIntro: "Откройте направления и достопримечательности для вашего путешествия.",
    } : {
      sample: "Destinations across Southeast Asia",
      collectionText: "Explore Southeast Asia through its landscapes, culture and places of interest.",
      notice: "Booking and payment are currently unavailable. Destination photography is illustrative.",
      future: "Explore excursions and experiences in the catalog.",
      countryIntro: "Discover destinations and places of interest for your journey.",
    }),
  };
  return {
    ...copy[locale],
    ...(locale === "ru"
      ? {
          sample: "Направления Юго-Восточной Азии",
          collectionText:
            "Откройте страны Юго-Восточной Азии — пейзажи, культуру и достопримечательности для вашего путешествия.",
          notice:
            "Фотографии направлений иллюстративные. Запрос на связь не подтверждает бронирование. Оплата на сайте не взимается.",
          future:
            "Смотрите опубликованные активности в каталоге. Доступность и условия требуют отдельного подтверждения.",
          countryIntro:
            "Откройте направления и достопримечательности для вашего путешествия.",
        }
      : {
          sample: "Destinations across Southeast Asia",
          collectionText:
            "Explore Southeast Asia through its landscapes, culture and places of interest.",
          notice:
            "Destination photography is illustrative. Contact requests do not confirm bookings. No payment is taken on this website.",
          future:
            "Explore published activities in the catalogue. Availability and conditions require separate confirmation.",
          countryIntro:
            "Discover destinations and places of interest for your journey.",
        }),
  };
}
