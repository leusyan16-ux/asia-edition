import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { CountryHero } from "@/components/travel";
import { countries, locales, isLocale, copy } from "@/lib/catalog";
import { DestinationCatalog } from "@/features/tours/components/destination-catalog";
import { getTourRepository } from "@/features/tours/repository";
import { localizedAlternates } from "@/lib/site-config";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; country: string }> };
export function generateStaticParams() {
  return locales.flatMap((locale) =>
    countries.map((c) => ({ locale, country: c.slug })),
  );
}
export async function generateMetadata({ params }: Props) {
  const { locale, country } = await params;
  const c = countries.find((c) => c.slug === country);
  return {
    title: c && isLocale(locale) ? c.name[locale] : "Country",
    alternates: localizedAlternates(`/countries/${country}`, locale),
  };
}
export default async function CountryPage({ params }: Props) {
  const { locale, country } = await params;
  const c = countries.find((c) => c.slug === country);
  if (!isLocale(locale) || !c) notFound();
  const taxonomy = await getTourRepository().taxonomy();
  const destinations = taxonomy.locations.filter((l) => l.country === country);
  return (
    <>
      <CountryHero country={c} locale={locale} />
      <section className="section destination-list">
        <h2>{copy[locale].featured}</h2>
        {destinations.map((d) => (
          <Link key={d.slug} href={`/${locale}/countries/${c.slug}/${d.slug}`}>
            <div>
              <h3>{d.name[locale]}</h3>
              {c.destinations.find((s) => s.slug === d.slug)?.description[
                locale
              ] && (
                <p>
                  {
                    c.destinations.find((s) => s.slug === d.slug)?.description[
                      locale
                    ]
                  }
                </p>
              )}
            </div>
            <ArrowUpRight />
          </Link>
        ))}
      </section>
      <DestinationCatalog locale={locale} country={country} />
    </>
  );
}
