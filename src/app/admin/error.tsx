"use client";
import Link from "next/link";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <section className="admin-section">
      <h1>Не удалось загрузить управление</h1>
      <p>
        Проверьте Supabase, миграции и права администратора. Данные не изменены.
      </p>
      <button className="admin-primary" onClick={reset}>
        Повторить
      </button>
      <Link href="/admin/login">Войти снова</Link>
    </section>
  );
}
