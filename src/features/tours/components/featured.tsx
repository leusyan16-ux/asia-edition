import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Locale } from "@/lib/catalog";
import { getTourRepository } from "../repository";
import { TourCards } from "./cards";
export async function FeaturedTours({ locale }: { locale: Locale }) {
  const result = await getTourRepository().list({
    locale,
    page: 1,
    pageSize: 12,
    sort: "featured",
  });
  const items = result.items.filter((t) => t.images.length > 0).slice(0, 6);
  if (!items.length) return null;
  return (
    <section className="section featured-excursions" id="experiences">
      <div className="section-heading">
        <h2>
          {locale === "ru"
            ? "Впечатления, ради которых\nстоит отправиться в путь."
            : "Experiences worth\nthe journey."}
        </h2>
        <p>
          {locale === "ru"
            ? "Морские прогулки, культурные маршруты и встречи с природой. Откройте детали и найдите свою следующую поездку."
            : "Boat trips, cultural discoveries and time in nature. Explore the details and find your next adventure."}
        </p>
      </div>
      <TourCards items={items} locale={locale} />
      <Link className="text-link" href={`/${locale}/tours`}>
        {locale === "ru" ? "Весь каталог экскурсий" : "Explore all activities"}
        <ArrowRight size={18} />
      </Link>
    </section>
  );
}
