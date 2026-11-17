import { notFound } from "next/navigation";
import { isLocale, countries } from "@/lib/catalog";
import { demoTour } from "@/features/tours/demo";
import { categories } from "@/features/tours/labels";
import { TourDetail } from "@/features/tours/components/detail";
export const metadata = {
  title: "DEMO · ASIA EDITION",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; tour: string }>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.TOUR_DATA_SOURCE === "static") notFound();
  const { locale, tour } = await params;
  if (!isLocale(locale) || tour !== demoTour.slug) notFound();
  return (
    <TourDetail
      tour={demoTour}
      locale={locale}
      related={[]}
      taxonomy={{
        locations: countries.flatMap((c) =>
          c.destinations.map((d) => ({
            country: c.slug,
            slug: d.slug,
            name: d.name,
          })),
        ),
        categories,
      }}
    />
  );
}
