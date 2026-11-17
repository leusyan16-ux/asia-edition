"use client";
import { useState, useRef } from "react";
import { adminCountries as countries } from "@/lib/catalog";
type Job = {
  id: string;
  phase: string;
  cursor: number;
  total: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  missing: number;
  discontinued: number;
  errors: string[];
  scope?: { provider: string };
};
async function api(body?: unknown) {
  const r = await fetch("/admin/api/catalog-jobs", {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
export function CatalogJobPanel() {
  const [file, setFile] = useState<File | null>(null),
    [provider, setProvider] = useState(""),
    [scope, setScope] = useState<string[]>([]),
    [complete, setComplete] = useState(false),
    [timestamp, setTimestamp] = useState(""),
    [jobs, setJobs] = useState<Job[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const stop = useRef(false);
  async function refresh() {
    setJobs((await api()).jobs);
  }
  async function stage() {
    if (!file) return;
    setBusy(true);
    try {
      const data = await api({
        action: "stage",
        format: file.name.toLowerCase().endsWith(".csv") ? "csv" : "json",
        content: await file.text(),
        scope: { provider, countries: scope, complete, snapshot_at: timestamp },
      });
      setMessage(
        data.errors.length
          ? JSON.stringify(data.errors)
          : `Проверено: новых ${data.summary.created}, изменённых ${data.summary.updated}, без изменений ${data.summary.skipped}. Записи ещё не сохранены.`,
      );
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function run(job: Job) {
    setBusy(true);
    stop.current = false;
    try {
      let current = job;
      while (
        !stop.current &&
        !["completed", "cancelled", "failed"].includes(current.phase)
      ) {
        current = (
          await api({
            action: "advance",
            id: current.id,
            cursor: current.cursor,
          })
        ).job;
        setMessage(
          `Обработано ${current.processed}/${current.total}: создано ${current.created}, обновлено ${current.updated}, пропущено ${current.skipped}. ${current.errors.join("; ")}`,
        );
      }
      await refresh();
    } catch (e) {
      setMessage(
        `Импорт остановлен. Продолжите с сохранённой контрольной точки: ${(e as Error).message}`,
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-section catalog-job-panel">
      <h2>Большой каталог · возобновляемый импорт</h2>
      <p>
        До 100 000 продуктов / 50 МБ; пакеты до 250 записей. Только черновики.
        Проверка сохраняет задание, но не продукты. Продолжение работает после
        перезапуска браузера и сервера.
      </p>
      <div className="catalog-job-fields">
        <label>
          Provider
          <input
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Дата снимка ISO 8601
          <input
            value={timestamp}
            placeholder="YYYY-MM-DDTHH:mm:ssZ"
            onChange={(e) => setTimestamp(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Нормализованный CSV / JSON
          <input
            type="file"
            accept=".csv,.json"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              if (f && f.size > 50 * 1024 * 1024) {
                setMessage("Файл превышает 50 МБ");
                setFile(null);
              } else setFile(f);
            }}
          />
        </label>
      </div>
      <fieldset disabled={busy} className="catalog-job-scope">
        <legend>Страны этого feed</legend>
        {countries.map((c) => (
          <label key={c.slug}>
            <input
              type="checkbox"
              checked={scope.includes(c.slug)}
              onChange={(e) =>
                setScope(
                  e.target.checked
                    ? [...scope, c.slug]
                    : scope.filter((s) => s !== c.slug),
                )
              }
            />
            {c.name.ru}
          </label>
        ))}
      </fieldset>
      <label className="catalog-job-complete">
        <input
          type="checkbox"
          checked={complete}
          disabled={busy}
          onChange={(e) => setComplete(e.target.checked)}
        />
        <span>
          Подтверждаю: это полный снимок указанного provider для выбранных
          стран.
        </span>
      </label>
      <p>
        Без этого подтверждения отсутствующие записи не изменяются. Полный feed
        помечает пропавшие продукты только после всех пакетов; ничего не
        удаляется.
      </p>
      <div className="admin-actions">
        <button
          disabled={busy || !file || !provider || !timestamp || !scope.length}
          onClick={() => void stage()}
        >
          Проверить и подготовить
        </button>
        <button
          disabled={busy}
          onClick={() => void refresh().catch((e) => setMessage(e.message))}
        >
          Загрузить задания
        </button>
        {busy && (
          <button
            onClick={() => {
              stop.current = true;
            }}
          >
            Остановить после пакета
          </button>
        )}
      </div>
      <p role="status">{message}</p>
      {jobs.map((j) => (
        <div key={j.id} className="admin-notice">
          <strong>
            {j.scope?.provider} ·{" "}
            {(
              {
                prepared: "Подготовлен",
                running: "Выполняется",
                failed: "Ошибка",
                completed: "Завершён",
                cancelled: "Отменён",
              } as Record<string, string>
            )[j.phase] || j.phase}
          </strong>
          <p>
            {j.processed}/{j.total} · новых {j.created}, изменённых {j.updated},
            пропущенных {j.skipped}, отсутствующих {j.missing}, прекращённых{" "}
            {j.discontinued}
          </p>
          {!["completed", "cancelled"].includes(j.phase) && (
            <div className="admin-actions">
              <button
                disabled={busy}
                onClick={() => void run({ ...j, phase: "running" })}
              >
                Сохранить / продолжить
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void api({ action: "cancel", id: j.id })
                    .then(refresh)
                    .catch((e) => setMessage(e.message))
                }
              >
                Отменить оставшиеся пакеты
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
