import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { currentAdmin, adminInventoryPage } from "@/features/admin/server";
import { Inventory, Logout } from "@/features/admin/components";
import { adminCountries as countries } from "@/lib/catalog";
import { postgresSelected } from "@/features/ingestion/config";
import { commerceEnabled } from "@/features/commerce/config";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (commerceEnabled() && process.env.ADMIN_MODE === "disabled") redirect("/admin/orders");
  const p = await currentAdmin();
  if (!p) redirect("/admin/login");
  const result = await adminInventoryPage(p, await searchParams);
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <h1>Экскурсии</h1>
          <p>
            Контент, доступность и публикация — в одном рабочем пространстве.
          </p>
        </div>
        <div className="admin-actions">
          <Logout />
          <Link className="admin-primary" href="/admin/tours/new">
            <Plus size={16} /> Добавить экскурсию
          </Link>
        </div>
      </div>
      {p.mode === "local" && (
        <p className="admin-notice">
          Локальная разработка ·{" "}
          {postgresSelected()
            ? "PostgreSQL: отдельная проекция каталога."
            : "JSON: изменения сохраняются в .admin-local."}{" "}
          Оплата и подтверждения отключены.{" "}
          <Link href="/admin/import">Импорт и журнал ↗</Link>
        </p>
      )}
      <dl className="admin-stats">
        {[
          ["Всего экскурсий", result.stats.total],
          ["Опубликовано", result.stats.published],
          ["Черновики", result.stats.draft],
          ["Требуют заполнения", result.stats.missing],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <details className="admin-country-stats">
        <summary>Распределение по 13 странам</summary>
        <dl>
          {countries.map((c) => (
            <div key={c.slug}>
              <dt>{c.name.ru}</dt>
              <dd>
                {result.byCountry.find((r) => r.country === c.slug)?.n ?? 0}
              </dd>
            </div>
          ))}
        </dl>
      </details>
      <Inventory tours={result.items} pagination={result.pagination} />
    </>
  );
}
