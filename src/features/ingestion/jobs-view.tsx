import Link from "next/link";
import type { importDashboard } from "./projection";
const states: Record<string, string> = {
  staging: "Подготовка",
  queued: "В очереди",
  running: "Выполняется",
  retry: "Ожидает повтора",
  completed: "Завершено",
  failed: "Ошибка",
  cancelled: "Отменено",
};
const events: Record<string, string> = {
  packet_committed: "Пакет сохранён",
  packet_failed: "Ошибка пакета",
};
function timestamp(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? "Дата не указана"
    : new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Istanbul",
      }).format(date);
}
export function PostgresJobs({
  data,
}: {
  data: Awaited<ReturnType<typeof importDashboard>>;
}) {
  return (
    <section className="admin-section">
      <h2>PostgreSQL · задания и журнал</h2>
      <p className="admin-notice">
        Импорт сохраняет черновики пакетами. Продолжение доступно после
        перезагрузки страницы. Браузер не получает доступ к подключению БД.
      </p>
      <p>
        <Link href="/admin/import?page=1">Первая страница</Link> ·{" "}
        {data.page > 1 && (
          <Link href={`/admin/import?page=${data.page - 1}`}>Назад · </Link>
        )}
        {(data.jobs.length === 25 || data.events.length === 50) && (
          <Link href={`/admin/import?page=${data.page + 1}`}>Далее · </Link>
        )}
        <Link href="/admin">Каталог ↗</Link>
      </p>
      <h3>Последние задания</h3>
      {!data.jobs.length && <p>Заданий пока нет.</p>}
      {data.jobs.map((j) => (
        <details key={String(j.id)}>
          <summary>
            {String(j.provider)} · {states[String(j.state)] ?? String(j.state)}{" "}
            · {String(j.cursor)}/{String(j.parts)}
          </summary>
          <p>
            ID: {String(j.id)} · попыток: {String(j.attempts)}
          </p>
          {j.last_error !== null && <p>{String(j.last_error)}</p>}
        </details>
      ))}
      <h3>Журнал пакетов</h3>
      {!data.events.length && <p>Событий пока нет.</p>}
      {data.events.map((e) => (
        <details key={String(e.id)}>
          <summary>
            {events[String(e.event)] ?? String(e.event)} · пакет{" "}
            {Number(e.cursor) + 1} · {timestamp(e.at)}
          </summary>
          <p>Задание: {String(e.job_id)}</p>
          <pre>{JSON.stringify(e.details, null, 2)}</pre>
        </details>
      ))}
    </section>
  );
}
