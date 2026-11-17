import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { commerceEnabled } from "@/features/commerce/config";
import { analyticsEvents } from "@/features/commerce/analytics";
import { limitedJSON } from "@/features/admin/http";
import { assertOrigin } from "@/features/admin/security";
import { allowAnalyticsEvent } from "@/features/commerce/rate-limit";
import { getTourRepository } from "@/features/tours/repository";
import { safeAnalyticsDetail } from "@/features/commerce/analytics-privacy";

export const runtime = "nodejs";
const schema = z.object({
  event: z.enum(analyticsEvents), path: z.string().max(200).regex(/^\/(ru|en)(?:\/[a-z0-9-]+)*\/?$/),
  detail: z.string().max(120).default(""), referrer: z.string().max(150).default(""),
});
export async function POST(request: Request) {
  if (!commerceEnabled() || process.env.COMMERCE_ENVIRONMENT !== "staging" ||
      process.env.VERCEL_ENV !== "preview")
    return new Response(null, { status: 404 });
  const secret = process.env.COMMERCE_TELEGRAM_CRON_SECRET;
  const key = process.env.COMMERCE_TELEGRAM_SUPABASE_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!secret || !key || !url) return new Response(null, { status: 503 });
  if (!/(?:^|;\s*)ae-analytics=yes(?:;|$)/.test(request.headers.get("cookie") ?? ""))
    return new Response(null, { status: 204 });
  try {
    assertOrigin(request);
    const input = schema.parse(await limitedJSON(request, 2048));
    const address = process.env.VERCEL === "1" ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "Unknown" : "local";
    const agent = request.headers.get("user-agent") ?? "";
    const day = new Date().toISOString().slice(0, 10);
    const hash = createHmac("sha256", secret).update("analytics:" + day + ":" + address + ":" + agent).digest("hex");
    if (!allowAnalyticsEvent(hash))
      return new Response(null, { status: 429 });
    const country = process.env.VERCEL === "1" ? request.headers.get("x-vercel-ip-country") || "Unknown" : "Unknown";
    const rawCity = process.env.VERCEL === "1" ? request.headers.get("x-vercel-ip-city") || "Unknown" : "Unknown";
    let city = "Unknown";
    try { city = decodeURIComponent(rawCity).slice(0, 100); } catch {}
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    let detail = safeAnalyticsDetail(input.detail);
    if (input.event === "product" || input.event === "cart_add") {
      const slug = input.path.split("/").pop() ?? "";
      const tour = await getTourRepository().bySlug(slug);
      if (tour) detail = (tour.country + "/" + tour.location).slice(0,120);
    }
    const source = /^[a-z0-9.-]+$/i.test(input.referrer) ? input.referrer : "";
    const { error } = await db.rpc("commerce_record_event", {
      visitor:hash,event_name:input.event,page_path:input.path,event_detail:detail,
      visitor_country:country.slice(0,60),visitor_city:city,
      visitor_device:/ipad|tablet/i.test(agent) ? "tablet" : /mobile|android/i.test(agent) ? "mobile" : "desktop",
      source_host:source,
    });
    if(error) console.error("commerce_analytics_write", /^[A-Z0-9_]+$/i.test(error.code) ? error.code : "unavailable");
    return new Response(null, { status: error ? 503 : 204 });
  } catch { return new Response(null, { status: 400 }); }
}
