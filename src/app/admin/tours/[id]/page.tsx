import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  currentAdmin,
  adminTaxonomy,
  adminTourById,
} from "@/features/admin/server";
import { emptyTour } from "@/features/admin/model";
import { TourEditor, Logout } from "@/features/admin/components";
import { postgresSelected } from "@/features/ingestion/config";
import { PostgresReviewPanel } from "@/features/ingestion/review-panel";
import { MediaReviewPanel } from "@/features/ingestion/media-review-panel";
import { galleryMediaReviews } from "@/features/ingestion/media-review";
import { postgresFor } from "@/features/ingestion/runtime";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const p = await currentAdmin();
  if (!p) redirect("/admin/login");
  const { id } = await params;
  const taxonomy = await adminTaxonomy(p);
  const initial =
    id === "new" ? emptyTour(randomUUID()) : await adminTourById(p, id);
  if (!initial) notFound();
  const media =
    postgresSelected() && id !== "new"
      ? await galleryMediaReviews(
          await postgresFor("asia_catalog_editor"),
          initial.id,
        )
      : [];
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <h1>{id === "new" ? "Новая экскурсия" : initial.title.ru}</h1>
          <p>
            {id === "new"
              ? "Начните с названия и направления. Сохраните как черновик."
              : "Редактирование содержания и условий экскурсии."}
          </p>
        </div>
        <Logout />
      </div>
      {p.mode === "local" && (
        <p className="admin-notice">
          {postgresSelected()
            ? "Локальный PostgreSQL · карточки и фотографии сохраняются в выбранном профиле. Публикация импорта отключена."
            : "Локальная разработка · запись только на этом компьютере. Для реального каталога настройте Supabase. Для просмотра локального каталога используйте TOUR_DATA_SOURCE=local."}
          {id !== "new" &&
            ["local", "postgres"].includes(
              process.env.TOUR_DATA_SOURCE ?? "",
            ) && (
              <>
                <br />
                <Link href={`/admin/tours/${initial.id}/preview`}>
                  Предпросмотр сохранённой записи ↗
                </Link>
              </>
            )}
        </p>
      )}
      <TourEditor
        key={initial.id + initial.updatedAt}
        initial={initial}
        taxonomy={taxonomy}
        isNew={id === "new"}
        publicationDisabled={postgresSelected() && !!initial.externalProduct}
        retainMedia={postgresSelected()}
      />
      <MediaReviewPanel
        product={initial.id}
        images={initial.images}
        assets={media}
      />
      {postgresSelected() && initial.externalProduct && (
        <PostgresReviewPanel
          key={initial.updatedAt}
          id={initial.id}
          expected={initial.updatedAt}
          initial={{
            editorial: initial.externalProduct.editorial_status,
            rights: initial.externalProduct.content_rights_status,
            evidence: initial.externalProduct.rights_evidence,
          }}
        />
      )}
      {initial.externalProduct && (
        <section className="admin-section admin-source">
          <h2>Данные источника · только чтение</h2>
          <p>
            {initial.externalProduct.provider} ·{" "}
            {initial.externalProduct.external_product_id} ·{" "}
            {initial.externalProduct.import_status}
          </p>
          <p>
            Синхронизация: {initial.externalProduct.last_synced_at}. Редактор
            выше хранит отдельную редакционную карточку; повторный импорт её не
            заменяет.
          </p>
          <p>
            Состояние источника: {initial.externalProduct.source_status}.
            Редакционная проверка: {initial.externalProduct.editorial_status}.
            Права на контент: {initial.externalProduct.content_rights_status}.
            Готовность к публикации:{" "}
            {initial.externalProduct.publication_readiness}.
          </p>
          <a
            href={initial.externalProduct.source_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Источник продукта ↗
          </a>
          <details>
            <summary>Факты и тексты поставщика</summary>
            <pre>{JSON.stringify(initial.externalProduct.facts, null, 2)}</pre>
          </details>
          <details>
            <summary>Пакеты, тарифы и коммерческие условия</summary>
            <pre>
              {JSON.stringify(initial.externalProduct.commercial, null, 2)}
            </pre>
          </details>
          {initial.externalProduct.source_metadata && (
            <details>
              <summary>
                Исходные сведения, цены, рейтинг и ссылки на фото · не проверено
              </summary>
              <pre>
                {JSON.stringify(
                  initial.externalProduct.source_metadata,
                  null,
                  2,
                )}
              </pre>
            </details>
          )}
        </section>
      )}
    </>
  );
}
