import Link from "next/link";
import { notFound } from "next/navigation";
import { commerceEnabled } from "@/features/commerce/server";
import { readDashboard } from "@/features/commerce/dashboard-server";
import { readDailyChart } from "@/features/commerce/chart-server";
import { DailyActivityChart } from "@/features/commerce/daily-chart";
import { DashboardRefresh } from "@/features/commerce/dashboard-refresh";

type Metrics = {
  visitors_today: number; visitor_days: number; converted_visitor_days: number; visits: number; pageviews: number; registrations: number | null;
  requests: number; in_progress: number; completed: number;
  daily: { day: string; visitors: number; requests: number }[];
  geography: { country: string; city: string; visits: number }[];
  events: { event: string; count: number }[];
  popular: { event: string; path: string; detail: string; count: number }[];
  devices: { device: string; count: number }[];
  destinations: { country: string; city: string; count: number }[];
  sources: { referrer: string; count: number }[];
};
const labels: Record<string, string> = {
  visit: "Посещения", pageview: "Просмотры страниц", catalog: "Каталог", search: "Поиск",
  filter: "Фильтры", product: "Просмотры экскурсий", cart_add: "Добавления в корзину",
  cart_remove: "Удаления из корзины", checkout: "Начало оформления", request_success: "Отправленные заявки",
  telegram: "Переходы в Telegram", register: "Регистрация", login: "Вход",
};
export const dynamic = "force-dynamic";
export default async function Analytics({ searchParams }: { searchParams: Promise<{ days?: string; chartDays?: string }> }) {
  if (!commerceEnabled()) notFound();
  const { days,chartDays } = await searchParams;
  const period = days === "1" ? 1 : days === "30" ? 30 : 7;
  const result = await readDashboard(period);
  const { data, error } = result;
  if (error || !data) return <section><h1>Dashboard и аналитика</h1><DashboardRefresh updatedAt={null}/><p>Статистика временно недоступна. {error === "PGRST202" ? "Функция статистики не найдена в Data API. Необходимо проверить фактическую схему и права." : error === "42501" ? "Недостаточно прав для чтения статистики." : "Проверьте подключение и доступ к данным."} Код: {error ?? "empty_response"}.</p><Link href="/admin/orders">Открыть заявки</Link></section>;
  const m = data as Metrics;
  const eventCount = (event: string) => Number(m.events.find(row => row.event === event)?.count ?? 0);
  const chartPeriod=chartDays==="90"?90:chartDays==="30"?30:chartDays==="7"?7:period===30?30:7;
  const chart=await readDailyChart(chartPeriod);
  return <section className="crm-page">
    <h1>Dashboard и аналитика</h1>
    <DashboardRefresh updatedAt={new Date().toISOString()}/>
    <nav className="crm-period" aria-label="Период остальных показателей">{[1, 7, 30].map(n =>
      <Link key={n} href={`/admin/analytics?days=${n}`} aria-current={n === period ? "page" : undefined}>{n === 1 ? "Сегодня" : `${n} дней`}</Link>)}</nav>
    <h2>Работа сервиса — независимо от согласия на статистику</h2>
    <p>Регистрации, заявки и их статусы учитываются по рабочим записям сервиса. Отказ от дополнительной аналитики не исключает эти операции из отчёта.</p>
    <dl className="crm-metrics">{[
      ["Регистрации", m.registrations],
      ["Новые заявки", m.requests], ["В работе", m.in_progress], ["Завершены", m.completed],
    ].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{value == null ? "—" : Number(value).toLocaleString("ru")}</dd></div>)}</dl>
    <h2>Дополнительная аналитика — только с согласия</h2>
    <dl className="crm-metrics">{[["Посетители сегодня",m.visitors_today],["Посещения за период",m.visits],["Просмотры страниц",m.pageviews]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{Number(value).toLocaleString("ru")}</dd></div>)}</dl>
    <p>Посещаемость учитывает только согласившихся на статистику. Посетитель — приблизительный сетевой идентификатор браузера, который меняется ежедневно. За период учтено {m.visitor_days} посетитель-дней. Это не количество уникальных людей.</p>
    {chart.data?<DailyActivityChart data={chart.data} summaryPeriod={period}/>:<section><h2>Посещения и заявки по дням</h2><p className="analytics-empty">Не удалось загрузить дневные значения. Обновите страницу; нули вместо недоступных данных не подставляются.</p></section>}
    <h2>Воронка согласившихся посетителей</h2>
    <p>Доля посетитель-дней с отправленной заявкой · {m.visitor_days ? (m.converted_visitor_days / m.visitor_days * 100).toFixed(1) : "0"}%.</p>
    <p>События могут повторяться. Разница между началом оформления и отправкой — незавершённые попытки, а не доказанные отказы.</p>
    <p>Незавершённых попыток оформления · {Math.max(0, eventCount("checkout") - eventCount("request_success"))}.</p>
    {!m.events.length && <p className="analytics-empty">Событий воронки пока нет. Они появятся после согласия посетителей и соответствующих действий на сайте.</p>}
    <div className="crm-table-wrap"><table><thead><tr><th>Шаг</th><th>События</th></tr></thead><tbody>{["visit","product","cart_add","checkout","request_success"].map(event =>
      <tr key={event}><td>{labels[event]}</td><td>{eventCount(event)}</td></tr>)}</tbody></table></div>
    <h2>География посещений</h2>
    <p>Приблизительная география сети. Unknown означает, что регион определить не удалось.</p>
    {!m.geography.length && <p className="analytics-empty">География появится после первых посещений со согласием, если регион удалось определить.</p>}
    <div className="crm-table-wrap"><table><thead><tr><th>Страна</th><th>Город</th><th>Посещения</th><th>Доля</th></tr></thead>
      <tbody>{m.geography.map(row => <tr key={row.country + row.city}><td>{row.country}</td><td>{row.city}</td><td>{row.visits}</td><td>{m.visits ? (row.visits / m.visits * 100).toFixed(1) : "0"}%</td></tr>)}</tbody></table></div>
    <h2>Популярные экскурсии, поиск и направления</h2>
    {!m.popular.length && <p className="analytics-empty">Пока нет просмотров экскурсий, поисков или добавлений в корзину со статистическим согласием.</p>}
    <div className="crm-table-wrap"><table><thead><tr><th>Действие</th><th>Страница / запрос</th><th>Количество</th></tr></thead><tbody>
      {m.popular.map((row, i) => <tr key={i}><td>{labels[row.event] ?? row.event}</td><td>{row.detail || row.path}</td><td>{row.count}</td></tr>)}</tbody></table></div>
    <h2>Популярные направления</h2>
    {!m.destinations?.length && <p className="analytics-empty">Пока нет просмотров экскурсий со статистическим согласием.</p>}
    <div className="crm-table-wrap"><table><thead><tr><th>Страна</th><th>Город</th><th>Просмотры экскурсий</th></tr></thead><tbody>
      {(m.destinations ?? []).map(row => <tr key={row.country + row.city}><td>{row.country}</td><td>{row.city}</td><td>{row.count}</td></tr>)}
    </tbody></table></div>
    <h2>Устройства и источники</h2>
    <ul>{m.devices.map(row => <li key={row.device}>{({ mobile: "Телефон", tablet: "Планшет", desktop: "Компьютер" })[row.device] ?? row.device} · {row.count}</li>)}</ul>
    <ul>{m.sources.map(row => <li key={row.referrer}>{row.referrer || "Прямой переход"} · {row.count}</li>)}</ul>
    {!m.pageviews && <p>Статистика пока не накоплена. Прошлые посещения не восстанавливаются задним числом.</p>}
  </section>;
}
