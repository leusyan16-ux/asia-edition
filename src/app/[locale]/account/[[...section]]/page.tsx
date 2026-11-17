import Link from "next/link";
import { notFound } from "next/navigation";
import { commerceEnabled } from "@/features/commerce/server";
import { AccountPanel } from "@/features/commerce/components";
import { isLocale } from "@/lib/catalog";
import "@/features/commerce/commerce.css";
export const metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};
export default async function Account({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; section?: string[] }>;
  searchParams: Promise<{ auth?: string }>;
}) {
  const { locale, section = [] } = await params;
  if (
    !commerceEnabled() ||
    !isLocale(locale) ||
    section.length > 1 ||
    !["", "cart", "orders", "profile", "favorites", "password"].includes(
      section[0] ?? "",
    )
  )
    notFound();
  const ru = locale === "ru";
  const { auth } = await searchParams;
  return (
    <div className="commerce-shell">
      <h1>{section[0] === "cart" ? (ru ? "Корзина" : "Your cart") : (ru ? "Личный кабинет" : "Your account")}</h1>
      <nav
        className="commerce-links"
        aria-label={ru ? "Личный кабинет" : "Your account"}
      >
        {[
          ["orders", ru ? "Мои заявки" : "My requests"],
          ["favorites", ru ? "Избранное" : "Favorites"],
          ["cart", ru ? "Корзина" : "Cart"],
          ["profile", ru ? "Профиль" : "Profile"],
        ].map(([s, t]) => (
          <Link
            key={s}
            href={`/${locale}/account/${s}`}
            aria-current={section[0] === s ? "page" : undefined}
          >
            {t}
          </Link>
        ))}
      </nav>
      <AccountPanel
        key={section[0] ?? ""}
        authNotice={auth === "confirmed" || auth === "expired" ? auth : undefined}
        locale={locale}
        section={section[0] ?? ""}
        googleEnabled={process.env.COMMERCE_GOOGLE_ENABLED === "true"}
      />
    </div>
  );
}
