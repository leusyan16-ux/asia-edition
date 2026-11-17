"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function PostgresReviewPanel({
  id,
  expected,
  initial,
}: {
  id: string;
  expected: string;
  initial: { editorial: string; rights: string; evidence: string | null };
}) {
  const [editorial, setEditorial] = useState(initial.editorial),
    [rights, setRights] = useState(initial.rights),
    [evidence, setEvidence] = useState(initial.evidence ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    router = useRouter();
  return (
    <section className="admin-section">
      <h2>Редакционная проверка и права</h2>
      <p>
        Сначала сохраните изменения карточки. Проверка применяется к сохранённой
        версии и не разрешает публикацию.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (
              document
                .querySelector(".admin-editor")
                ?.getAttribute("data-dirty") === "true"
            )
              throw new Error("Сначала сохраните изменения карточки");
            const r = await fetch("/admin/api/postgres", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "review",
                id,
                expected,
                editorial,
                rights,
                evidence: evidence || null,
              }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error);
            router.refresh();
          } catch (e) {
            setError(String((e as Error).message));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="admin-fields">
          <label>
            Редакционный статус
            <select
              aria-label="Редакционный статус"
              value={editorial}
              onChange={(e) => setEditorial(e.target.value)}
            >
              <option value="pending">Ожидает проверки</option>
              <option value="approved">Проверено</option>
              <option value="rejected">Отклонено</option>
            </select>
          </label>
          <label>
            Права на контент
            <select
              aria-label="Права на контент"
              value={rights}
              onChange={(e) => setRights(e.target.value)}
            >
              <option value="unknown">Не подтверждены</option>
              <option value="licensed">Подтверждены</option>
              <option value="restricted">Ограничены</option>
            </select>
          </label>
          <label>
            Документ о правах (HTTPS)
            <input
              type="url"
              aria-label="Документ о правах (HTTPS)"
              maxLength={2048}
              value={evidence}
              required={rights === "licensed"}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="https://"
            />
          </label>
        </div>
        <button className="admin-primary" disabled={busy}>
          Сохранить проверку
        </button>
        {error && (
          <p role="alert" className="admin-error">
            {error}
          </p>
        )}
      </form>
      <details>
        <summary>Отдельное разрешение на публикацию</summary>
        <p>
          После проверки прав и обязательных данных карточка станет видна
          посетителям. Импорт не выполняет это действие.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              if (
                document
                  .querySelector(".admin-editor")
                  ?.getAttribute("data-dirty") === "true"
              )
                throw new Error("Сначала сохраните изменения карточки");
              const confirmation = new FormData(e.currentTarget).get(
                "confirmation",
              );
              const r = await fetch("/admin/api/postgres", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "publish",
                  id,
                  expected,
                  confirmation,
                }),
              });
              const data = await r.json();
              if (!r.ok) throw new Error(data.error);
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Введите ПУБЛИКОВАТЬ для подтверждения
            <input
              name="confirmation"
              required
              pattern="ПУБЛИКОВАТЬ"
              autoComplete="off"
            />
          </label>
          <button className="admin-primary" disabled={busy}>
            Разрешить и опубликовать эту версию
          </button>
        </form>
      </details>
    </section>
  );
}
