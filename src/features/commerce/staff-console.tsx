"use client";
import { useState } from "react";
export function StaffConsole() {
  const [result, setResult] = useState("");
  async function send(action: string, data: unknown) {
    const r = await fetch("/api/commerce/" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const value = await r.json();
    setResult(
      r.ok
        ? JSON.stringify(value)
        : "Действие отклонено. Требуются owner, MFA и корректные данные.",
    );
  }
  return (
    <section>
      <h2>Доступ сотрудников</h2>
      <p>
        Приглашения действуют 48 часов. Передайте одноразовый токен сотруднику
        через защищённый канал. Owner через приглашения не назначается.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void send("invite", { email: f.get("email"), role: f.get("role") });
        }}
      >
        <label>
          Email
          <input type="email" name="email" required />
        </label>
        <label>
          Роль
          <select name="role">
            {["admin", "manager", "editor", "support"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <button>Создать приглашение</button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void send("staff", {
            user: f.get("user"),
            role: f.get("role"),
            active: f.get("active") === "on",
          });
        }}
      >
        <label>
          UUID сотрудника
          <input name="user" required />
        </label>
        <label>
          Роль
          <select name="role">
            {["owner", "admin", "manager", "editor", "support"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" name="active" defaultChecked />
          Доступ активен
        </label>
        <button>Изменить с аудитом</button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void send("invite-revoke", { id: f.get("id") });
        }}
      >
        <label>
          ID приглашения
          <input name="id" required />
        </label>
        <button>Отозвать приглашение</button>
      </form>
      <p role="status" style={{ overflowWrap: "anywhere" }}>
        {result}
      </p>
    </section>
  );
}
