"use client";
import { useEffect, useState } from "react";
export function InquiryForm({
  product,
  locale,
}: {
  product: string;
  locale: "ru" | "en";
}) {
  const ru = locale === "ru",
    [token, setToken] = useState(""),
    [state, setState] = useState("loading"),
    [reference, setReference] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/inquiries", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (active) {
          setToken(d.token);
          setState("ready");
        }
      })
      .catch(() => {
        if (active) setState("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="inquiry-section" aria-labelledby="inquiry-title">
      <h2 id="inquiry-title">
        {ru ? "Запросить информацию" : "Ask about this activity"}
      </h2>
      <p>
        {ru
          ? "Оставьте запрос на связь. Это не бронирование: места и стоимость требуют отдельного подтверждения. Оплата не взимается."
          : "Send a contact request. This is not a booking: availability and price require separate confirmation. No payment is taken."}
      </p>
      {state === "sent" ? (
        <p role="status">
          {ru
            ? "Запрос сохранён. Номер обращения:"
            : "Request saved. Reference:"}{" "}
          {reference}
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              data = new FormData(form);
            setState("sending");
            try {
              const r = await fetch("/api/inquiries", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  product,
                  locale,
                  token,
                  name: data.get("name"),
                  email: data.get("email"),
                  message: data.get("message"),
                  website: data.get("website"),
                  consent: data.get("consent") === "on",
                }),
              });
              const result = await r.json();
              if (!r.ok) throw new Error();
              setReference(result.id);
              setState("sent");
            } catch {
              setState("error");
            }
          }}
        >
          <label>
            {ru ? "Имя" : "Name"}
            <input name="name" autoComplete="name" required maxLength={120} />
          </label>
          <label>
            Email
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label>
            {ru ? "Ваш вопрос" : "Your question"}
            <textarea name="message" rows={4} maxLength={2000} />
          </label>
          <div hidden aria-hidden="true">
            <label>
              Website
              <input
                name="website"
                tabIndex={-1}
                autoComplete="off"
                defaultValue=""
              />
            </label>
          </div>
          <label className="inquiry-consent">
            <input type="checkbox" name="consent" required />
            {ru
              ? "Согласен на обработку имени, email и сообщения для ответа на этот запрос."
              : "I agree to the processing of my name, email and message to answer this request."}
          </label>
          <button
            className="primary-button"
            disabled={!token || state === "sending"}
          >
            {state === "sending"
              ? ru
                ? "Сохранение…"
                : "Saving…"
              : ru
                ? "Отправить запрос"
                : "Send request"}
          </button>
          <p role="status">
            {state === "unavailable"
              ? ru
                ? "Приём запросов временно недоступен."
                : "Requests are temporarily unavailable."
              : state === "error"
                ? ru
                  ? "Запрос не сохранён. Проверьте данные или повторите позже. Повторная отправка не создаст дубль."
                  : "Request was not saved. Check your details or retry later. Retrying will not duplicate it."
                : ""}
          </p>
        </form>
      )}
    </section>
  );
}
