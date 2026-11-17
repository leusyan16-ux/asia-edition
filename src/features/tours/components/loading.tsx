export function CatalogLoading({ locale }: { locale?: "ru" | "en" }) {
  return <div className="tour-shell catalog-loading" aria-busy="true"
    aria-label={locale ? (locale === "ru" ? "Загружаем экскурсии" : "Loading excursions") : undefined}>
    <div/><div/><div/>
  </div>;
}
