import { notFound } from "next/navigation";
import { isLocale } from "@/lib/catalog";
import { getTourRepository } from "@/features/tours/repository";
import { TourDetail } from "@/features/tours/components/detail";
import { InquiryForm } from "@/features/inquiries/form";
import { BookingContactForm } from "@/features/inquiries/booking-contact-form";
import { bookingEmail, bookingTelegramUrl } from "@/features/inquiries/booking-contact";
import { commerceEnabled } from "@/features/commerce/config";
import { managerContact } from "@/features/commerce/contact";
type Props = { params: Promise<{ locale: string; tour: string }> };
export async function generateMetadata({ params }: Props) {
  const { locale, tour: slug } = await params;
  const tour = await getTourRepository().bySlug(slug);
  if (!tour || !isLocale(locale)) notFound();
  return {
    alternates: {
      canonical: `/${locale}/tours/${slug}`,
      languages: { ru: `/ru/tours/${slug}`, en: `/en/tours/${slug}` },
    },
    title: tour.seo.title[locale] || tour.title[locale],
    description: tour.seo.description[locale] || tour.summary[locale],
    robots: tour.isDemo ? { index: false, follow: false } : undefined,
  };
}
export default async function TourPage({ params }: Props) {
  const { locale, tour: slug } = await params;
  if (!isLocale(locale)) notFound();
  const repository = getTourRepository();
  const tour = await repository.bySlug(slug);
  if (!tour || (tour.isDemo && process.env.NODE_ENV === "production")) notFound();
  const commerce = commerceEnabled();
  const contact = commerce ? null : bookingEmail(process.env.BOOKING_CONTACT_EMAIL);
  const telegram = commerce ? null : bookingTelegramUrl(managerContact);
  const [related, taxonomy] = await Promise.all([
    repository.list({
      locale,
      country: tour.country,
      page: 1,
      pageSize: 4,
      sort: "featured",
    }),
    repository.taxonomy(),
  ]);
  return (
    <>
      {process.env.TOUR_DATA_SOURCE === "local" && (
        <p className="tour-demo-banner">
          {locale === "ru"
            ? "Локальная разработка · не коммерческое предложение. Бронирование отключено."
            : "Local development · not a commercial offer. Booking is disabled."}
        </p>
      )}
      <TourDetail
        bookingContactEnabled={Boolean(contact || telegram)}
        contactEnabled={
          process.env.INQUIRIES_ENABLED === "true" &&
          process.env.TOUR_DATA_SOURCE === "postgres"
        }
        tour={tour}
        locale={locale}
        related={related.items.filter((t) => t.id !== tour.id)}
        taxonomy={taxonomy}
      />
      {(contact || telegram) && !tour.isDemo && <BookingContactForm recipient={contact??undefined} telegramUrl={telegram??undefined} locale={locale} product={{title:tour.title[locale],slug:tour.slug}}/>}
      {!tour.isDemo &&
        process.env.INQUIRIES_ENABLED === "true" &&
        process.env.TOUR_DATA_SOURCE === "postgres" && (
          <InquiryForm product={tour.slug} locale={locale} />
        )}
    </>
  );
}
