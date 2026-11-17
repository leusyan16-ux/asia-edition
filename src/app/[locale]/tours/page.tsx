import { notFound } from "next/navigation";
import { isLocale } from "@/lib/catalog";
import { getTourRepository } from "@/features/tours/repository";
import { parseQuery } from "@/features/tours/query";
import { ExcursionCatalog } from "@/features/tours/components/catalog";
import { tourLabels } from "@/features/tours/labels";
import { Suspense } from "react";
import { CatalogLoading } from "@/features/tours/components/loading";
import type { Locale } from "@/lib/catalog";
import type { TourQuery } from "@/features/tours/model";
import { commerceEnabled } from "@/features/commerce/config";
type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export async function generateMetadata({ params, searchParams }: Props) {
  const { locale } = await params;
  return {
    alternates: {
      canonical: `/${locale}/tours`,
      languages: { ru: "/ru/tours", en: "/en/tours" },
    },
    ...(Object.keys(await searchParams).length
      ? { robots: { index: false, follow: true } }
      : {}),
    title: isLocale(locale) ? tourLabels[locale].catalog : "Excursions",
  };
}
export default async function CatalogPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = parseQuery(await searchParams, locale);
  return (
    <Suspense fallback={<CatalogLoading locale={locale} />}>
      <CatalogContent locale={locale} query={query} />
    </Suspense>
  );
}
async function CatalogContent({
  locale,
  query,
}: {
  locale: Locale;
  query: TourQuery;
}) {
  const repository = getTourRepository();
  const [initialResult, taxonomy] = await Promise.all([
    query.invalid
      ? Promise.resolve({ items: [], total: 0 })
      : repository.list(query),
    repository.taxonomy(),
  ]);
  let result = initialResult;
  if (result.total > 0 && result.items.length === 0 && !query.invalid) {
    query = { ...query, page: Math.max(1, Math.ceil(result.total / query.pageSize)) };
    result = await repository.list(query);
  }
  return (
    <ExcursionCatalog
      locale={locale}
      query={query}
      result={result}
      taxonomy={taxonomy}
      isDemo={
        !["supabase", "local", "postgres", "static"].includes(
          process.env.TOUR_DATA_SOURCE ?? "demo",
        )
      }
      notice={
        process.env.TOUR_DATA_SOURCE === "static"
          ? commerceEnabled()
            ? locale === "ru" ? "Подберите экскурсии и отправьте заявку. Наличие мест и оплату уточнит менеджер в чате." : "Choose your excursions and send a request. Confirm availability and payment with the manager in chat."
            : locale === "ru" ? "Экскурсии и впечатления Юго-Восточной Азии. Бронирование и оплата пока недоступны." : "Excursions and experiences across Southeast Asia. Booking and payment are currently unavailable."
          : process.env.TOUR_DATA_SOURCE === "local"
          ? locale === "ru"
            ? "Локальный каталог разработки · публикация не является коммерческим предложением. Бронирование отключено."
            : "Local development catalog · publication is not a commercial offer. Booking is disabled."
          : undefined
      }
    />
  );
}
