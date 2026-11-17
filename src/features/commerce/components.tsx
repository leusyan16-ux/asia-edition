"use client";
import { statusLabel, mergeCart } from "./model";
import { commerceAPI, CommerceAPIError } from "./client-api";
import { guestCartKey, readGuestCart, syncGuestCart } from "./cart-sync";
import { trackEvent } from "./analytics";
import { announceCart, refreshCommerceState } from "./browser-state";
import { GuestFavorites } from "./favorite-button";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Locale } from "@/lib/catalog";
import type { CartLine } from "./model";
type Booking = { id: string; status: string; revision: number };
type Item = {
  id: string;
  product_slug: string;
  title: Record<Locale, string>;
  requested_date: string;
  adults: number;
  children: number;
  commerce_bookings: Booking[];
};
type Order = {
  id: string;
  number: string;
  status: string;
  commerce_order_items: Item[];
};
type Document = { id: string; order_id: string; kind: string; version: number };
type Favorite = { product_slug: string };
type Session = {
  user: { id: string; email: string };
  profile?: { display_name: string; phone: string; locale: Locale };
  adminRole?: "owner" | "admin" | null;
};
const key = guestCartKey;
const subscribeToHydration = () => () => {};
function validForm(form: HTMLFormElement, ru: boolean, report: (message: string) => void) {
  const field = Array.from(form.elements).find(
    (element) => element instanceof HTMLInputElement && !element.validity.valid,
  ) as HTMLInputElement | undefined;
  if (!field) return true;
  field.focus();
  report(field.validity.valueMissing
    ? (ru ? "Заполните выделенное поле." : "Fill in the highlighted field.")
    : field.type === "email"
      ? (ru ? "Проверьте адрес электронной почты." : "Enter a valid email address.")
      : field.type === "password"
        ? (ru ? "Пароль должен содержать не менее 12 символов." : "Use at least 12 characters for the password.")
        : (ru ? "Проверьте допустимые значения в выделенном поле." : "Check the allowed values for the highlighted field."));
  return false;
}

const authErrors: Record<string, [string, string]> = {
  invalid_credentials: ["Неверный адрес почты или пароль.", "Incorrect email address or password."],
  email_not_confirmed: ["Подтвердите адрес по ссылке из письма или запросите её повторно.", "Follow the link in your email or request another one."],
  try_later: ["Слишком много попыток. Подождите и повторите.", "Too many attempts. Wait a moment and try again."],
  weak_password: ["Выберите более надёжный пароль.", "Choose a stronger password."],
  auth_service_unavailable: ["Сервис входа и почты временно недоступен.", "Sign-in and email are temporarily unavailable."],
  cart_conflict: ["Корзина изменилась в другой вкладке. Обновите страницу.", "Your cart changed in another tab. Refresh this page."],
};
export function AddToRequest({
  slug,
  locale,
}: {
  slug: string;
  locale: Locale;
}) {
  const ru = locale === "ru";
  const [message, setMessage] = useState("");
  const [saving,setSaving]=useState(false);
  const ready = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  return (
    <form
      id={`activity-request-${slug}`}
      className="commerce-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if(saving) return;
        if (!validForm(e.currentTarget, ru, setMessage)) return;
        const fields = new FormData(e.currentTarget);
        setSaving(true);
        setMessage("");
        try {
          const row = {
            slug,
            date: String(fields.get("date")),
            adults: Number(fields.get("adults")),
            children: Number(fields.get("children")),
            options: String(fields.get("options") ?? ""),
          };
          const next = mergeCart(readGuestCart(localStorage), [row]);
          localStorage.setItem(key, JSON.stringify(next));
          announceCart(next.length);
          trackEvent("cart_add", slug);
          try {
            const synced=await syncGuestCart(commerceAPI, localStorage);
            announceCart(synced?.items.length ?? next.length);
          } catch (error) {
            if (!(error instanceof CommerceAPIError && error.status === 401)) {
              setMessage(
                ru
                  ? "Сохранено в браузере. Синхронизация пока недоступна; повторите в корзине."
                  : "Saved in this browser. Sync is unavailable; retry from your cart.",
              );
              return;
            }
          }
          setMessage(
            ru ? "Добавлено в корзину заявок." : "Added to your request cart.",
          );
        } catch {
          setMessage(
            ru
              ? "Не удалось сохранить. Проверьте доступ к хранилищу браузера."
              : "Unable to save. Check browser storage permissions.",
          );
        } finally { setSaving(false); }
      }}
    >
      <h2>{ru ? "Добавить в заявку" : "Add to a request"}</h2>
      <label>
        {ru
          ? "Пожелания (не подтверждённый тариф)"
          : "Preferences (not a confirmed package)"}
        <textarea
          name="options"
          maxLength={1000}
        />
      </label>
      <p>
        {ru
          ? "Дата — пожелание, а не подтверждённый свободный слот."
          : "Your date is a preference, not a confirmed available slot."}
      </p>
      <label>
        {ru ? "Желаемая дата" : "Preferred date"}
        <input
          name="date"
          type="date"
          required
          min={new Date().toISOString().slice(0, 10)}
        />
      </label>
      <label>
        {ru ? "Взрослые" : "Adults"}
        <input
          name="adults"
          type="number"
          required
          min="1"
          max="20"
          defaultValue={1}
        />
      </label>
      <label>
        {ru ? "Дети" : "Children"}
        <input
          name="children"
          type="number"
          required
          min="0"
          max="20"
          defaultValue={0}
        />
      </label>
      <button className="primary-button" disabled={!ready||saving}>
        {ru ? "Добавить в корзину" : "Add to cart"}
      </button>
      <a href={`/${locale}/account/cart`}>
        {ru ? "Перейти в корзину" : "Open cart"}
      </a>
      <p role="status">{message}</p>
    </form>
  );
}
export function AccountPanel({
  locale,
  section,
  googleEnabled = false,
  authNotice,
}: {
  locale: Locale;
  section: string;
  googleEnabled?: boolean;
  authNotice?: "confirmed" | "expired";
}) {
  const ru = locale === "ru";
  const [session, setSession] = useState<Session | null>(null),
    [orders, setOrders] = useState<Order[]>([]),
    [docs, setDocs] = useState<Document[]>([]),
    [favorites, setFavorites] = useState<Favorite[]>([]),
    [cart, setCart] = useState<CartLine[]>([]),
    [revision, setRevision] = useState(0),
    [message, setMessage] = useState(authNotice === "expired"
      ? (ru ? "Ссылка недействительна или уже использована. Запросите новую." : "The link is invalid or already used. Request a new one.")
      : ""),
    [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false),
    [chatDraft, setChatDraft] = useState<{ number: string; url?: string } | null>(null),
    [mode, setMode] = useState("login"),
    [resendEmail, setResendEmail] = useState(""),
    [resendAfter, setResendAfter] = useState(0),
    [productTitles, setProductTitles] = useState<
      Record<string, Record<Locale, string>>
    >({});
  const api = commerceAPI;
  async function reload() {
    let identity;
    try {
      identity = await api(section === "cart" ? "session?view=cart" : "session");
    } catch (error) {
      if (!(error instanceof CommerceAPIError && error.status === 401))
        throw error;
    }
    setSession(identity ?? null);
    if (identity) {
      const showOrders = section === "" || section === "orders";
      const [o, d, f, c] = await Promise.all([
        showOrders ? api("orders") : [],
        showOrders ? api("documents") : [],
        section === "favorites" ? api("favorites") : [],
        localStorage.getItem(key) ? syncGuestCart(api, localStorage) : identity.cart,
      ]);
      setOrders(o);
      setDocs(d);
      setFavorites(f);
      setCart(c?.items ?? []);
      setRevision(c?.revision ?? 0);
      if(section === "favorites" && f.length) {
        const products = await api("products?slugs="+f.slice(0,20).map((item:Favorite)=>item.product_slug).join(","));
        setProductTitles(Object.fromEntries(products.map((p:{slug:string;title:Record<Locale,string>})=>[p.slug,p.title])));
      }
      if (section === "cart" && c?.items.length) {
        const products = await api("products?slugs=" + c.items.map((item: CartLine) => item.slug).join(","));
        setProductTitles(Object.fromEntries(products.map((p: { slug: string; title: Record<Locale, string> }) => [p.slug, p.title])));
      }
    } else {
      try {
        setCart(mergeCart([], JSON.parse(localStorage.getItem(key) ?? "[]")));
      } catch {
        setCart([]);
      }
    }
    let requested: CartLine[] = [];
    if (!identity && section === "cart") {
      try { requested = readGuestCart(localStorage); } catch {}
    }
    if (requested.length) {
      const products = await api(
        "products?slugs=" + requested.map((i) => i.slug).join(","),
      );
      setProductTitles(
        Object.fromEntries(
          products.map((p: { slug: string; title: Record<Locale, string> }) => [
            p.slug,
            p.title,
          ]),
        ),
      );
    }
    if(section === "cart") void refreshCommerceState();
    setLoading(false);
  }
  // Account state is loaded from the authorized API, never from a user-controlled identity.
  useEffect(() => {
    const refreshIdentity = () => { void reload().catch(() => {}); };
    window.addEventListener("ae-session-changed",refreshIdentity);
    // Initial authenticated network load; state changes follow asynchronous requests.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload().catch(() => {
      setMessage(
        ru
          ? "Сервис временно недоступен. Повторите позже."
          : "Service unavailable. Please try again later.",
      );
      setLoading(false);
    });
    return () => window.removeEventListener("ae-session-changed",refreshIdentity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // initial account load; actions refresh explicitly
  async function perform(work: () => Promise<void>) {
    setPending(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      const localized = error instanceof CommerceAPIError ? authErrors[error.message] : undefined;
      setMessage(localized?.[ru ? 0 : 1] ?? (
        error instanceof CommerceAPIError && ["requests_disabled", "chat_unavailable"].includes(error.message)
          ? (ru ? "Оформление через чат временно недоступно. Корзина сохранена." : "Chat requests are temporarily unavailable. Your cart is saved.")
          : ru
          ? "Действие не выполнено. Проверьте данные и повторите."
          : "Action not completed. Check the information and try again."),
      );
    } finally {
      setPending(false);
    }
  }
  const notice = ru
    ? "Итоговая стоимость зависит от выбранных услуг и подтверждается при оформлении в чате."
    : "The final price depends on the selected services and is confirmed when arranging the booking in chat.";
  if (loading) return (
    <div className="commerce-surface commerce-loading" role="status" aria-busy="true">
      <p>{ru ? "Загружаем ваш кабинет…" : "Loading your account…"}</p>
      <div aria-hidden="true" />
      <div aria-hidden="true" />
    </div>
  );
  return (
    <div className="commerce-panel">
      {!session && section==="favorites"&&<GuestFavorites locale={locale}/>}
      {session?.adminRole && (
        <nav className="commerce-links" aria-label={ru ? "Управление" : "Administration"}>
          <Link href="/admin/analytics">{ru ? "Панель управления" : "Admin dashboard"}</Link>
        </nav>
      )}
      <p className="commerce-notice" role="status" aria-live="polite">
        {message || (session && authNotice === "confirmed"
          ? (ru ? "Адрес подтверждён. Вы вошли в аккаунт." : "Email confirmed. You’re signed in.")
          : "")}
      </p>
      {!session && googleEnabled && (
        <button
          disabled={pending}
          onClick={() =>
            void perform(async () => {
              const result = await api("oauth", { locale });
              if (result.url) window.location.assign(result.url);
            })
          }
        >
          {ru ? "Войти через Google" : "Continue with Google"}
        </button>
      )}
      {!session && section !== "cart" && (
        <form
          className="commerce-form commerce-surface"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!validForm(e.currentTarget, ru, setMessage)) return;
            const f = new FormData(e.currentTarget);
            void perform(async () => {
              const email = String(f.get("email")).trim();
              setResendEmail(mode === "reset" ? "" : email);
              const result = await api(mode, {
                email,
                password: f.get("password"),
                locale,
              });
              if (mode === "login" || result.status === "signed_in") {
                trackEvent(mode === "login" ? "login" : "register");
                await refreshCommerceState();
                await reload();
                window.dispatchEvent(new Event("ae-session-changed"));
                setMessage(ru ? "Вход выполнен." : "Signed in.");
              } else if (mode === "register") {
                trackEvent("register");
                setResendAfter(Date.now() + 60_000);
                setMessage(ru
                  ? "Проверьте почту и перейдите по ссылке для подтверждения адреса."
                  : "Check your inbox and follow the link to confirm your email.");
              } else
                setMessage(
                  ru
                    ? "Проверьте почту. Если действие доступно, придёт письмо с инструкцией."
                    : "Check your email. Instructions will be sent if the action is available.",
                );
            });
          }}
        >
          <h2>
            {mode === "login"
              ? ru
                ? "Войти"
                : "Sign in"
              : mode === "register"
                ? ru
                  ? "Создать аккаунт"
                  : "Create an account"
                : ru
                  ? "Восстановить пароль"
                  : "Reset password"}
          </h2>
          <label>
            Email
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              maxLength={254}
            />
          </label>
          {mode !== "reset" && (
            <label>
              {ru
                ? (mode === "login" ? "Пароль" : "Пароль — от 12 символов")
                : (mode === "login" ? "Password" : "Password — at least 12 characters")}
              <input
                name="password"
                type="password"
                required
                minLength={mode === "login" ? undefined : 12}
                maxLength={128}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
              />
            </label>
          )}
          <button disabled={pending} className="primary-button">
            {mode === "login" ? (ru ? "Войти" : "Sign in") :
              mode === "register" ? (ru ? "Создать аккаунт" : "Create account") :
                (ru ? "Запросить ссылку" : "Request reset link")}
          </button>
          {resendEmail && mode !== "reset" && (
            <button type="button" disabled={pending} onClick={() => {
              if (Date.now() < resendAfter) {
                setMessage(ru ? "Подождите минуту между запросами." : "Wait a minute between requests.");
                return;
              }
              void perform(async () => {
                await api("resend", { email: resendEmail, locale });
                setResendAfter(Date.now() + 60_000);
                setMessage(ru ? "Если адрес ещё не подтверждён, проверьте почту и откройте ссылку." :
                  "If the address is still unconfirmed, check your inbox and open the link.");
              });
            }}>{ru ? "Запросить ссылку повторно" : "Request another confirmation link"}</button>
          )}
          <div className="commerce-links">
            {["login", "register", "reset"]
              .filter((m) => m !== mode)
              .map((m) => (
                <button type="button" key={m} onClick={() => setMode(m)}>
                  {m === "login"
                    ? ru
                      ? "Войти"
                      : "Sign in"
                    : m === "register"
                      ? ru
                        ? "Регистрация"
                        : "Register"
                      : ru
                        ? "Забыли пароль?"
                        : "Forgot password?"}
                </button>
              ))}
          </div>
        </form>
      )}
      {section === "cart" && (
        <section>
          <h2>{ru ? "Корзина заявок" : "Request cart"}</h2>
          <p>{notice}</p>
          {!cart.length && !chatDraft && (
            <p>
              {ru
                ? "Добавьте экскурсии из каталога."
                : "Add activities from the catalog."}
            </p>
          )}
          {!chatDraft && cart.map((line, i) => (
            <article className="commerce-row" key={line.slug + line.date}>
              <a href={`/${locale}/tours/${line.slug}`}>
                {productTitles[line.slug]?.[locale] ??
                  (ru ? "Экскурсия недоступна" : "Activity unavailable")}
              </a>
              <span>
                {line.date} · {ru ? "Взрослые" : "Adults"}: {line.adults} ·{" "}
                {ru ? "Дети" : "Children"}: {line.children}
              </span>
              <button
                disabled={pending}
                onClick={() =>
                  void perform(async () => {
                    const next = cart.filter((_, n) => n !== i);
                    trackEvent("cart_remove");
                    if (session) {
                      await api("cart", {
                        items: next,
                        revision,
                        replace: true,
                      });
                      announceCart(next.length);
                      await reload();
                    } else {
                      localStorage.setItem(key, JSON.stringify(next));
                      setCart(next);
                      announceCart(next.length);
                    }
                  })
                }
              >
                {ru ? "Удалить" : "Remove"}
              </button>
            </article>
          ))}
          {chatDraft && (
            <div className="commerce-form">
              <h2>{ru ? "Заявка отправлена!" : "Your request has been submitted!"}</h2>
              <p>{ru ? "Мы скоро свяжемся с вами для уточнения деталей." : "We'll contact you shortly to confirm the details."}</p>
              <p>{ru ? "Номер заявки" : "Request number"} · <strong>{chatDraft.number}</strong></p>
              {chatDraft.url && <a href={chatDraft.url} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("telegram")}>
                {ru ? "Написать нам в Telegram" : "Message us on Telegram"}
              </a>}
            </div>
          )}
          {cart.length > 0 && !chatDraft &&
            (session ? (
              <form className="commerce-form commerce-surface" noValidate onSubmit={(event) => {
                  event.preventDefault();
                  if (!validForm(event.currentTarget, ru, setMessage)) return;
                  const form = new FormData(event.currentTarget);
                  if (!String(form.get("name")).trim()) {
                    setMessage(ru ? "Укажите ваше имя." : "Enter your name.");
                    return;
                  }
                  void perform(async () => {
                    trackEvent("checkout");
                    const fingerprint = JSON.stringify({
                      user: session.user.id,
                      locale,
                      items: cart,
                    });
                    let stored: { key: string; fingerprint: string } | null =
                      null;
                    try {
                      stored = JSON.parse(
                        sessionStorage.getItem("ae-request-key") ?? "null",
                      );
                    } catch {}
                    const requestKey =
                      stored?.fingerprint === fingerprint
                        ? stored.key
                        : crypto.randomUUID();
                    sessionStorage.setItem(
                      "ae-request-key",
                      JSON.stringify({ key: requestKey, fingerprint }),
                    );
                    const result = await api("request", {
                      key: requestKey,
                      locale,
                      items: cart,
                      contact: { name: form.get("name"), phone: form.get("phone") },
                    });
                    trackEvent("request_success");
                    const chatUrl = result.chat?.url ? new URL(result.chat.url) : null;
                    if (chatUrl) chatUrl.hash = "";
                    setChatDraft({ number: result.number ?? result.id, url: chatUrl?.href });
                    try {
                      await api("cart", { items: [], revision, replace: true });
                      sessionStorage.removeItem("ae-request-key");
                      setCart([]);
                      announceCart(0);
                      await reload();
                    } catch {
                      setMessage(ru
                        ? "Заявка сохранена. Обновите страницу, чтобы проверить корзину."
                        : "Request saved. Refresh the page to check your cart.");
                    }
                  });
                }}>
                <label>{ru ? "Имя" : "Name"}
                  <input name="name" required maxLength={120} autoComplete="name" defaultValue={session.profile?.display_name} />
                </label>
                <label>{ru ? "Телефон (по желанию)" : "Phone (optional)"}
                  <input name="phone" type="tel" maxLength={40} autoComplete="tel" defaultValue={session.profile?.phone ?? ""} />
                </label>
                <p>{ru
                  ? "Контакты из заявки получит менеджер. Он уточнит наличие мест, цену и условия оплаты в чате."
                  : "The manager receives your contact details and confirms availability, pricing and payment in chat."}</p>
                <button className="primary-button" disabled={pending}>
                  {ru ? "Отправить заявку" : "Submit request"}
                </button>
              </form>
            ) : (
              <a href={`/${locale}/account`}>
                {ru
                  ? "Войдите для отправки заявки"
                  : "Sign in to send a request"}
              </a>
            ))}
        </section>
      )}
      {session && (
        <>
          <p>{session.user.email}</p>
          {section === "profile" && (
            <form
              className="commerce-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void perform(async () => {
                  await api("profile", {
                    display_name: f.get("display_name"),
                    phone: f.get("phone"),
                    locale: f.get("locale"),
                  });
                  await reload();
                  setMessage(ru ? "Профиль сохранён." : "Profile saved.");
                });
              }}
            >
              <label>
                {ru ? "Имя" : "Name"}
                <input
                  name="display_name"
                  maxLength={120}
                  defaultValue={session.profile?.display_name ?? ""}
                />
              </label>
              <label>
                {ru ? "Телефон" : "Phone"}
                <input
                  name="phone"
                  type="tel"
                  maxLength={40}
                  defaultValue={session.profile?.phone ?? ""}
                />
              </label>
              <label>
                {ru ? "Язык" : "Language"}
                <select
                  name="locale"
                  defaultValue={session.profile?.locale ?? locale}
                >
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                </select>
              </label>
              <button disabled={pending} className="primary-button">
                {ru ? "Сохранить" : "Save"}
              </button>
              <a download href="/api/commerce/export">
                {ru ? "Скачать персональные данные" : "Export personal data"}
              </a>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (
                    window.confirm(
                      ru
                        ? "Отправить запрос удаления? Учётные документы сохраняются по правилам хранения."
                        : "Request deletion? Accounting records remain subject to retention rules.",
                    )
                  )
                    void perform(async () => {
                      await api("privacy", {});
                      setMessage(
                        ru
                          ? "Запрос принят. Профиль очищен; удаление аккаунта и сроки хранения проверит сотрудник."
                          : "Request received. Profile cleared; an operator will review account deletion and retention.",
                      );
                    });
                }}
              >
                {ru ? "Запросить удаление данных" : "Request data deletion"}
              </button>
            </form>
          )}
          {section === "profile" && <AccountSecurity locale={locale} />}
          {section === "password" && (
            <form
              className="commerce-form commerce-surface"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (!validForm(e.currentTarget, ru, setMessage)) return;
                const f = new FormData(e.currentTarget);
                void perform(async () => {
                  await api("password", { password: f.get("password") });
                  setMessage(ru ? "Пароль обновлён." : "Password updated.");
                });
              }}
            >
              <label>
                {ru ? "Новый пароль" : "New password"}
                <input
                  type="password"
                  name="password"
                  minLength={12}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                />
              </label>
              <button disabled={pending}>
                {ru ? "Обновить пароль" : "Update password"}
              </button>
            </form>
          )}
          {["orders", ""].includes(section) && (
            <section>
              <h2>{ru ? "Мои заявки" : "My requests"}</h2>
              {!orders.length && (
                <p>
                  {ru ? "У вас пока нет заявок." : "You have no requests yet."}
                </p>
              )}
              {orders.map((o) => (
                <details key={o.id} className="commerce-order">
                  <summary>
                    {o.number} · {statusLabel(o.status, locale)}
                  </summary>
                  <p>{notice}</p>
                  {o.commerce_order_items.map((item: Item) => (
                    <article key={item.id} className="commerce-row">
                      <a href={`/${locale}/tours/${item.product_slug}`}>
                        {item.title[locale]}
                      </a>
                      <span>
                        {item.requested_date} · {item.adults} + {item.children}
                      </span>
                      {item.commerce_bookings.map((b: Booking) => (
                        <div key={b.id}>
                          <span>{statusLabel(b.status, locale)}</span>
                          {["requested", "awaiting_availability"].includes(
                            b.status,
                          ) && (
                            <button
                              disabled={pending}
                              onClick={() =>
                                void perform(async () => {
                                  await api("transition", {
                                    booking: b.id,
                                    revision: b.revision,
                                    target: "cancelled",
                                    basis: "Customer cancellation requested",
                                  });
                                  await reload();
                                })
                              }
                            >
                              {ru ? "Отозвать заявку" : "Withdraw request"}
                            </button>
                          )}
                        </div>
                      ))}
                    </article>
                  ))}
                  {docs
                    .filter((d) => d.order_id === o.id)
                    .map((d) => (
                      <p key={d.id}>
                        <a
                          href={`/api/commerce/document/${d.id}?locale=${locale}`}
                        >
                          {d.kind === "voucher"
                            ? ru
                              ? "Ваучер"
                              : "Voucher"
                            : ru
                              ? "Получение заявки — PDF"
                              : "Request receipt — PDF"}{" "}
                          · v{d.version}
                        </a>
                      </p>
                    ))}
                </details>
              ))}
            </section>
          )}
          {section === "favorites" && (
            <section>
              <h2>{ru ? "Избранное" : "Favorites"}</h2>
              {!favorites.length && (
                <p>{ru ? "В избранном пока пусто." : "No favorites yet."}</p>
              )}
              {favorites.map((f) => (
                <div className="commerce-row" key={f.product_slug}>
                  <a href={`/${locale}/tours/${f.product_slug}`}>
                    {productTitles[f.product_slug]?.[locale] ?? (ru?"Открыть экскурсию":"View activity")}
                  </a>
                  <button
                    onClick={() =>
                      void perform(async () => {
                        await api("favorite", {
                          slug: f.product_slug,
                          remove: true,
                        });
                        window.dispatchEvent(new Event("ae-favorites-changed"));
                        await reload();
                      })
                    }
                  >
                    {ru ? "Удалить" : "Remove"}
                  </button>
                </div>
              ))}
            </section>
          )}
          <button
            disabled={pending}
            onClick={() =>
              void perform(async () => {
                await api("logout", {});
                setChatDraft(null);
                setSession(null);
                setOrders([]);
                setDocs([]);
                setFavorites([]);
                setCart([]);
                window.dispatchEvent(new Event("ae-session-changed"));
              })
            }
          >
            {ru ? "Выйти" : "Sign out"}
          </button>
        </>
      )}
      <p>
        <a href={`/${locale}/tours`}>
          {ru ? "Вернуться в каталог" : "Back to catalog"}
        </a>
      </p>
    </div>
  );
}
export { FavoriteButton } from "./favorite-button";
function AccountSecurity({ locale }: { locale: Locale }) {
  const ru = locale === "ru";
  const [factor, setFactor] = useState(""),
    [qr, setQR] = useState(""),
    [message, setMessage] = useState("");
  async function post(action: string, body: unknown) {
    const r = await fetch("/api/commerce/" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw Error();
    return r.json();
  }
  return (
    <section>
      <h2>{ru ? "Безопасность" : "Security"}</h2>
      <p>
        {ru
          ? "MFA обязательна для сотрудников. На новом устройстве используйте зарегистрированный фактор."
          : "MFA is required for staff. On a new device, use your previously enrolled factor."}
      </p>
      <button
        onClick={async () => {
          try {
            const factors = await (
              await fetch("/api/commerce/mfa-factors")
            ).json();
            if (factors.length) {
              setFactor(factors[0].id);
              setMessage(
                ru
                  ? "Введите код из приложения."
                  : "Enter your authenticator code.",
              );
            } else {
              const result = await post("mfa-enroll", {});
              setFactor(result.id);
              setQR(result.qr);
            }
          } catch {
            setMessage(ru ? "MFA недоступна." : "MFA unavailable.");
          }
        }}
      >
        {ru ? "Настроить / подтвердить MFA" : "Set up / verify MFA"}
      </button>
      {qr && (
        <div>
          {/* Supabase-generated QR, never arbitrary HTML. */}
          <Image
            unoptimized
            src={qr}
            width={220}
            height={220}
            alt={
              ru ? "QR для приложения аутентификации" : "Authenticator QR code"
            }
          />
        </div>
      )}
      {factor && (
        <form
          className="commerce-form"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (!validForm(e.currentTarget, ru, setMessage)) return;
            const f = new FormData(e.currentTarget);
            try {
              await post("mfa-verify", { factor, code: f.get("code") });
              window.dispatchEvent(new Event("ae-session-changed"));
              setQR("");
              setMessage(ru ? "MFA подтверждена." : "MFA verified.");
            } catch {
              setMessage(ru ? "Код не принят." : "Code not accepted.");
            }
          }}
        >
          <label>
            {ru ? "Код из приложения" : "Authenticator code"}
            <input
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoComplete="one-time-code"
            />
          </label>
          <button>{ru ? "Подтвердить" : "Verify"}</button>
        </form>
      )}
      <form
        className="commerce-form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!validForm(e.currentTarget, ru, setMessage)) return;
          try {
            const f = new FormData(e.currentTarget);
            await post("invite-accept", { token: f.get("token") });
            setMessage(
              ru
                ? "Приглашение принято. Для рабочих действий подтвердите MFA."
                : "Invitation accepted. Verify MFA for staff actions.",
            );
          } catch {
            setMessage(
              ru
                ? "Приглашение недействительно или не относится к вашему email."
                : "Invitation invalid or not issued to your email.",
            );
          }
        }}
      >
        <label>
          {ru ? "Токен приглашения сотрудника" : "Staff invitation token"}
          <input
            name="token"
            pattern="[a-f0-9]{64}"
            maxLength={64}
            required
            autoComplete="off"
          />
        </label>
        <button>{ru ? "Принять приглашение" : "Accept invitation"}</button>
      </form>
      <a href={`/${locale}/account/password`}>
        {ru ? "Изменить пароль" : "Change password"}
      </a>
      <p role="status">{message}</p>
    </section>
  );
}
