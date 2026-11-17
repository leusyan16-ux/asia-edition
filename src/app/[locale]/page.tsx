import { siteCopy } from "@/lib/site-copy";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown } from "lucide-react";
import { CountryCollection, Approach } from "@/components/travel";
import { TravelSearch } from "@/components/search";
import { isLocale } from "@/lib/catalog";
import { FeaturedTours } from "@/features/tours/components/featured";
export const dynamic = "force-dynamic";
export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = siteCopy(locale);
  return (
    <>
      <section className="hero">
        <Image
          className="hero-image"
          src="/images/vietnam.jpg"
          alt={
            locale === "en"
              ? "Limestone islands and green water in Vietnam"
              : "Известняковые острова и зелёная вода во Вьетнаме"
          }
          fill
          priority
          sizes="100vw"
        />
        <div className="hero-content">
          <h1>{t.title}</h1>
          <p>{t.intro}</p>
          <a className="hero-link" href="#countries">
            {t.explore}
            <ArrowDown size={18} />
          </a>
        </div>
        <div className="hero-bottom">
          <span>{t.sample}</span>
          <span>
            {locale === "ru" ? "БУХТА ХАЛОНГ, ВЬЕТНАМ" : "HA LONG BAY, VIETNAM"}
          </span>
        </div>
      </section>
      <TravelSearch locale={locale} />
      <nav
        className="home-themes"
        aria-label={
          locale === "ru" ? "Идеи для путешествия" : "Explore by experience"
        }
      >
        {[
          ["sea", "Морские прогулки", "Boat trips"],
          ["culture", "Культура и история", "Culture & history"],
          ["nature", "Ближе к природе", "Into nature"],
          [
            "tickets",
            "Билеты и достопримечательности",
            "Tickets & attractions",
          ],
        ].map(([slug, ru, en]) => (
          <Link key={slug} href={`/${locale}/tours?category=${slug}`}>
            {locale === "ru" ? ru : en}
          </Link>
        ))}
      </nav>
      <FeaturedTours locale={locale} />
      <CountryCollection locale={locale} />
      <Approach locale={locale} />
    </>
  );
}
