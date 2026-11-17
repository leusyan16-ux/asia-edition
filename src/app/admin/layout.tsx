import Link from "next/link";
import { commerceEnabled } from "@/features/commerce/config";
import "../globals.css";
import "./admin.css";
import "@/features/tours/components/editorial.css";
export const metadata = {
  title: "Управление · ASIA EDITION",
  robots: { index: false, follow: false },
};
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const commerce = commerceEnabled();
  const inventory = !commerce || process.env.ADMIN_MODE !== "disabled";
  return (
    <html lang="ru" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#admin-content">
          К содержимому
        </a>
        <div className="admin-shell">
          <header className="admin-header">
            <Link href={inventory ? "/admin" : "/admin/orders"} className="admin-brand">
              ASIA EDITION <span>Управление</span>
            </Link>
            <nav aria-label="Администрирование">
              {inventory && <>
                <Link href="/admin">Экскурсии</Link>
                <Link href="/admin/import">CSV / JSON импорт</Link>
                <Link href="/admin/inquiries">Заявки</Link>
                <Link href="/admin/operators">Операторы</Link>
              </>}
              {commerce && (
                <>
                  <Link href="/admin/analytics">Dashboard</Link>
                  <Link href="/admin/orders">Заказы</Link>
                  <Link href="/admin/customers">Клиенты</Link>
                  <Link href="/admin/staff">Сотрудники</Link>
                </>
              )}
              <Link href="/ru">Открыть сайт ↗</Link>
            </nav>
          </header>
          <main id="admin-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
