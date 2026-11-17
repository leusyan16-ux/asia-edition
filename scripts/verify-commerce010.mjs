import { createClient } from "@supabase/supabase-js";

const ref = "xnnxmhwvixrqenunhhbt";
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.COMMERCE_TELEGRAM_SUPABASE_SECRET;
  if (process.env.VERCEL_ENV !== "preview" ||
      process.env.COMMERCE_STAGING_PROJECT_REF !== ref ||
      !url || new URL(url).href !== `https://${ref}.supabase.co/` || !key)
    throw Error("STAGING_010_CONFIGURATION");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tables = ["commerce_customer_notes", "commerce_order_crm", "commerce_analytics_daily"];
  for (const table of tables) {
    const result = await client.from(table).select("*").limit(0);
    if (result.error) throw Error("STAGING_010_TABLE_" + table);
    console.log("COMMERCE010", JSON.stringify({ table, accessible: true }));
  }
  const owner = await client.from("commerce_staff")
    .select("user_id", { head: true, count: "exact" }).eq("role", "owner").eq("active", true);
  if (owner.error) throw Error("STAGING_010_STAFF");
  console.log("COMMERCE010", JSON.stringify({ activeOwners: owner.count }));
  const requests=await client.from("commerce_orders").select("id",{count:"exact"}).limit(0);
  if(requests.error) throw Error("STAGING_010_ORDERS");
  console.log("COMMERCE010", JSON.stringify({ existingRequests:requests.count }));
  const sample = await client.from("commerce_order_items")
    .select("commerce_bookings(id,status,revision)").limit(1);
  if(sample.error) throw Error("STAGING_010_BOOKING_RELATION");
  const relation = sample.data?.[0]?.commerce_bookings;
  console.log("COMMERCE010", JSON.stringify({
    bookingRelation: relation == null ? "empty" : Array.isArray(relation) ? "array" : "object",
    // Only schema shape is logged, never request content or customer identities.
  }));
  const anonymous = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const eventValidation = await client.rpc("commerce_record_event", {
    visitor: "f".repeat(64), event_name: "__invalid_validation_probe__",
    page_path: "/en", event_detail: "", visitor_country: "Unknown",
    visitor_city: "Unknown", visitor_device: "desktop", source_host: "",
  });
  console.log("COMMERCE010", JSON.stringify({
    eventRpcValidationCode: eventValidation.error?.code ?? "unexpected_acceptance",
    suggestedSignature: eventValidation.error?.hint?.match(/public\.commerce_[a-z_]+\([^)]*\)/)?.[0] ?? null,
  }));
  if(eventValidation.error?.code !== "23514") throw Error("STAGING_010_EVENT_VALIDATION");
  for (const name of ["commerce_dashboard", "commerce_customers"]) {
    // Neither key has a staff identity. PostgREST may hide ungranted RPCs.
    const service = await client.rpc(name, {});
    if (!service.error || service.error.code !== "P0001")
      throw Error("STAGING_010_RPC_" + name);
    const result = await anonymous.rpc(name, {});
    if (!result.error || result.error.code !== "42501")
      throw Error("STAGING_010_PERMISSION_" + name);
    console.log("COMMERCE010", JSON.stringify({ rpc: name, anonymousDenied: true,
      serviceCode: service.error.code, anonymousCode: result.error.code }));
  }
}
main().catch(error => {
  const safe = /^STAGING_010_[a-zA-Z0-9_]+$/.test(error.message) ? error.message : "STAGING_010_FAILED";
  console.error("COMMERCE010", safe);
  process.exitCode = 1;
});
