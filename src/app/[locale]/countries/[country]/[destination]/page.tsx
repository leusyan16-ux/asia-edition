import { notFound } from "next/navigation";
import { CountryHero } from "@/components/travel";
import { countries, locales, isLocale } from "@/lib/catalog";
import { DestinationCatalog } from "@/features/tours/components/destination-catalog";
import { getTourRepository } from "@/features/tours/repository";
export const dynamic = "force-dynamic";
type Props = {
  params: Promise<{ locale: string; country: string; destination: string }>;
};
export function generateStaticParams() {
  return locales.flatMap((locale) =>
    countries.flatMap((c) =>
      c.destinations.map((d) => ({
        locale,
        country: c.slug,
        destination: d.slug,
      })),
    ),
  );
}
export async function generateMetadata({ params }: Props) {
  const { locale, country, destination } = await params;
  const taxonomy = await getTourRepository().taxonomy();
  const d = taxonomy.locations.find(
    (l) => l.country === country && l.slug === destination,
  );
  return {
    title: d && isLocale(locale) ? d.name[locale] : "Destination",
    alternates: {
      canonical: `/${locale}/countries/${country}/${destination}`,
      languages: {
        ru: `/ru/countries/${country}/${destination}`,
        en: `/en/countries/${country}/${destination}`,
      },
    },
  };
}
export default async function DestinationPage({ params }: Props) {
  const { locale, country, destination } = await params;
  const c = countries.find((c) => c.slug === country);
  if (!isLocale(locale) || !c) notFound();
  const taxonomy = await getTourRepository().taxonomy();
  const d = taxonomy.locations.find(
    (l) => l.country === country && l.slug === destination,
  );
  if (!d) notFound();
  const sample = c.destinations.find((s) => s.slug === destination);
  return (
    <>
      <CountryHero
        country={c}
        locale={locale}
        title={d.name[locale]}
        description={sample?.description[locale]}
      />
      <DestinationCatalog
        locale={locale}
        country={country}
        location={destination}
      />
    </>
  );
}
