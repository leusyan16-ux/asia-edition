import Link from "next/link";
import type { Locale } from "@/lib/catalog";
import type { TourPage, TourQuery, TourTaxonomy } from "../model";
import { tourLabels } from "../labels";
import { TourFilters } from "./filters";
import { TourCards } from "./cards";
import { queryLink } from "../query";
export function ExcursionCatalog({
  locale,
  query,
  result,
  taxonomy,
  isDemo,
  notice,
}: {
  locale: Locale;
  query: TourQuery;
  result: TourPage;
  taxonomy: TourTaxonomy;
  isDemo: boolean;
  notice?: string;
}) {
  const t = tourLabels[locale];
  const pages = Math.ceil(result.total / query.pageSize);
  return (
    <div className="excursion-catalog tour-shell">
      <div className="catalog-heading">
        <h1>{t.catalog}</h1>
        <p>{t.catalogIntro}</p>
      </div>
      <div className="tour-demo-banner">
        <p>{notice || (isDemo ? t.demoNotice : t.realNotice)}</p>
      </div>
      <TourFilters
        key={`${query.country}-${query.location}`}
        query={query}
        locale={locale}
        taxonomy={taxonomy}
      />
      {query.invalid && (
        <p role="alert">
          {locale === "ru"
            ? "Параметры фильтра некорректны. Проверьте диапазон цен и выберите фильтры заново."
            : "Invalid filter parameters. Check the price range and select your filters again."}
        </p>
      )}
      <div className="catalog-results" aria-live="polite">
        <h2>
          {t.results}: {result.total}
        </h2>
        {isDemo && <span>DEMO</span>}
      </div>
      {result.items.length ? (
        <TourCards
          items={result.items}
          locale={locale}
          currency={query.currency}
        />
      ) : (
        <div className="catalog-empty">
          <h2>{t.empty}</h2>
          <p>{t.emptyText}</p>
          <Link className="text-link" href={`/${locale}/tours`}>
            {t.reset}
          </Link>
        </div>
      )}
      {pages > 1 && (
        <nav
          className="pagination"
          aria-label={locale === "ru" ? "Страницы каталога" : "Catalog pages"}
        >
          {query.page > 1 && (
            <Link href={queryLink(locale, query, query.page - 1)}>
              {t.previous}
            </Link>
          )}
          <span>
            {query.page} / {pages}
          </span>
          {query.page < pages && (
            <Link href={queryLink(locale, query, query.page + 1)}>
              {t.next}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
