import { notFound } from "next/navigation";
import { commerceEnabled, requireCommerceStaff } from "@/features/commerce/server";
import { OrderManagement } from "@/features/commerce/admin-actions";
import { BookingAction } from "@/features/commerce/admin-actions";
import { CRMStage } from "@/features/commerce/admin-actions";
import { getTourRepository } from "@/features/tours/repository";
import { priceHint } from "@/features/commerce/chat-request";
import { relationArray, statusLabel } from "@/features/commerce/model";
export const dynamic = "force-dynamic";
export default async function Orders({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    customer?: string;
    page?: string;
    sort?: string;
  }>;
}) {
  if (!commerceEnabled()) notFound();
  const staff = await requireCommerceStaff("/admin/orders");
  const { q = "", status = "", customer = "", page = "1", sort = "newest" } = await searchParams;
  const offset =
    (Math.max(1, Math.min(10000, Number.parseInt(page) || 1)) - 1) * 50;
  let query = staff.client
    .from("commerce_orders")
    .select(
      "id,number,customer_id,assigned_to,contact_email,status,payment_status,created_at,commerce_order_items(id,product_slug,title,destination,requested_date,adults,children,options,commerce_bookings(id,status,revision)),commerce_documents(id,kind,version),commerce_order_notes(id,note,created_at)",
    )
    .order("created_at", { ascending: sort === "oldest" })
    .range(offset, offset + 50);
  if (q) {
    const value = q.replace(/[^\p{L}\p{N}@.+ -]/gu, "").slice(0,100);
    if(value) query = query.or(`number.ilike.%${value}%,contact_email.ilike.%${value}%`);
  }
  if (status) query = query.eq("status", status);
  if (customer && /^[0-9a-f-]{36}$/i.test(customer))
    query = query.eq("customer_id", customer);
  const { data, error } = await query;
  const orders = data?.slice(0, 50) ?? [];
  const ids = orders.map(order => order.id);
  const crm = ids.length ? await staff.client.from("commerce_order_crm").select("order_id,stage").in("order_id",ids) : null;
  const profiles = orders.length ? await staff.client.from("commerce_profiles").select("user_id,display_name,phone")
    .in("user_id", [...new Set(orders.map(order=>order.customer_id))]) : null;
  const repository = getTourRepository();
  const hints = new Map<string,string>();
  for (const order of orders) for (const item of order.commerce_order_items) {
    const tour = await repository.bySlug(item.product_slug);
    const hint = tour && priceHint(tour,true);
    if(hint) hints.set(item.id,hint);
  }
  return (
    <section>
      <h1>Заявки</h1>
      <p>
        Оплаты не подключены. Выручка не рассчитывается из заявок. Доступ
        сотрудников требует MFA.
      </p>
      <form>
        <label>
          Номер заявки или email
          <input name="q" defaultValue={q} maxLength={100} />
        </label>
        <label>Порядок<select name="sort" defaultValue={sort}><option value="newest">Новые сначала</option><option value="oldest">Старые сначала</option></select></label>
        <label>
          Статус
          <select name="status" defaultValue={status}>
            <option value="">Все</option>
            {[
              "requested",
              "awaiting_availability",
              "confirmed",
              "cancelled",
              "rejected",
            ].map((s) => (
              <option key={s} value={s}>{statusLabel(s,"ru")}</option>
            ))}
          </select>
        </label>
        <button>Найти</button>
      </form>
      {error ? (
        <p>Данные недоступны. Проверьте миграцию и права.</p>
      ) : !data?.length ? (
        <p>Заявок пока нет.</p>
      ) : (
        orders.map((o) => (
          <details key={o.id} className="crm-order">
            <summary>
              {o.number} · {statusLabel(o.status,"ru")}
            </summary>
            <p>Контакт: {o.contact_email}</p>
            <p>Создана: {new Date(o.created_at).toLocaleString("ru-RU",{timeZone:"UTC"})} UTC</p>
            <p>{profiles?.data?.find(p=>p.user_id===o.customer_id)?.display_name} · {profiles?.data?.find(p=>p.user_id===o.customer_id)?.phone}</p>
            <p>Ответственный: {o.assigned_to || "Не назначен"}</p>
            <a href={`/admin/customers?customer=${o.customer_id}`}>Профиль клиента</a>
            {!crm?.error && staff.role !== "support" && <CRMStage order={o.id} stage={crm?.data?.find(c=>c.order_id===o.id)?.stage ?? "new"}/>}
            {staff.role !== "support" && <OrderManagement id={o.id} />}
            <p>Оплата: {o.payment_status}</p>
            {o.commerce_order_items.map((i) => (
              <article key={i.id}>
                <h2>{i.title.ru}</h2>
                <p>
                  {i.requested_date} · {i.adults} + {i.children}
                </p>
                <p>{i.destination?.ru}</p>
                {hints.has(i.id) && <p>{hints.get(i.id)}</p>}
                {i.options && <p>Пожелания: {i.options}</p>}
                {relationArray(i.commerce_bookings).map((b) => (
                  <div key={b.id}>
                    {staff.role !== "support" ? (
                      <BookingAction
                        id={b.id}
                        revision={b.revision}
                        status={b.status}
                      />
                    ) : (
                      <p>{b.status}</p>
                    )}
                  </div>
                ))}
              </article>
            ))}
            {o.commerce_order_notes.map((n) => (
              <p key={n.id}>
                {n.created_at}: {n.note}
              </p>
            ))}
            {o.commerce_documents.map((d) => (
              <p key={d.id}>
                <a href={`/api/commerce/document/${d.id}?locale=ru`}>
                  {d.kind} · v{d.version}
                </a>
              </p>
            ))}
          </details>
        ))
      )}
      <nav className="crm-period" aria-label="Страницы заявок">
        {offset>0 && <a href={`?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&customer=${encodeURIComponent(customer)}&sort=${sort === "oldest" ? "oldest" : "newest"}&page=${Math.max(1,Math.floor(offset/50))}`}>Назад</a>}
        <span>Страница {Math.floor(offset/50)+1}</span>
        {(data?.length ?? 0)>50 && <a href={`?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&customer=${encodeURIComponent(customer)}&sort=${sort === "oldest" ? "oldest" : "newest"}&page=${Math.floor(offset/50)+2}`}>Далее</a>}
      </nav>
      {offset > 0 && (
        <a
          href={`/admin/orders?${new URLSearchParams({ q, status, customer, page: String(offset / 50) })}`}
        >
          Предыдущая страница
        </a>
      )}
      {data?.length === 50 && (
        <a
          href={`/admin/orders?${new URLSearchParams({ q, status, customer, page: String(offset / 50 + 2) })}`}
        >
          Следующая страница
        </a>
      )}
    </section>
  );
}
