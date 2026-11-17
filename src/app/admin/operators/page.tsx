import { redirect } from "next/navigation";
import { currentAdmin } from "@/features/admin/server";
import { postgresSelected } from "@/features/ingestion/config";
import { OperatorForm } from "@/features/inquiries/operator-form";
export default async function Operators() {
  if (!(await currentAdmin())) redirect("/admin/login");
  return (
    <section className="admin-section">
      <h1>Проверка операторов</h1>
      <p>
        Добавляйте только реальных проверенных поставщиков. Документ проверки
        хранится в закрытом административном справочнике.
      </p>
      {postgresSelected() ? (
        <OperatorForm />
      ) : (
        <p>Для этого интерфейса требуется PostgreSQL.</p>
      )}
    </section>
  );
}
