import { timingSafeEqual } from "node:crypto";
import { deliverTelegramOrder } from "@/features/commerce/telegram-outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const expected = process.env.COMMERCE_TELEGRAM_CRON_SECRET;
  const auth = Buffer.from(request.headers.get("authorization") ?? "");
  const bearer = Buffer.from(`Bearer ${expected ?? ""}`);
  if (!expected || expected.length < 32 || auth.length !== bearer.length || !timingSafeEqual(auth, bearer))
    return new Response(null, { status: 404 });
  const statuses = [];
  // One job may have four Telegram messages. Reserve time for its checkpoints.
  const deadline = Date.now() + 15_000;
  for (let i = 0; i < 5 && Date.now() < deadline; i++) {
    const status = await deliverTelegramOrder();
    statuses.push(status);
    if (status !== "sent" && status !== "retry") break;
  }
  const unavailable = statuses.some((status) => ["disabled", "queue_unavailable", "checkpoint_unavailable"].includes(status));
  return Response.json({ statuses }, { status: unavailable ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
