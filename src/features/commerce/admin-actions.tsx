"use client";
import { useState } from "react";
import { commerceAPI } from "./client-api";
export function CustomerNote({ customer }: { customer: string }) {
  const [message, setMessage] = useState("");
  return <form onSubmit={async event => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await commerceAPI("customer-note", { customer, note: new FormData(form).get("note") });
      setMessage("Заметка сохранена. Обновите страницу для просмотра."); form.reset();
    } catch { setMessage("Не удалось сохранить заметку. Проверьте права и подключение."); }
  }}><label>Внутренняя заметка<textarea name="note" required minLength={1} maxLength={2000}/></label>
    <button>Сохранить заметку</button><p role="status">{message}</p></form>;
}
export function CRMStage({ order, stage }: { order: string; stage: string }) {
  const [message, setMessage] = useState("");
  return <form onSubmit={async event => {
    event.preventDefault();
    try {
      await commerceAPI("crm-stage", { order, stage: new FormData(event.currentTarget).get("stage") });
      setMessage("Внутренний этап сохранён. Это не подтверждение поставщика.");
    } catch { setMessage("Этап не сохранён. Проверьте права и подключение."); }
  }}><label>Внутренний этап заявки<select name="stage" defaultValue={stage}>{[
    ["new","Новая"],["in_progress","В работе"],["awaiting_customer","Ожидает ответа клиента"],
    ["awaiting_confirmation","Ожидает подтверждения"],["confirmed","Подтверждена"],["completed","Завершена"],["cancelled","Отменена"],
  ].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <button>Сохранить этап</button><p role="status">{message}</p></form>;
}
export function BookingAction({
  id,
  revision,
  status,
}: {
  id: string;
  revision: number;
  status: string;
}) {
  const [message, setMessage] = useState(""),
    [pending, setPending] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const f = new FormData(e.currentTarget);
        try {
          const r = await fetch("/api/commerce/transition", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              booking: id,
              revision,
              target: f.get("target"),
              basis: f.get("basis"),
              supplier: f.get("supplier"),
            }),
          });
          setMessage(
            r.ok
              ? "Изменение сохранено. Обновите страницу для актуальной версии."
              : "Изменение отклонено. Проверьте права, переход и версию.",
          );
        } catch {
          setMessage("Сервис недоступен.");
        } finally {
          setPending(false);
        }
      }}
    >
      <p>
        Текущий статус: {status}, версия {revision}
      </p>
      <label>
        Следующий статус
        <select name="target">
          <option value="awaiting_availability">Проверка доступности</option>
          <option value="awaiting_supplier_confirmation">
            Ожидание поставщика
          </option>
          <option value="confirmed">Подтверждено поставщиком</option>
          <option value="cancelled">Отменено</option>
          <option value="rejected">Отклонено</option>
          <option value="completed">Завершено</option>
        </select>
      </label>
      <label>
        Основание и подтверждение поставщика
        <textarea name="basis" minLength={10} maxLength={2000} required />
      </label>
      <label>
        Код поставщика, если выдан
        <input name="supplier" maxLength={200} />
      </label>
      <button disabled={pending}>Сохранить с записью в аудит</button>
      <p role="status">{message}</p>
    </form>
  );
}
export function OrderManagement({ id }: { id: string }) {
  const [message, setMessage] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          const r = await fetch("/api/commerce/manage-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              order: id,
              manager: f.get("manager"),
              note: f.get("note"),
            }),
          });
          setMessage(
            r.ok
              ? "Назначение и заметка сохранены с аудитом."
              : "Изменение отклонено. Проверьте UUID менеджера и права.",
          );
        } catch {
          setMessage("Сервис недоступен.");
        }
      }}
    >
      <label>
        UUID менеджера (пусто — снять назначение)
        <input name="manager" maxLength={36} />
      </label>
      <label>
        Внутренняя заметка
        <textarea name="note" maxLength={2000} />
      </label>
      <button>Сохранить</button>
      <p role="status">{message}</p>
    </form>
  );
}
