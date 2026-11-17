"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import type { ImportLog } from "./external-model";
type Row = {
  row: number;
  key: string;
  title: string;
  slug: string;
  action: "create" | "update" | "skip" | "error";
  errors: string[];
};
const labels = {
  create: "Создать черновик",
  update: "Обновить источник · черновик",
  skip: "Без изменений",
  error: "Ошибка",
};
async function api(body?: unknown) {
  const r = await fetch(
    body ? "/admin/api/import" : "/admin/api/import?history=1",
    {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Не удалось выполнить импорт");
  return data;
}
export function UniversalImportPanel({
  initialLogs,
  testProfile,
}: {
  initialLogs: ImportLog[];
  testProfile: boolean;
}) {
  const [content, setContent] = useState(""),
    [format, setFormat] = useState<"csv" | "json">("json"),
    [rows, setRows] = useState<Row[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [logs, setLogs] = useState(initialLogs),
    [page, setPage] = useState(0);
  const stop = useRef(false),
    job = useRef("");
  async function preview() {
    job.current = crypto.randomUUID();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api({ format, content, commit: false });
      setRows(data.rows);
      setPage(0);
    } catch (e) {
      setError((e as Error).message);
      setRows(null);
    } finally {
      try {
        setLogs((await api()).logs);
      } catch {
        setError((prev) => prev || "Не удалось обновить журнал");
      }
      setBusy(false);
    }
  }
  async function commit() {
    if (!rows) return;
    setBusy(true);
    setError("");
    stop.current = false;
    const count = rows.length;
    let completed = 0;
    const totals = { created: 0, updated: 0, skipped: 0, failed: 0 };
    try {
      for (let offset = 0; offset < count; offset += 250) {
        if (stop.current) break;
        const limit = Math.min(250, count - offset);
        setMessage(
          `Проверка пакета ${Math.floor(offset / 250) + 1} · обработано ${offset} из ${count}`,
        );
        const plan = await api({
          format,
          content,
          commit: false,
          offset,
          limit,
        });
        if (plan.summary.failed)
          throw new Error(
            "Файл содержит ошибки. Обновите предварительный просмотр",
          );
        const data = await api({
          format,
          content,
          commit: true,
          offset,
          limit,
          batch_id: job.current + "-" + offset,
          preview_digest: plan.preview_digest,
        });
        const log = data.log as ImportLog;
        if (log.status !== "committed")
          throw new Error("Пакет отклонён. Подробности в журнале");
        for (const key of ["created", "updated", "skipped", "failed"] as const)
          totals[key] += log[key];
        completed += limit;
        setMessage(
          `Обработано ${completed} из ${count} · создано ${totals.created}, обновлено ${totals.updated}, пропущено ${totals.skipped}`,
        );
      }
      setRows(null);
      if (completed < count)
        setMessage(
          `Остановлено после ${completed} из ${count}. Сохранённые пакеты остаются в журнале; повторный импорт не создаст дублей.`,
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      try {
        setLogs((await api()).logs);
      } catch {
        setError((prev) => prev || "Не удалось обновить журнал");
      }
      setBusy(false);
    }
  }
  return (
    <>
      <section className="admin-section">
        <h2>Продукты внешних поставщиков</h2>
        <p>
          Загрузите CSV или JSON, проверьте каждую строку и сохраните пакетами
          по 250 продуктов. Изменения источника не перезаписывают редакционные
          поля. Новые и изменённые продукты остаются черновиками.
        </p>
        <p className="admin-notice">
          {testProfile
            ? "Отдельный тестовый профиль: синтетические продукты разрешены и не попадают в основной каталог."
            : "Рабочий локальный профиль: синтетические продукты с test_data=true отклоняются. Для тестов используйте отдельный профиль."}
        </p>
        <div className="admin-import-toolbar">
          <Link
            href="/admin/api/import?kind=external&format=csv"
            download
            prefetch={false}
          >
            CSV-шаблон
          </Link>
          <Link
            href="/admin/api/import?kind=external&format=json"
            download
            prefetch={false}
          >
            JSON-шаблон
          </Link>
        </div>
        <p>
          До 5000 продуктов и 8 МБ за файл. Provider и внешний ID обязательны.
          Цены, места и отзывы не создаются автоматически.
        </p>
        <label>
          Файл CSV / JSON
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            disabled={busy}
            onChange={async (e) => {
              setRows(null);
              setContent("");
              setError("");
              setMessage("");
              job.current = crypto.randomUUID();
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 8 * 1024 * 1024) {
                setError("Файл превышает 8 МБ");
                return;
              }
              if (!/\.(csv|json)$/i.test(file.name)) {
                setError("Выберите CSV или JSON");
                return;
              }
              setFormat(
                file.name.toLowerCase().endsWith(".csv") ? "csv" : "json",
              );
              setBusy(true);
              try {
                setContent(await file.text());
              } catch {
                setError("Не удалось прочитать файл");
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        <div className="admin-import-toolbar">
          <button
            className="admin-primary"
            disabled={busy || !content}
            onClick={() => void preview()}
          >
            Проверить файл
          </button>
          {busy && (
            <button
              type="button"
              onClick={() => {
                stop.current = true;
              }}
            >
              Остановить после текущего пакета
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="admin-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="admin-success">
            {message}
          </p>
        )}
        {rows && (
          <>
            <h3>Предварительный просмотр · {rows.length} продуктов</h3>
            <p>
              Создать: {rows.filter((r) => r.action === "create").length} ·
              Обновить: {rows.filter((r) => r.action === "update").length} ·
              Пропустить: {rows.filter((r) => r.action === "skip").length} ·
              Ошибки: {rows.filter((r) => r.errors.length).length}
            </p>
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Строка</th>
                    <th>Продукт / источник</th>
                    <th>Действие</th>
                    <th>Проверка</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(page * 25, page * 25 + 25).map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>
                        {r.title || r.slug || "—"}
                        <small>{r.key}</small>
                      </td>
                      <td>{labels[r.action]}</td>
                      <td>
                        {r.errors.length ? (
                          <span className="admin-error">
                            {r.errors.join("; ")}
                          </span>
                        ) : (
                          "Готово"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav
              className="admin-import-toolbar"
              aria-label="Страницы предварительного просмотра"
            >
              <button
                disabled={busy || page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Назад
              </button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(rows.length / 25))}
              </span>
              <button
                disabled={busy || (page + 1) * 25 >= rows.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Далее
              </button>
            </nav>
            <button
              className="admin-primary"
              disabled={
                busy || !rows.length || rows.some((r) => r.errors.length > 0)
              }
              onClick={() => void commit()}
            >
              Сохранить пакетами
            </button>
            <p>
              Каждый пакет атомарен. Если следующий пакет не пройдёт проверку,
              ранее сохранённые останутся; повторная загрузка безопасна.
            </p>
          </>
        )}
      </section>
      <section className="admin-section">
        <h2>Журнал импортов</h2>
        {!logs.length ? (
          <p>Здесь появятся результаты сохранённых и отклонённых пакетов.</p>
        ) : (
          <>
            <p>
              Последние 50 пакетов. Полная история сохраняется в локальном
              хранилище.
            </p>
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Время / пакет</th>
                    <th>Результат</th>
                    <th>Создано</th>
                    <th>Обновлено</th>
                    <th>Пропущено</th>
                    <th>Ошибки</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {new Date(l.timestamp).toLocaleString("ru-RU")}
                        <small>{l.batch_id}</small>
                      </td>
                      <td>
                        {l.status === "committed" ? "Сохранён" : "Отклонён"}
                      </td>
                      <td>{l.created}</td>
                      <td>{l.updated}</td>
                      <td>{l.skipped}</td>
                      <td>
                        {l.failed}
                        {l.failed > 0 && (
                          <details>
                            <summary>Причины</summary>
                            {l.rows
                              .filter((r) => r.errors.length)
                              .map((r) => (
                                <p key={r.row}>
                                  Строка {r.row}: {r.errors.join("; ")}
                                </p>
                              ))}
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
