import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, ArrowRight } from "lucide-react";
import { countries, type Locale, type Country } from "@/lib/catalog";
import { siteCopy } from "@/lib/site-copy";
import { managerContact } from "@/features/commerce/contact";
const destinationOrder = [
  "thailand",
  "vietnam",
  "singapore",
  "indonesia",
  "malaysia",
  "philippines",
  "cambodia",
  "laos",
  "brunei",
  "timor-leste",
];
export async function CountryCollection({ locale, activeCountries }: { locale: Locale; activeCountries?: string[] }) {
  const t = siteCopy(locale);
  const active=new Set(activeCountries ?? (await (await import("@/features/tours/repository")).getTourRepository().taxonomy()).locations.map(l=>l.country));
  return (
    <section className="collection section" id="countries">
      <div className="section-heading">
        <h2>{t.collection}</h2>
        <p>{t.collectionText}</p>
      </div>
      <div className="country-grid destination-mosaic">
        {countries
          .filter((c) => active.has(c.slug) && !c.image.endsWith(".svg"))
          .sort(
            (a, b) =>
              destinationOrder.indexOf(a.slug) -
              destinationOrder.indexOf(b.slug),
          )
          .map((c) => (
            <Link
              className="country-card"
              key={c.slug}
              href={`/${locale}/countries/${c.slug}`}
            >
              <Image
                src={c.image}
                alt={c.name[locale]}
                fill
                sizes="(max-width: 600px) 90vw, (max-width: 1000px) 45vw, 40vw"
              />
              <div className="country-caption">
                <span>{c.mood[locale]}</span>
                <div>
                  <h3>{c.name[locale]}</h3>
                  <ArrowUpRight size={26} aria-hidden="true" />
                </div>
              </div>
            </Link>
          ))}
      </div>
    </section>
  );
}
export function Approach({ locale }: { locale: Locale }) {
  const t = siteCopy(locale);
  return (
    <section className="approach section" id="approach">
      <div className="approach-image">
        <Image
          src="/images/indonesia.jpg"
          alt={
            locale === "en"
              ? "Illustrative Bali landscape"
              : "Иллюстративный пейзаж Бали"
          }
          fill
          sizes="(max-width: 750px) 100vw, 50vw"
        />
      </div>
      <div className="approach-copy">
        <h2>{t.story}</h2>
        <p>{t.storyText}</p>
        <Link className="text-link" href={`/${locale}/tours`}>
          {locale === "ru"
            ? "Найти свою экскурсию"
            : "Find your next experience"}
          <ArrowRight size={19} />
        </Link>
      </div>
    </section>
  );
}
export async function Footer({
  locale,
  accountEnabled = false,
  activeCountries,
}: {
  locale: Locale;
  accountEnabled?: boolean;
  activeCountries?: string[];
}) {
  const ru = locale === "ru";
  const active=new Set(activeCountries ?? (await (await import("@/features/tours/repository")).getTourRepository().taxonomy()).locations.map(l=>l.country));
  return (
    <footer className="footer site-footer" id="contact">
      <div className="footer-intro">
        <Link className="footer-brand" href={`/${locale}`}>
          ASIA EDITION
        </Link>
        <p>
          {ru
            ? "Юго-Восточная Азия, которую хочется открывать."
            : "Southeast Asia, waiting to be explored."}
        </p>
        <a
          className="footer-contact"
          href={managerContact}
          target="_blank"
          rel="noopener noreferrer"
        >
          {ru ? "Обсудить путешествие" : "Talk about your trip"}
          <ArrowUpRight size={18} />
        </a>
      </div>
      <nav
        className="footer-navigation"
        aria-label={ru ? "Навигация внизу страницы" : "Footer navigation"}
      >
        <h2>{ru ? "Путешествие" : "Explore"}</h2>
        <Link href={`/${locale}/tours`}>
          {ru ? "Все экскурсии" : "All activities"}
        </Link>
        <Link href={`/${locale}#countries`}>
          {ru ? "Направления" : "Destinations"}
        </Link>
        <Link href={`/${locale}#approach`}>
          {ru ? "Об ASIA EDITION" : "About ASIA EDITION"}
        </Link>
        {accountEnabled && (
          <Link href={`/${locale}/account`}>
            {ru ? "Личный кабинет" : "My account"}
          </Link>
        )}
      </nav>
      <nav
        className="footer-destinations"
        aria-label={ru ? "Страны" : "Countries"}
      >
        <h2>{ru ? "Найдите своё направление" : "Find your destination"}</h2>
        <div>
          {countries.filter(c=>active.has(c.slug)).map((c) => (
            <Link key={c.slug} href={`/${locale}/countries/${c.slug}`}>
              {c.name[locale]}
            </Link>
          ))}
        </div>
      </nav>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} ASIA EDITION</span>
      </div>
    </footer>
  );
}
export function CountryHero({
  country,
  locale,
  title,
  description,
}: {
  country: Country;
  locale: Locale;
  title?: string;
  description?: string;
}) {
  const t = siteCopy(locale);
  return (
    <>
      <div className="detail-hero">
        <Image
          src={country.image}
          alt={country.name[locale]}
          fill
          priority
          sizes="100vw"
        />
        <div className="detail-content">
          <Link href={`/${locale}#countries`}>{t.back}</Link>
          <h1>{title ?? country.name[locale]}</h1>
          <p>{description ?? t.countryIntro}</p>
          <span>{t.sample}</span>
        </div>
      </div>
    </>
  );
}
