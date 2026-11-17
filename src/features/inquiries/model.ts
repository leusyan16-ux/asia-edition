import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Database } from "../ingestion/postgres-worker";
export const inquirySchema = z
  .object({
    product: z.string().regex(/^[a-z0-9-]{1,120}$/),
    name: z.string().trim().min(1).max(120),
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    message: z.string().trim().max(2000),
    locale: z.enum(["ru", "en"]),
    consent: z.literal(true),
    website: z.literal(""),
    token: z.string().max(512),
  })
  .strict();
function secret(key: string) {
  if (key.length < 32)
    throw new Error("Inquiry signing key must contain at least 32 characters");
  return key;
}
export function signChallenge(key: string, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ id: randomUUID(), at: now }),
  ).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", secret(key)).update(payload).digest("hex")
  );
}
export function verifyChallenge(token: string, key: string, now = Date.now()) {
  const [payload, signature, ...extra] = token.split(".");
  const expected = createHmac("sha256", secret(key))
    .update(payload ?? "")
    .digest("hex");
  if (
    extra.length ||
    !signature ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw new Error("Invalid request token");
  const value = z
    .object({ id: z.uuid(), at: z.number() })
    .parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
  if (now - value.at < 2000 || now - value.at > 30 * 60 * 1000)
    throw new Error("Request token expired or submitted too quickly");
  return value.id;
}
export async function saveInquiry(
  db: Database,
  input: unknown,
  productId: string,
  key: string,
) {
  const value = inquirySchema.parse(input),
    requestId = verifyChallenge(value.token, key);
  const hash = (s: string) =>
    createHmac("sha256", secret(key)).update(s).digest("hex");
  return db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(72619485)");
    const repeated = await tx.query<{ id: string }>(
      "select id from catalog_projection.inquiries where request_hash=$1",
      [hash(requestId)],
    );
    if (repeated.rows[0]) return repeated.rows[0].id;
    const count = await tx.query<{ total: number; contact: number }>(
      "select count(*)::int total,count(*) filter(where contact_hash=$1)::int contact from catalog_projection.inquiries where created_at>now()-interval '1 hour'",
      [hash(value.email)],
    );
    if (count.rows[0].total >= 200 || count.rows[0].contact >= 3)
      throw new Error("Inquiry rate limit exceeded");
    const visible = await tx.query(
      "select 1 from catalog_projection.documents where id=$1 and public_visible and not (document->>'isDemo')::boolean",
      [productId],
    );
    if (!visible.rows.length)
      throw new Error("Product is not available for inquiries");
    const id = randomUUID();
    await tx.query(
      "insert into catalog_projection.inquiries(id,product_id,name,email,message,locale,contact_hash,request_hash) values($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        productId,
        value.name,
        value.email,
        value.message,
        value.locale,
        hash(value.email),
        hash(requestId),
      ],
    );
    return id;
  });
}
