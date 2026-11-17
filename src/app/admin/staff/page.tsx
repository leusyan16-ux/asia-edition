import { notFound } from "next/navigation";
import { commerceEnabled, requireCommerceStaff } from "@/features/commerce/server";
import { StaffConsole } from "@/features/commerce/staff-console";
export const dynamic = "force-dynamic";
export default async function Staff() {
  if (!commerceEnabled()) notFound();
  const identity = await requireCommerceStaff("/admin/staff");
  if (identity.role !== "owner") notFound();
  const { data, error } = await identity.client
    .from("commerce_staff")
    .select("user_id,role,active");
  return (
    <section>
      <h1>Сотрудники</h1>
      {error ? (
        <p>Список недоступен.</p>
      ) : (
        data?.map((s) => (
          <p key={s.user_id}>
            {s.user_id} · {s.role} · {s.active ? "Активен" : "Отключён"}
          </p>
        ))
      )}
      <StaffConsole />
    </section>
  );
}
