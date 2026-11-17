"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { cartSnapshot, favoritesSnapshot, refreshCommerceState, subscribeCommerce } from "@/features/commerce/browser-state";
import { managerContact } from "@/features/commerce/contact";
import {
  ArrowUpRight,
  Menu,
  X,
  Compass,
  UserRound,
  ShoppingBag,
  Heart,
} from "lucide-react";
import { copy, type Locale } from "@/lib/catalog";
export function Header({
  locale,
  accountEnabled = false,
}: {
  locale: Locale;
  accountEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = copy[locale];
  const other = locale === "en" ? "ru" : "en";
  const cartCount=useSyncExternalStore(subscribeCommerce,cartSnapshot,()=>0);
  const favoriteCount=useSyncExternalStore(subscribeCommerce,()=>favoritesSnapshot().length,()=>0);
  useEffect(()=>{
    if(!accountEnabled) return;
    const refresh=()=>{void refreshCommerceState();};
    refresh();
    for(const name of ["ae-cart-changed","ae-session-changed","ae-favorites-changed","storage","focus"]) window.addEventListener(name,refresh);
    return ()=>{for(const name of ["ae-cart-changed","ae-session-changed","ae-favorites-changed","storage","focus"]) window.removeEventListener(name,refresh);};
  },[accountEnabled]);
  return (
    <header className={`header${accountEnabled ? " header-with-account" : ""}`}>
      <Link
        href={`/${locale}`}
        className="brand"
        aria-label="Asia Edition home"
      >
        <Compass size={29} strokeWidth={1.3} />
        <span>
          ASIA<span className="brand-light"> EDITION</span>
        </span>
      </Link>
      <nav className="desktop-nav" aria-label={t.destinations}>
        <Link href={`/${locale}#countries`}>{t.destinations}</Link>
        <Link href={`/${locale}/tours`} aria-current={pathname.startsWith(`/${locale}/tours`)?"page":undefined}>
          {locale === "ru" ? "Экскурсии" : "Excursions"}
        </Link>
        <Link href={`/${locale}#approach`}>
          {locale === "ru" ? "О нас" : "About us"}
        </Link>
        <a
          href={managerContact}
          target="_blank"
          rel="noopener noreferrer"
        >
          {locale === "ru" ? "Связаться" : "Contact"}
        </a>
        {accountEnabled && (
          <>
            <Link href={`/${locale}/account/orders`}>
              {locale === "ru" ? "Мои заявки" : "My requests"}
            </Link>
          </>
        )}
      </nav>
      <div className="header-actions">
        {accountEnabled && (
          <>
            <Link className="account-header-link" href={`/${locale}/account/favorites`} aria-current={pathname.endsWith('/account/favorites')?"page":undefined} aria-label={locale==="ru"?"Избранное":"Favorites"} title={locale==="ru"?"Избранное":"Favorites"}>
              <Heart size={21}/>{favoriteCount>0&&<span className="header-count">{favoriteCount}</span>}
            </Link>
            <Link
              className="account-header-link"
              href={`/${locale}/account/profile`}
              aria-current={pathname.endsWith('/account/profile')?"page":undefined}
              aria-label={
                locale === "ru"
                  ? "Вход / Регистрация / Мой аккаунт"
                  : "Sign in / Register / My account"
              }
              title={
                locale === "ru"
                  ? "Вход / Регистрация / Мой аккаунт"
                  : "Sign in / Register / My account"
              }
            >
              <UserRound size={21} />
            </Link>
            <Link
              className="account-header-link"
              href={`/${locale}/account/cart`}
              aria-current={pathname.endsWith('/account/cart')?"page":undefined}
              aria-label={locale === "ru" ? "Корзина" : "Cart"}
              title={locale === "ru" ? "Корзина" : "Cart"}
            >
              <ShoppingBag size={21} />
              {cartCount>0&&<span className="header-count" aria-live="polite">{cartCount}</span>}
            </Link>
          </>
        )}
        <Link
          className="language"
          aria-label={t.language}
          href={pathname.replace(`/${locale}`, `/${other}`)}
        >
          {other.toUpperCase()}
        </Link>
        {!accountEnabled && (
          <Link className="header-cta" href={`/${locale}/tours`}>
            {locale === "ru" ? "Выбрать экскурсию" : "Find an activity"}
            <ArrowUpRight size={16} />
          </Link>
        )}
        <button
          className="menu-toggle"
          aria-label={open ? t.close : t.menu}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" className="mobile-nav" aria-label={t.destinations}>
          <Link onClick={() => setOpen(false)} href={`/${locale}#countries`}>
            {t.destinations}
          </Link>
          <Link onClick={() => setOpen(false)} href={`/${locale}/tours`}>
            {locale === "ru" ? "Экскурсии" : "Excursions"}
          </Link>
          <Link onClick={() => setOpen(false)} href={`/${locale}#approach`}>
            {locale === "ru" ? "О нас" : "About us"}
          </Link>
          <a
            onClick={() => setOpen(false)}
            href={managerContact}
            target="_blank"
            rel="noopener noreferrer"
          >
            {locale === "ru" ? "Связаться в Telegram" : "Contact on Telegram"}
          </a>
          {accountEnabled && (
            <>
              <Link onClick={() => setOpen(false)} href={`/${locale}/account`}>
                {locale === "ru" ? "Личный кабинет" : "My account"}
              </Link>
              <Link
                onClick={() => setOpen(false)}
                href={`/${locale}/account/cart`}
              >
                {locale === "ru" ? "Корзина" : "Cart"}
              </Link>
              <Link
                onClick={() => setOpen(false)}
                href={`/${locale}/account/favorites`}
              >
                {locale === "ru" ? "Избранное" : "Favorites"}
              </Link>
              <Link
                onClick={() => setOpen(false)}
                href={`/${locale}/account/orders`}
              >
                {locale === "ru" ? "Мои заявки" : "My requests"}
              </Link>
            </>
          )}
        </nav>
      )}
    </header>
  );
}
