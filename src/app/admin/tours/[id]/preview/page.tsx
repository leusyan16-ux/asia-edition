import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  currentAdmin,
  adminTourById,
  adminTaxonomy,
} from "@/features/admin/server";
import { requireLocalCatalog } from "@/features/tours/local-repository";
import { localTourPayload } from "@/features/tours/local-catalog";
import { TourDetail } from "@/features/tours/components/detail";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Предпросмотр экскурсии",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const p = await currentAdmin();
  if (!p) redirect("/admin/login");
  if (p.mode !== "local") notFound();
  await requireLocalCatalog();
  const { id } = await params;
  const tour = await adminTourById(p, id);
  if (!tour) notFound();
  const locale = (await searchParams).locale === "en" ? "en" : "ru";
  return (
    <>
      <div className="editorial-preview-toolbar">
        <div>
          <strong>Закрытый предпросмотр</strong>
          <span>Бронирование отключено</span>
        </div>
        <Link href={`/admin/tours/${id}`}>К редактору</Link>
        <nav aria-label="Язык предпросмотра">
          <Link
            href="?locale=ru"
            aria-current={locale === "ru" ? "page" : undefined}
          >
            RU
          </Link>
          <Link
            href="?locale=en"
            aria-current={locale === "en" ? "page" : undefined}
          >
            EN
          </Link>
        </nav>
      </div>
      <TourDetail
        tour={localTourPayload(tour, true)}
        locale={locale}
        related={[]}
        taxonomy={await adminTaxonomy(p)}
        editorial={
          tour.externalProduct?.provider === "asia_edition_editorial"
            ? {
                city: tour.city,
                sourceUrl: tour.externalProduct.source_url,
                checkedOn: tour.externalProduct.last_synced_at.slice(0, 10),
              }
            : undefined
        }
      />
    </>
  );
}
