import "@/features/commerce/commerce.css";
import {commerceEnabled} from "@/features/commerce/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { Footer } from "@/components/travel";
import { isLocale, locales } from "@/lib/catalog";
import { indexingEnabled, publicOrigin } from "@/lib/site-config";
import { Suspense } from "react";
import { AnalyticsConsent } from "@/features/commerce/analytics-consent";
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const index = indexingEnabled();
  return {
    metadataBase: publicOrigin() ? new URL(publicOrigin()!) : undefined,
    title: {
      default: "Asia Edition — Explore Southeast Asia",
      template: "%s | Asia Edition",
    },
    description:
      locale === "ru"
        ? "Путешествия и туристические активности по Юго-Восточной Азии."
        : "Travel and activities across Southeast Asia.",
    robots: { index, follow: index },
  };
}
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale}>
      <body>
        <a className="skip-link" href="#main">
          {locale === "en" ? "Skip to content" : "К содержимому"}
        </a>
        <Header locale={locale} accountEnabled={commerceEnabled()} />
        <main id="main">{children}</main>
        <Footer locale={locale} accountEnabled={commerceEnabled()} />
        {commerceEnabled() && <Suspense fallback={null}><AnalyticsConsent locale={locale} /></Suspense>}
      </body>
    </html>
  );
}
import "@/features/tours/components/editorial.css";
