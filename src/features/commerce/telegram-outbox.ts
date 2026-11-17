import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getTourRepository } from "@/features/tours/repository";
import { commerceEnabled } from "./config";
import { priceHint } from "./chat-request";

type Job = {
  id: string; lease: string; attempts: number; next_part: number;
  number: string; created_at: string; name: string | null; email: string; phone: string | null;
  items: { slug: string; title: { ru: string }; destination: { ru: string }; date: string; adults: number; children: number }[];
};

function settings() {
  const { NEXT_PUBLIC_SUPABASE_URL: url, COMMERCE_TELEGRAM_SUPABASE_SECRET: key,
    COMMERCE_TELEGRAM_BOT_TOKEN: token, COMMERCE_TELEGRAM_CHAT_ID: chat } = process.env;
  if (!commerceEnabled() || process.env.COMMERCE_ENVIRONMENT !== "staging" ||
      process.env.VERCEL_ENV !== "preview" || !url || !key ||
      !token || !/^\d+:[\w-]+$/.test(token) || !chat || !/^-?\d+$/.test(chat)) return null;
  return { url, key, token, chat };
}

async function messages(job: Job, preferences: { product_slug: string; requested_date: string; options: string }[]) {
  const repository = getTourRepository();
  const oneLine = (text: string | null, limit = 120) => text?.replace(/\s+/g, " ").trim().slice(0, limit);
  const entries = await Promise.all(job.items.map(async (item, index) => {
    const tour = await repository.bySlug(item.slug);
    const options = oneLine(preferences
      .filter(row => row.product_slug === item.slug && row.requested_date === item.date && row.options)
      .map(row => row.options).join(" · "),140);
    return [
      `${index + 1}. ${oneLine(item.title.ru, 120)} · ${oneLine(item.destination.ru,80)}`,
      `${item.date} · взрослые: ${item.adults} · дети: ${item.children}`,
      tour ? priceHint(tour, true) : null,
      options ? "Пожелания: " + options : null,
    ].filter(Boolean).join("\n");
  }));
  const count = Math.ceil(entries.length / 6);
  const admin = process.env.SITE_URL ? new URL("/admin/orders", process.env.SITE_URL) : null;
  admin?.searchParams.set("q", job.number);
  return Array.from({ length: count }, (_, part) => [
    `ASIA EDITION · Заявка ${job.number}${count > 1 ? ` (${part + 1}/${count})` : ""}`,
    ...(part === 0 ? [
      `Создана: ${new Date(job.created_at).toISOString().replace("T", " ").slice(0, 19)} UTC`,
      `Контакты: ${[oneLine(job.name), oneLine(job.email, 254), oneLine(job.phone, 40)].filter(Boolean).join(" · ")}`,
      admin?.href,
    ] : []),
    ...entries.slice(part * 6, part * 6 + 6),
    "Ценовые ориентиры предварительные. Стоимость и наличие мест уточняет менеджер.",
  ].filter(Boolean).join("\n\n"));
}

export async function deliverTelegramOrder(orderId?: string) {
  const config = settings();
  if (!config) return "disabled";
  const db = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const claim = await db.rpc("commerce_telegram_claim", { target: orderId ?? null });
  if (claim.error) return "queue_unavailable";
  const job = claim.data as Job | null;
  if (!job) return "idle";
  const update = async (fields: Record<string, string | number | null>) => {
    const result = await db.from("commerce_telegram_outbox").update(fields)
      .eq("order_id", job.id).eq("lease_id", job.lease).select("order_id").maybeSingle();
    return !result.error && Boolean(result.data);
  };
  let failure = "delivery_failed";
  let retryAfter = 0;
  try {
    const preferences = await db.from("commerce_order_items").select("product_slug,requested_date,options").eq("order_id",job.id);
    if(preferences.error) throw Error();
    const parts = await messages(job, preferences.data ?? []);
    if (!parts.length) throw Error();
    for (let index = job.next_part; index < parts.length; index++) {
      const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: config.chat, text: parts[index], link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(8000),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        failure = `telegram_${response.status}`;
        retryAfter = Number(result.parameters?.retry_after) || 0;
        throw Error();
      }
      if (!(await update({ next_part: index + 1 }))) return "checkpoint_unavailable";
    }
    return (await update({ sent_at: new Date().toISOString(), lease_id: null, lease_until: null, last_error: null }))
      ? "sent" : "checkpoint_unavailable";
  } catch {
    const delay = Math.max(retryAfter, Math.min(3600, 30 * 2 ** Math.min(job.attempts, 7)));
    return (await update({
      next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
      lease_id: null, lease_until: null, last_error: failure,
    })) ? "retry" : "checkpoint_unavailable";
  }
}
