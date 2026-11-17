"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  LogOut,
  Save,
  Copy,
  Archive,
  Search,
  Upload,
} from "lucide-react";
import { adminCountries as countries } from "@/lib/catalog";
import type { OverviewPagination } from "./overview-query";
import {
  missingInformation,
  type AdminTour,
  type AdminTaxonomy,
  type AdminSummary,
} from "./model";

async function api(url: string, method: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: "no-store",
      headers:
        body instanceof FormData
          ? undefined
          : { "Content-Type": "application/json" },
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
  } catch {
    throw new Error("Сеть недоступна. Проверьте соединение и повторите.");
  }
  const data = await response.json().catch(() => {
    throw new Error("Сервер не ответил. Обновите страницу и повторите.");
  });
  if (!response.ok)
    throw new Error(data.error || "Не удалось выполнить запрос");
  return data;
}
export function Logout() {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div>
      <button
        className="admin-quiet"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api("/admin/api/session", "DELETE");
            router.push("/admin/login");
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <LogOut size={16} /> Выйти
      </button>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
    </div>
  );
}
export function Login({ ready, mode }: { ready: boolean; mode: string }) {
  const router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="admin-login">
      <h1>Вход в управление</h1>
      <p>Доступ к экскурсиям ASIA EDITION для администраторов.</p>
      {mode === "local" && (
        <p className="admin-notice">
          Локальная разработка. Данные сохраняются только на этом компьютере.
        </p>
      )}
      {!ready ? (
        <div className="admin-notice">
          <strong>Доступ ещё не настроен</strong>
          <p>
            Для разработки: запустите <code>pnpm admin:setup</code>, добавьте{" "}
            <code>ADMIN_MODE=local</code> в .env.local и перезапустите pnpm dev.
            В production настройте Supabase и роль администратора.
          </p>
          <Link href="/ru">Вернуться на сайт</Link>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const f = new FormData(e.currentTarget);
              await api("/admin/api/session", "POST", {
                email: f.get("email"),
                password: f.get("password"),
              });
              router.push("/admin");
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
            />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
            />
          </label>
          {error && (
            <p role="alert" className="admin-error">
              {error}
            </p>
          )}
          <button className="admin-primary" disabled={busy}>
            {busy ? "Вход…" : "Войти"}
          </button>
          <p>Сессия действует до одного часа. После истечения войдите снова.</p>
        </form>
      )}
    </div>
  );
}
const statusNames = {
  draft: "Черновик",
  published: "Опубликовано",
  unavailable: "Недоступно",
};
export function Inventory({
  tours,
  pagination,
}: {
  tours: AdminSummary[];
  pagination?: OverviewPagination;
}) {
  const router = useRouter();
  const filterKey = (
    q: Pick<OverviewPagination, "search" | "country" | "status" | "page">,
  ) => JSON.stringify([q.search, q.country, q.status, q.page]);
  const seen = useRef(pagination ? filterKey(pagination) : ""),
    requested = useRef("");
  const [search, setSearch] = useState(pagination?.search || ""),
    [country, setCountry] = useState(pagination?.country || ""),
    [status, setStatus] = useState(pagination?.status || ""),
    [page, setPage] = useState(pagination?.page || 1);
  useEffect(() => {
    if (pagination) {
      const key = filterKey(pagination);
      if (key !== seen.current) {
        seen.current = key;
        if (key !== requested.current) {
          setSearch(pagination.search);
          setCountry(pagination.country);
          setStatus(pagination.status);
          setPage(pagination.page);
          return;
        }
      }
    }
    if (
      !pagination ||
      (search === pagination.search &&
        country === pagination.country &&
        status === pagination.status &&
        page === pagination.page)
    )
      return;
    const timer = setTimeout(() => {
      requested.current = filterKey({ search, country, status, page });
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (country) params.set("country", country);
      if (status) params.set("status", status);
      params.set("page", String(page));
      router.replace("/admin?" + params.toString(), { scroll: false });
    }, 250);
    return () => clearTimeout(timer);
  }, [search, country, status, page, pagination, router]);
  const filtered = pagination
    ? tours
    : tours.filter(
        (t) =>
          (!country || t.country === country) &&
          (!status ||
            (status === "archived"
              ? t.archived
              : !t.archived && t.status === status)) &&
          `${t.title.ru} ${t.title.en} ${t.slug}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      );
  const pages = Math.max(
      1,
      Math.ceil((pagination?.total ?? filtered.length) / 25),
    ),
    current = Math.min(page, pages);
  return (
    <>
      <div className="admin-toolbar">
        <label>
          <span>
            <Search size={16} /> Поиск экскурсии
          </span>
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Название или адрес"
          />
        </label>
        <label>
          Страна
          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Все 13 стран</option>
            {countries.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name.ru}
              </option>
            ))}
          </select>
        </label>
        <label>
          Статус
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Все статусы</option>
            {Object.entries(statusNames).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
            <option value="archived">Архив</option>
          </select>
        </label>
      </div>
      <p>{pagination?.total ?? filtered.length} экскурсий</p>
      {!filtered.length ? (
        <div className="admin-empty">
          <h2>
            {tours.length || search || country || status
              ? "Нет совпадений"
              : "Ваш каталог начинается здесь"}
          </h2>
          <p>
            {tours.length || search || country || status
              ? "Измените фильтры или поисковый запрос."
              : "Добавьте проверенную экскурсию или загрузите CSV. Новые записи остаются черновиками до публикации."}
          </p>
          <Link className="admin-primary" href="/admin/tours/new">
            <Plus size={16} /> Добавить экскурсию
          </Link>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Экскурсия</th>
                <th>Страна</th>
                <th>Статус</th>
                <th>Проверка</th>
                <th>Обновлено</th>
              </tr>
            </thead>
            <tbody>
              {(pagination
                ? filtered
                : filtered.slice((current - 1) * 25, current * 25)
              ).map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/admin/tours/${t.id}`}>
                      <strong>{t.title.ru}</strong>
                      <small>
                        {t.slug}
                        {t.isDemo ? " · Демонстрация" : ""}
                        {t.featured ? " · Рекомендуемая" : ""}
                      </small>
                    </Link>
                  </td>
                  <td>
                    {countries.find((c) => c.slug === t.country)?.name.ru}
                  </td>
                  <td>
                    <span className={`admin-status ${t.status}`}>
                      {t.archived ? "Архив" : statusNames[t.status]}
                    </span>
                    {!t.visible && <small>Скрыта</small>}
                  </td>
                  <td>
                    {t.missing.length
                      ? `Требует проверки: ${t.missing.length}`
                      : "Готова к публикации"}
                  </td>
                  <td>
                    {t.updatedAt
                      ? new Date(t.updatedAt).toLocaleDateString("ru-RU")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className="admin-pagination" aria-label="Страницы каталога">
        <button disabled={current <= 1} onClick={() => setPage(current - 1)}>
          Назад
        </button>
        <span>
          {current} / {pages}
        </span>
        <button
          disabled={current >= pages}
          onClick={() => setPage(current + 1)}
        >
          Далее
        </button>
      </nav>
    </>
  );
}
type Path = (string | number)[];
function localTime(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function get(value: unknown, path: Path): unknown {
  return path.reduce<unknown>(
    (o, k) => (o as Record<string | number, unknown>)?.[k],
    value,
  );
}
function replace<T>(source: T, path: Path, value: unknown): T {
  const copy = structuredClone(source);
  let at = copy as unknown as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) {
    if (at[key] === null || at[key] === undefined)
      at[key] = ["ru", "en"].includes(String(path[path.indexOf(key) + 1]))
        ? { ru: "", en: "" }
        : {};
    at = at[key] as Record<string | number, unknown>;
  }
  at[path.at(-1)!] = value;
  return copy;
}
const text = { ru: "", en: "" };
export function TourEditor({
  initial,
  taxonomy,
  isNew,
  publicationDisabled = false,
  retainMedia = false,
}: {
  initial: AdminTour;
  taxonomy: AdminTaxonomy;
  isNew: boolean;
  publicationDisabled?: boolean;
  retainMedia?: boolean;
}) {
  const router = useRouter();
  const [tour, setTour] = useState(initial),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [removed, setRemoved] = useState<string[]>([]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function set(path: Path, value: unknown) {
    setTour((t) =>
      path.length === 1 && path[0] === "country"
        ? {
            ...replace(t, path, value),
            location: "",
            city: null,
            resort: null,
            pickupLocations: [],
          }
        : replace(t, path, value),
    );
    setDirty(true);
    setMessage("");
  }
  const field = (
    label: string,
    path: Path,
    kind:
      "text" | "area" | "number" | "date" | "time" | "datetime-local" = "text",
    required = false,
  ) => (
    <label key={path.join(".")} className={kind === "area" ? "admin-wide" : ""}>
      {label}
      {kind === "area" ? (
        <textarea
          aria-label={label}
          rows={3}
          value={String(get(tour, path) ?? "")}
          onChange={(e) => set(path, e.target.value)}
          maxLength={30000}
        />
      ) : (
        <input
          type={kind}
          required={required}
          value={
            kind === "datetime-local"
              ? localTime(get(tour, path))
              : String(get(tour, path) ?? "")
          }
          step={kind === "number" ? "any" : undefined}
          onChange={(e) =>
            set(
              path,
              kind === "number"
                ? e.target.value === ""
                  ? null
                  : Number(e.target.value)
                : kind === "datetime-local"
                  ? e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null
                  : kind === "date"
                    ? e.target.value || null
                    : e.target.value,
            )
          }
          maxLength={2000}
        />
      )}
    </label>
  );
  const bilingual = (label: string, path: Path, area = false) => (
    <div className="admin-fields" key={path.join(".")}>
      {field(`${label} · RU`, [...path, "ru"], area ? "area" : "text")}
      {field(`${label} · EN`, [...path, "en"], area ? "area" : "text")}
    </div>
  );
  const lines = (label: string, path: Path) => (
    <div className="admin-fields" key={path.join(".")}>
      {(["ru", "en"] as const).map((lang) => (
        <label key={lang}>
          {label} · {lang.toUpperCase()}
          <textarea
            aria-label={`${label} · ${lang.toUpperCase()}`}
            rows={4}
            value={((get(tour, [...path, lang]) || []) as string[]).join("\n")}
            onChange={(e) => set([...path, lang], e.target.value.split("\n"))}
            maxLength={30000}
          />
          <small>Каждый пункт — с новой строки</small>
        </label>
      ))}
    </div>
  );
  const select = (
    label: string,
    path: Path,
    options: { value: string; label: string }[],
    nullable = false,
  ) => (
    <label key={path.join(".")}>
      {label}
      <select
        aria-label={label}
        value={String(get(tour, path) ?? "")}
        onChange={(e) =>
          set(path, nullable ? e.target.value || null : e.target.value)
        }
      >
        <option value="">Не выбрано</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const repeat = (
    label: string,
    path: Path,
    template: unknown,
    render: (path: Path, index: number) => React.ReactNode,
  ) => {
    const values = (get(tour, path) || []) as unknown[];
    return (
      <div className="admin-repeater">
        <h3>{label}</h3>
        {values.map((_, i) => (
          <div className="admin-repeat-row" key={i}>
            <div className="admin-repeat-head">
              <strong>
                {label} {i + 1}
              </strong>
              <div>
                <button
                  type="button"
                  aria-label={`Поднять ${label} ${i + 1}`}
                  disabled={i === 0}
                  onClick={() => {
                    const next = [...values];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    set(path, next);
                  }}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Опустить ${label} ${i + 1}`}
                  disabled={i === values.length - 1}
                  onClick={() => {
                    const next = [...values];
                    [next[i + 1], next[i]] = [next[i], next[i + 1]];
                    set(path, next);
                  }}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Удалить ${label} ${i + 1}`}
                  onClick={() =>
                    set(
                      path,
                      values.filter((_, n) => n !== i),
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            {render([...path, i], i)}
          </div>
        ))}
        <button
          type="button"
          className="admin-quiet"
          onClick={() => set(path, [...values, structuredClone(template)])}
        >
          <Plus size={16} /> Добавить
        </button>
      </div>
    );
  };
  const locations = taxonomy.locations.filter(
    (l) => l.country === tour.country,
  );
  async function save(next = tour, newRecord = isNew) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { tours } = await api("/admin/api/tours", "POST", {
        tours: [next],
        expected: newRecord ? {} : { [next.id]: tour.updatedAt },
      });
      let cleanupFailed = false;
      for (const url of removed) {
        try {
          await api("/admin/api/images", "DELETE", { url });
        } catch {
          cleanupFailed = true;
        }
      }
      setRemoved([]);
      setDirty(false);
      setTour(tours[0]);
      if (newRecord) router.replace(`/admin/tours/${tours[0].id}`);
      router.refresh();
      setMessage(
        cleanupFailed
          ? "Экскурсия сохранена. Некоторые файлы остались в хранилище; проверьте ссылки в других экскурсиях."
          : "Экскурсия сохранена",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    setBusy(true);
    setError("");
    const added: AdminTour["images"] = [];
    try {
      for (const file of Array.from(files)) {
        if (tour.images.length + added.length >= 40)
          throw new Error("Не более 40 фотографий");
        const form = new FormData();
        form.set("image", file);
        const { url } = await api("/admin/api/images", "POST", form);
        added.push({ url, alt: { ...text } });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (added.length)
        setTour((t) => ({ ...t, images: [...t.images, ...added] }));
      setDirty(true);
      setBusy(false);
    }
  }
  return (
    <form
      className="admin-editor"
      data-dirty={dirty}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onChange={() => setDirty(true)}
    >
      <div className="admin-edit-main">
        <section className="admin-section">
          <h2>Основная информация</h2>
          <div className="admin-fields">
            {field("Адрес страницы (латиница)", ["slug"], "text", true)}
            {select(
              "Страна",
              ["country"],
              countries.map((c) => ({ value: c.slug, label: c.name.ru })),
            )}
            {select(
              "Направление",
              ["location"],
              locations.map((l) => ({ value: l.slug, label: l.name.ru })),
            )}
            {select(
              "Категория",
              ["category"],
              taxonomy.categories.map((c) => ({
                value: c.slug,
                label: c.name.ru,
              })),
            )}
            {select(
              "Город",
              ["city"],
              locations
                .filter((l) => l.kind === "city")
                .map((l) => ({ value: l.slug, label: l.name.ru })),
              true,
            )}
            {select(
              "Курорт",
              ["resort"],
              locations
                .filter((l) => l.kind === "resort")
                .map((l) => ({ value: l.slug, label: l.name.ru })),
              true,
            )}
          </div>
          <p>
            Города и курорты берутся из справочника locations выбранной страны.
            Для Турции допустима только подтверждённая азиатская территория.
          </p>
          {bilingual("Название", ["title"])}
          {bilingual("Краткое описание", ["summary"], true)}
          {lines("Подробное описание", ["description"])}
          {lines("Особенности экскурсии", ["highlights"])}
        </section>
        <details className="admin-section" open>
          <summary>Галерея</summary>
          <p>
            До 40 фотографий; JPEG, PNG или WebP до 8 МБ. Первая фотография —
            обложка.
          </p>
          <label className="admin-upload">
            <Upload size={18} /> Загрузить фотографии
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={busy}
              onChange={(e) => void upload(e.target.files)}
            />
          </label>
          <div className="admin-gallery">
            {tour.images.map((image, i) => (
              <div key={`${image.url}-${i}`} className="admin-image">
                <Image
                  unoptimized
                  width={640}
                  height={400}
                  src={
                    image.url.startsWith("/images/admin/")
                      ? `/admin/api/images/${image.url.split("/").pop()}`
                      : image.url
                  }
                  alt={image.alt.ru || `Фотография ${i + 1}`}
                />
                <div className="admin-repeat-head">
                  <strong>{i === 0 ? "Обложка" : `Фото ${i + 1}`}</strong>
                  <div>
                    <button
                      type="button"
                      disabled={i === 0}
                      aria-label={`Поднять фото ${i + 1}`}
                      onClick={() => {
                        const images = [...tour.images];
                        [images[i - 1], images[i]] = [images[i], images[i - 1]];
                        set(["images"], images);
                      }}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={i === tour.images.length - 1}
                      aria-label={`Опустить фото ${i + 1}`}
                      onClick={() => {
                        const images = [...tour.images];
                        [images[i + 1], images[i]] = [images[i], images[i + 1]];
                        set(["images"], images);
                      }}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Удалить фото ${i + 1}`}
                      onClick={() => {
                        if (
                          image.url.startsWith("/images/admin/") ||
                          image.url.includes(
                            "/storage/v1/object/public/tour-images/admin/",
                          )
                        )
                          setRemoved((r) => [...r, image.url]);
                        set(
                          ["images"],
                          tour.images.filter((_, n) => n !== i),
                        );
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {bilingual("Подпись", ["images", i, "alt"])}
              </div>
            ))}
          </div>
          <small>
            {retainMedia
              ? "Фотография скрывается, но не стирается с диска. Используемые файлы защищены от удаления."
              : "Файл удаляется после сохранения, если он больше не используется. Загруженные без сохранения файлы можно удалить кнопкой ниже."}
          </small>
          {removed.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                setError("");
                try {
                  for (const url of removed)
                    await api("/admin/api/images", "DELETE", { url });
                  setRemoved([]);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Удалить неиспользуемые файлы ({removed.length})
            </button>
          )}
        </details>
        <details className="admin-section">
          <summary>Программа и услуги</summary>
          {repeat(
            "Этап",
            ["itinerary"],
            {
              title: { ...text },
              description: { ...text },
              durationMinutes: null,
            },
            (p) => (
              <>
                {bilingual("Название", [...p, "title"])}
                {bilingual("Описание", [...p, "description"], true)}
                {field(
                  "Длительность, минуты",
                  [...p, "durationMinutes"],
                  "number",
                )}
              </>
            ),
          )}
          {lines("Включено", ["inclusions"])}
          {lines("Не включено", ["exclusions"])}
          {bilingual("Транспорт", ["transportation"])}
          <div className="admin-fields">
            {field("Длительность, минуты", ["durationMinutes"], "number")}
            <label>
              Языки сопровождения
              <input
                value={tour.languages.join(", ")}
                onChange={(e) =>
                  set(
                    ["languages"],
                    e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
              <small>Коды через запятую: ru, en</small>
            </label>
          </div>
        </details>
        <details className="admin-section">
          <summary>Цены и расписание</summary>
          <p>
            Указывайте только подтверждённые цены и даты. Без даты проверки цена
            не видна в публичном каталоге.
          </p>
          {repeat(
            "Цена",
            ["prices"],
            {
              currency: "USD",
              adult: null,
              child: null,
              childMinAge: null,
              childMaxAge: null,
              validFrom: null,
              validUntil: null,
              verifiedAt: null,
            },
            (p) => (
              <div className="admin-fields">
                {field("Валюта ISO (USD, EUR…) ", [...p, "currency"])}
                {field("Взрослый", [...p, "adult"], "number")}
                {field("Ребёнок", [...p, "child"], "number")}
                {field("Возраст ребёнка от", [...p, "childMinAge"], "number")}
                {field("Возраст ребёнка до", [...p, "childMaxAge"], "number")}
                {field("Действует с", [...p, "validFrom"], "date")}
                {field("Действует до", [...p, "validUntil"], "date")}
                {field("Проверено", [...p, "verifiedAt"], "datetime-local")}
              </div>
            ),
          )}
          {field("Часовой пояс IANA", ["timezone"])}
          {bilingual("Описание расписания", ["schedule"], true)}
          {repeat(
            "Отправление",
            ["departures"],
            { weekdays: [], time: "09:00", validFrom: "", validUntil: "" },
            (p) => (
              <div className="admin-fields">
                <label>
                  Дни недели (0 — вс, 1 — пн … 6 — сб)
                  <input
                    value={(
                      (get(tour, [...p, "weekdays"]) || []) as number[]
                    ).join(",")}
                    onChange={(e) =>
                      set(
                        [...p, "weekdays"],
                        e.target.value.split(",").filter(Boolean).map(Number),
                      )
                    }
                  />
                </label>
                {field("Время", [...p, "time"], "time")}
                {field("Начало периода", [...p, "validFrom"], "date")}
                {field("Конец периода", [...p, "validUntil"], "date")}
              </div>
            ),
          )}
          {repeat(
            "Дата",
            ["slots"],
            {
              date: "",
              time: "09:00",
              capacity: 0,
              reserved: 0,
              status: "closed",
              verifiedAt: null,
            },
            (p) => (
              <div className="admin-fields">
                {field("Дата", [...p, "date"], "date")}
                {field("Время", [...p, "time"], "time")}
                {field("Всего мест", [...p, "capacity"], "number")}
                <label>
                  Занятые места
                  <input
                    readOnly
                    value={String(get(tour, [...p, "reserved"]))}
                  />
                </label>
                {select(
                  "Доступность",
                  [...p, "status"],
                  [
                    { value: "available", label: "Доступно" },
                    { value: "sold_out", label: "Нет мест" },
                    { value: "closed", label: "Закрыто" },
                  ],
                )}
                {field("Дата проверки", [...p, "verifiedAt"], "datetime-local")}
              </div>
            ),
          )}
        </details>
        <details className="admin-section">
          <summary>Встреча, трансфер и условия</summary>
          {bilingual("Место встречи", ["meeting"], true)}
          {bilingual("Забор из отеля", ["pickup"], true)}
          {repeat(
            "Место забора",
            ["pickupLocations"],
            {
              name: { ...text },
              address: { ...text },
              location: "",
              instructions: null,
            },
            (p) => (
              <>
                {bilingual("Название", [...p, "name"])}
                {bilingual("Адрес", [...p, "address"])}
                {select(
                  "Направление",
                  [...p, "location"],
                  locations.map((l) => ({ value: l.slug, label: l.name.ru })),
                )}
                {bilingual("Инструкции", [...p, "instructions"], true)}
              </>
            ),
          )}
          {repeat(
            "Место встречи",
            ["meetingPoints"],
            { name: { ...text }, address: { ...text }, lat: null, lng: null },
            (p) => (
              <>
                {bilingual("Название", [...p, "name"])}
                {bilingual("Адрес", [...p, "address"])}
                <div className="admin-fields">
                  {field("Широта", [...p, "lat"], "number")}
                  {field("Долгота", [...p, "lng"], "number")}
                </div>
              </>
            ),
          )}
          {bilingual("Правила отмены", ["cancellation"], true)}
          {bilingual("Условия бронирования", ["bookingConditions"], true)}
          {repeat(
            "Вопрос",
            ["faq"],
            { question: { ...text }, answer: { ...text } },
            (p) => (
              <>
                {bilingual("Вопрос", [...p, "question"])}
                {bilingual("Ответ", [...p, "answer"], true)}
              </>
            ),
          )}
        </details>
        <details className="admin-section">
          <summary>SEO и проверка поставщика</summary>
          {bilingual("SEO название", ["seo", "title"])}
          {bilingual("SEO описание", ["seo", "description"], true)}
          <label>
            Оператор
            <select
              aria-label="Оператор"
              value={tour.operator?.id || ""}
              onChange={(e) => {
                const op = taxonomy.operators.find(
                  (o) => o.id === e.target.value,
                );
                set(["operator"], op ? { id: op.id, name: op.name } : null);
              }}
            >
              <option value="">Не выбран</option>
              {taxonomy.operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.verifiedAt ? " · Проверен" : " · Не проверен"}
                </option>
              ))}
            </select>
          </label>
          <p>
            Операторы и справочники создаются в защищённой базе. Локальный режим
            не содержит вымышленных поставщиков.
          </p>
          {field("Дата проверки экскурсии", ["verifiedAt"], "datetime-local")}
          <label className="admin-check">
            <input
              type="checkbox"
              checked={tour.isDemo}
              onChange={(e) => set(["isDemo"], e.target.checked)}
            />{" "}
            Демонстрационные данные (не попадают в реальный каталог)
          </label>
        </details>
      </div>
      <aside className="admin-edit-aside">
        <section className="admin-section">
          <h2>Публикация</h2>
          {select(
            "Статус",
            ["status"],
            Object.entries(statusNames)
              .filter(
                ([value]) => !publicationDisabled || value !== "published",
              )
              .map(([value, label]) => ({
                value,
                label,
              })),
          )}
          {publicationDisabled && (
            <p>
              Импорт не публикует карточки. После сохранения и проверки
              используйте отдельное разрешение на публикацию ниже. Видимость не
              делает черновик публичным.
            </p>
          )}
          <label className="admin-check">
            <input
              type="checkbox"
              checked={tour.visible}
              onChange={(e) => set(["visible"], e.target.checked)}
            />{" "}
            Показывать на сайте
          </label>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={tour.featured}
              onChange={(e) => set(["featured"], e.target.checked)}
            />{" "}
            Рекомендуемая экскурсия
          </label>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={tour.archived}
              onChange={(e) => {
                set(["archived"], e.target.checked);
                if (e.target.checked) set(["status"], "draft");
              }}
            />{" "}
            В архиве
          </label>
          <p>
            {missingInformation(
              tour,
              taxonomy.operators.filter((o) => o.verifiedAt).map((o) => o.id),
            ).length
              ? "Перед публикацией:"
              : "Обязательные поля заполнены."}
          </p>
          {missingInformation(
            tour,
            taxonomy.operators.filter((o) => o.verifiedAt).map((o) => o.id),
          ).length > 0 && (
            <ul>
              {missingInformation(
                tour,
                taxonomy.operators.filter((o) => o.verifiedAt).map((o) => o.id),
              ).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          <button className="admin-primary" disabled={busy}>
            <Save size={16} />
            {busy ? "Сохранение…" : "Сохранить экскурсию"}
          </button>
          {dirty && <small>Есть несохранённые изменения</small>}
          {message && (
            <p role="status" className="admin-success">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="admin-error">
              {error}
            </p>
          )}
          {!isNew && (
            <>
              <button
                type="button"
                disabled={busy || dirty}
                onClick={() =>
                  void save(
                    {
                      ...tour,
                      id: crypto.randomUUID(),
                      slug: `${tour.slug.slice(0, 95)}-copy-${Date.now()}`,
                      status: "draft",
                      externalProduct: null,
                      featured: false,
                      verifiedAt: null,
                      archived: false,
                      updatedAt: "",
                      slots: tour.slots.map((s) => ({
                        ...s,
                        reserved: 0,
                        status: "closed",
                        verifiedAt: null,
                      })),
                      prices: tour.prices.map((p) => ({
                        ...p,
                        verifiedAt: null,
                      })),
                    },
                    true,
                  )
                }
              >
                <Copy size={16} /> Создать копию
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void save({
                    ...tour,
                    archived: true,
                    status: "draft",
                    visible: false,
                    featured: false,
                  })
                }
              >
                <Archive size={16} /> Архивировать
              </button>
            </>
          )}
          <Link href="/admin">Вернуться к списку</Link>
        </section>
      </aside>
    </form>
  );
}
export function ImportPanel() {
  const router = useRouter();
  const [csv, setCSV] = useState(""),
    [rows, setRows] = useState<
      { row: number; slug: string; title: string; errors: string[] }[] | null
    >(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function run(commit: boolean) {
    setBusy(true);
    setError("");
    try {
      const data = await api("/admin/api/import", "POST", { csv, commit });
      if (commit) {
        setMessage(`Сохранено черновиков: ${data.saved}`);
        setRows(null);
        setCSV("");
        router.refresh();
      } else setRows(data.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-section">
      <h2>Импорт без неожиданностей</h2>
      <p>
        Скачайте шаблон, заполните подтверждённые данные и проверьте файл. Все
        строки сохраняются одним пакетом, только как черновики. Ошибка отменяет
        весь импорт.
      </p>
      <Link
        className="admin-quiet"
        href="/admin/api/import"
        download
        prefetch={false}
      >
        Скачать CSV-шаблон
      </Link>
      <p>
        UTF-8, разделитель — запятая. Несколько абзацев и пунктов: новая строка
        внутри кавычек или |. Для маршрута, расписания и дат используйте JSON.
        Не более 1000 строк и 2 МБ.
      </p>
      <label>
        CSV-файл
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={async (e) => {
            setRows(null);
            setCSV("");
            setError("");
            setMessage("");
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
              setError("Файл превышает 2 МБ");
              setCSV("");
              return;
            }
            setBusy(true);
            try {
              setCSV(await file.text());
            } catch {
              setError("Не удалось прочитать файл. Выберите его снова.");
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      <button
        className="admin-primary"
        disabled={!csv || busy}
        onClick={() => void run(false)}
      >
        {busy ? "Проверка…" : "Проверить импорт"}
      </button>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="admin-success" role="status">
          {message}
        </p>
      )}
      {rows && (
        <>
          <h3>Предварительный просмотр · Строк: {rows.length}</h3>
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Строка</th>
                  <th>Экскурсия</th>
                  <th>Адрес</th>
                  <th>Проверка</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.title}</td>
                    <td>{r.slug}</td>
                    <td>
                      {r.errors.length ? (
                        <span className="admin-error">
                          {r.errors.join("; ")}
                        </span>
                      ) : (
                        "Готово · Черновик"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="admin-primary"
            disabled={busy || !rows.length || rows.some((r) => r.errors.length)}
            onClick={() => void run(true)}
          >
            Сохранить черновики ({rows.length})
          </button>
          <p>
            При сохранении файл снова проверяется на сервере. Существующие
            экскурсии не перезаписываются.
          </p>
        </>
      )}
    </section>
  );
}
