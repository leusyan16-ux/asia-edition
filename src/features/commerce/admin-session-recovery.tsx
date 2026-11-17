"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { commerceAPI } from "./client-api";

/** Recover only through the existing authenticated API; never infer a role locally. */
export function AdminSessionRecovery({ target }: { target: string }) {
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState("");
  async function recover() {
    setChecking(true);
    try {
      const session = await commerceAPI("session");
      if (session?.adminRole || session?.staffRole) {
        window.location.replace(target);
        return;
      }
      setMessage(session?.user
        ? "Для входа в управление подтвердите MFA в профиле. Доступ разрешён только действующим сотрудникам."
        : "Войдите в аккаунт сотрудника и подтвердите MFA в профиле.");
    } catch {
      setMessage("Не удалось восстановить сессию. Войдите повторно или подтвердите MFA в профиле.");
    }
    setChecking(false);
  }
  useEffect(() => {
    // One bounded API refresh/retry; credentials remain in HttpOnly cookies.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void recover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <section className="crm-page">
    <h1>Вход в панель управления</h1>
    <p role="status">{checking ? "Проверяем и восстанавливаем защищённую сессию…" : message}</p>
    <p><Link href="/ru/account/profile">Войти / подтвердить MFA</Link></p>
    <button type="button" disabled={checking} onClick={() => void recover()}>Проверить доступ повторно</button>
  </section>;
}
