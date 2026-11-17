"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function OperatorForm() {
  const [state, setState] = useState(""),
    router = useRouter();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setState("Сохранение…");
        try {
          const r = await fetch("/admin/api/operators", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: data.get("name"),
              evidence: data.get("evidence"),
              confirmation: data.get("confirmation") === "on",
            }),
          });
          if (!r.ok) throw new Error();
          setState("Оператор сохранён. Обновите редактор экскурсии.");
          router.refresh();
        } catch {
          setState("Сохранение не выполнено. Проверьте данные и доступ.");
        }
      }}
    >
      <label>
        Название оператора
        <input name="name" required maxLength={200} />
      </label>
      <label>
        Ссылка на документ проверки (HTTPS)
        <input type="url" name="evidence" required maxLength={2048} />
      </label>
      <label>
        <input type="checkbox" name="confirmation" required />Я проверил
        оператора и подтверждающие документы
      </label>
      <button className="admin-primary" disabled={state === "Сохранение…"}>
        Сохранить проверенного оператора
      </button>
      <p role="status">{state}</p>
    </form>
  );
}
