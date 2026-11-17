"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
type Job = {
  id: string;
  state: string;
  cursor: number;
  parts: number;
  last_error?: string | null;
  created?: number;
  updated?: number;
  skipped?: number;
};
type Preview = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { row: number; message: string }[];
  rows: { row: number; title: string; action: string }[];
};
type Receipt = {
  id: string;
  filename: string;
  job_id: string | null;
  job_state: string;
  cursor: number;
  parts: number;
};
const endpoint = "/admin/api/postgres-import";
async function command(
  action: string,
  id: string,
  cursor?: number,
): Promise<Job> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, id, cursor }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result.job;
}
export function PostgresUploadPanel() {
  const router = useRouter(),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [phase, setPhase] = useState(""),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [job, setJob] = useState<Job | null>(null),
    [receipts, setReceipts] = useState<Receipt[]>([]);
  const paused = useRef(false);
  const [loadingReceipts, setLoadingReceipts] = useState(true);
  async function reload() {
    const r = await fetch(endpoint, { cache: "no-store" });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    setReceipts(data.uploads);
    setLoadingReceipts(false);
  }
  useEffect(() => {
    let active = true;
    void fetch(endpoint, { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (active) setReceipts(data.uploads);
      })
      .catch((e) => {
        if (active) setError(String(e.message));
      })
      .finally(() => {
        if (active) setLoadingReceipts(false);
      });
    return () => {
      active = false;
      paused.current = true;
    };
  }, []);
  async function prepare() {
    if (!file) return;
    setError("");
    setBusy(true);
    setPreview(null);
    setJob(null);
    setProgress(0);
    setPhase("Загрузка файла");
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("Файл превышает 8 МБ");
      const data = await new Promise<{
        preview: Preview;
        job: Job | null;
        replayed: boolean;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", endpoint);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.upload.onload = () =>
          setPhase("Проверка записей и подготовка пакетов");
        xhr.onerror = () =>
          reject(
            new Error(
              "Связь прервана. Обновите список заданий перед повторной загрузкой",
            ),
          );
        xhr.onload = () => {
          try {
            const result = JSON.parse(xhr.responseText);
            if (xhr.status < 200 || xhr.status >= 300)
              throw new Error(result.error);
            resolve(result);
          } catch (e) {
            reject(e);
          }
        };
        const form = new FormData();
        form.set("file", file);
        xhr.send(form);
      });
      setPreview(data.preview);
      setJob(data.job);
      setPhase(
        data.replayed
          ? "Файл уже подготовлен — используется прежнее задание"
          : "Проверка завершена. Импорт ещё не запущен",
      );
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить файл");
    } finally {
      setBusy(false);
    }
  }
  async function run(selected: Job) {
    setBusy(true);
    setError("");
    paused.current = false;
    try {
      let current = await command("release", selected.id);
      setJob(current);
      setPhase("Сохранение черновиков");
      while (current.state !== "completed" && !paused.current) {
        const cursor = current.cursor;
        current = await command("step", current.id, cursor);
        setJob(current);
        if (["failed", "retry", "cancelled"].includes(current.state))
          throw new Error(
            current.last_error ||
              "Задание приостановлено. Устраните причину и продолжите",
          );
        if (current.cursor === cursor)
          await new Promise((r) => setTimeout(r, 500));
      }
      setPhase(
        current.state === "completed"
          ? "Импорт завершён. Все записи остаются черновиками"
          : "Отправка пакетов приостановлена; контрольная точка сохранена",
      );
      await reload();
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Ошибка импорта. Контрольная точка сохранена",
      );
      await reload().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function select(receipt: Receipt) {
    try {
      const r = await fetch(endpoint + "?id=" + receipt.job_id, {
        cache: "no-store",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setJob(data.job);
      setPreview(null);
      setError("");
    } catch (e) {
      setError(String((e as Error).message));
    }
  }
  return (
    <section className="admin-section pg-upload">
      <h2>Загрузить каталог в PostgreSQL</h2>
      <p>
        CSV или JSON · до 8 МБ и 20 000 записей. Формат ASIA EDITION; один
        provider и last_synced_at на файл. Публикация отключена.
      </p>
      <p>
        <a href={endpoint + "?template=csv"}>Скачать CSV-шаблон</a> ·{" "}
        <a href={endpoint + "?template=json"}>Скачать JSON-шаблон</a>
      </p>
      <label>
        Файл каталога
        <input
          type="file"
          accept=".csv,.json,text/csv,application/json"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError("");
          }}
        />
      </label>
      <button
        className="admin-primary"
        type="button"
        disabled={busy || !file}
        onClick={() => void prepare()}
      >
        Проверить файл
      </button>
      {busy && phase.includes("Загрузка") && (
        <progress aria-label="Загрузка файла" value={progress} max={100} />
      )}
      <p role="status" aria-live="polite">
        {phase}
      </p>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <>
          <p>
            Всего: {preview.total} · новых: {preview.created} · обновлений:{" "}
            {preview.updated} · без изменений: {preview.skipped} · ошибок:{" "}
            {preview.failed}
          </p>
          {preview.errors.length > 0 && (
            <ol className="pg-upload-errors">
              {preview.errors.map((e, i) => (
                <li key={i}>
                  Запись {e.row}: {e.message}
                </li>
              ))}
            </ol>
          )}
          {preview.rows.length > 0 && (
            <details>
              <summary>Первые {preview.rows.length} записей</summary>
              <ul>
                {preview.rows.map((r) => (
                  <li key={r.row}>
                    {r.row}. {r.title} ·{" "}
                    {
                      (
                        {
                          create: "новая",
                          update: "обновление",
                          skip: "без изменений",
                        } as Record<string, string>
                      )[r.action]
                    }
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {job && (
        <div className="pg-upload-checkpoint">
          <p>
            Сохранено пакетов: {job.cursor} из {job.parts}. Задание: {job.id}
          </p>
          <progress
            aria-label="Импорт пакетов"
            value={job.cursor}
            max={Math.max(1, job.parts)}
          />
          <p>
            Создано: {job.created ?? 0} · обновлено: {job.updated ?? 0} ·
            пропущено: {job.skipped ?? 0}
          </p>
          {job.state !== "completed" && (
            <button
              type="button"
              className="admin-primary"
              disabled={busy}
              onClick={() => void run(job)}
            >
              Сохранить / продолжить
            </button>
          )}
          {job.state !== "completed" && job.state !== "cancelled" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void command("cancel", job.id)
                  .then((next) => {
                    setJob(next);
                    setPhase(
                      "Оставшиеся пакеты отменены. Сохранённые черновики не удалены",
                    );
                    return reload();
                  })
                  .catch((e) => setError(e.message));
              }}
            >
              Отменить оставшиеся пакеты
            </button>
          )}
          {busy && (
            <button
              type="button"
              onClick={() => {
                paused.current = true;
              }}
            >
              Пауза отправки пакетов
            </button>
          )}
        </div>
      )}
      <details open>
        <summary>Подготовленные загрузки</summary>
        <button
          type="button"
          disabled={busy}
          onClick={() => void reload().catch((e) => setError(e.message))}
        >
          Обновить список
        </button>
        {loadingReceipts && <p role="status">Загрузка списка…</p>}
        {!loadingReceipts && !receipts.length && <p>Загрузок пока нет.</p>}
        <ul>
          {receipts.map((r) => (
            <li key={r.id}>
              <span>
                {r.filename} · {r.cursor ?? 0}/{r.parts ?? 0}
              </span>{" "}
              <button
                type="button"
                disabled={busy || !r.job_id}
                onClick={() => void select(r)}
              >
                Открыть задание
              </button>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
