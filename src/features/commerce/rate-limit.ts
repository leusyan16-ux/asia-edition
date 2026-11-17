import { createHash, randomBytes } from "node:crypto";
const salt = randomBytes(32);
const buckets = new Map<string, { count: number; until: number }>();
/** Per-instance brake, not a replacement for Supabase auth rate limits or a staging WAF. */
function allowAttempt(address: string, now: number, limit: number, window: number) {
  const id = createHash("sha256").update(salt).update(address).digest("hex");
  for (const [k, v] of buckets) if (v.until < now) buckets.delete(k);
  const old = buckets.get(id);
  if (!old && buckets.size >= 2000) return false;
  const b = old ?? { count: 0, until: now + window };
  b.count++;
  buckets.set(id, b);
  return b.count <= limit;
}
export const allowAuthAttempt = (address: string, now = Date.now()) => allowAttempt("auth:"+address,now,10,600000);
export const allowAnalyticsEvent = (address: string, now = Date.now()) => allowAttempt("analytics:"+address,now,120,60000);
