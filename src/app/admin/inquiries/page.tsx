import { redirect } from "next/navigation";
import { currentAdmin } from "@/features/admin/server";
import { postgresFor } from "@/features/ingestion/runtime";
import { postgresSelected } from "@/features/ingestion/config";
export const dynamic = "force-dynamic";
export default async function Inquiries({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  if (!(await currentAdmin())) redirect("/admin/login");
  if (!postgresSelected())
    return (
      <section className="admin-section">
        <h1>Заявки</h1>
        <p>
          Сохранение заявок требует PostgreSQL. В этом режиме приём отключён.
        </p>
      </section>
    );
  const input = Number((await searchParams).page ?? 1),
    page = Number.isInteger(input) && input > 0 ? Math.min(input, 100000) : 1;
  const rows = await (
    await postgresFor("asia_catalog_editor")
  ).query<{
    id: string;
    name: string;
    email: string;
    message: string;
    locale: string;
    created_at: string;
    status: string;
  }>(
    "select id,name,email,message,locale,created_at,status from catalog_projection.inquiries order by created_at desc,id limit 51 offset $1",
    [(page - 1) * 50],
  );
  return (
    <section className="admin-section">
      <h1>Запросы на связь</h1>
      <p>
        Не являются подтверждёнными бронированиями. Email-уведомления не
        отправляются: проверяйте этот список.
      </p>
      {!rows.rows.length && <p>Запросов пока нет.</p>}
      {rows.rows.slice(0, 50).map((r) => (
        <article key={r.id}>
          <h2>{r.name}</h2>
          <p>
            {r.email} · {r.locale.toUpperCase()} ·{" "}
            {new Date(r.created_at).toISOString()}
          </p>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {r.message}
          </p>
          <small>
            {r.id} · {r.status}
          </small>
          <hr />
        </article>
      ))}
      <nav aria-label="Страницы заявок">
        {page > 1 && <a href={`?page=${page - 1}`}>← Назад</a>}
        {rows.rows.length > 50 && <a href={`?page=${page + 1}`}>Далее →</a>}
      </nav>
    </section>
  );
}
