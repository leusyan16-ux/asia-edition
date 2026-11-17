import { notFound } from "next/navigation";
import Link from "next/link";
import { commerceEnabled, requireCommerceStaff } from "@/features/commerce/server";
import { CustomerNote } from "@/features/commerce/admin-actions";
type Customer = { id: string; created_at: string; email: string; name: string; phone: string; email_confirmed_at: string | null; account_status: string; requests: number; last_request: string | null };
export const dynamic = "force-dynamic";
export default async function Customers({ searchParams }: {
  searchParams: Promise<{ q?: string; from?: string; to?: string; page?: string; sort?: string; customer?: string }>;
}) {
  if (!commerceEnabled()) notFound();
  const staff = await requireCommerceStaff("/admin/customers");
  if (!["owner", "admin", "manager"].includes(staff.role)) notFound();
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0,120);
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "") || 1));
  const customer = /^[a-f0-9-]{36}$/i.test(params.customer ?? "") ? params.customer : null;
  const date = (value?: string) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : null;
  const { data, error } = await staff.client.rpc("commerce_customers", {
    q, since_date: date(params.from), until_date: date(params.to),
    page_number: page, ordering: params.sort ?? "newest", subject: customer,
  });
  const result = data as { total: number; items: Customer[] } | null;
  const notes = customer ? await staff.client.from("commerce_customer_notes")
    .select("id,note,created_at").eq("customer_id", customer).order("created_at", { ascending:false }).limit(100) : null;
  const href = (next: number) => {
    const query = new URLSearchParams();
    for (const field of ["q","from","to","sort"] as const) if (params[field]) query.set(field, params[field]!);
    query.set("page", String(next));
    return "/admin/customers?" + query;
  };
  return <section className="crm-page"><h1>Клиенты</h1>
    <form className="crm-filters">
      <label>Имя, email или телефон<input name="q" maxLength={120} defaultValue={q} /></label>
      <label>Регистрация с<input name="from" type="date" defaultValue={params.from} /></label>
      <label>По дату<input name="to" type="date" defaultValue={params.to} /></label>
      <label>Порядок<select name="sort" defaultValue={params.sort ?? "newest"}>
        <option value="newest">Новые сначала</option><option value="oldest">Старые сначала</option><option value="requests">По количеству заявок</option>
      </select></label><button>Найти</button>
    </form>
    {error ? <p>Для списка всех зарегистрированных клиентов примените миграцию 010 в staging. Существующие заявки доступны в разделе «Заказы».</p> : <>
      <p>Найдено клиентов · {result?.total ?? 0}</p>
      <div className="crm-table-wrap"><table><thead><tr>
        <th>Регистрация</th><th>Клиент</th><th>Телефон</th><th>Email</th><th>Заявки</th><th>Последняя заявка</th><th>Аккаунт</th><th>Действия</th>
      </tr></thead><tbody>{result?.items.map(row => <tr key={row.id}>
        <td>{new Date(row.created_at).toLocaleDateString("ru-RU", { timeZone:"UTC" })}</td>
        <td>{row.name || "Имя не указано"}<br/>{row.email}</td><td>{row.phone || "—"}</td>
        <td>{row.email_confirmed_at ? "Подтверждён" : "Не подтверждён"}</td><td>{row.requests}</td>
        <td>{row.last_request ? new Date(row.last_request).toLocaleDateString("ru-RU",{timeZone:"UTC"}) : "—"}</td>
        <td>{row.account_status === "blocked" ? "Заблокирован" : "Активен"}</td>
        <td><Link href={`/admin/customers?customer=${row.id}`}>Профиль</Link>{" · "}<Link href={`/admin/orders?customer=${row.id}`}>Заявки</Link></td>
      </tr>)}</tbody></table></div>
      {!customer && <nav className="crm-period" aria-label="Страницы клиентов">
        {page>1 && <Link href={href(page-1)}>Назад</Link>}<span>Страница {page}</span>
        {page*50<(result?.total ?? 0) && <Link href={href(page+1)}>Далее</Link>}
      </nav>}
      {customer && result?.items.length === 1 && <section>
        <h2>Заметки менеджера</h2><CustomerNote customer={customer}/>
        {notes?.data?.map(note => <article className="crm-note" key={note.id}><time>{new Date(note.created_at).toLocaleString("ru-RU",{timeZone:"UTC"})} UTC</time><p>{note.note}</p></article>)}
        <Link href="/admin/customers">Все клиенты</Link>
      </section>}
    </>}
  </section>;
}
