import "server-only";
import { notFound } from "next/navigation";
import { requireCommerceStaff } from "./server";

export async function readDashboard(period: 1 | 7 | 30) {
  const staff = await requireCommerceStaff("/admin/analytics");
  if (!["owner","admin"].includes(staff.role)) notFound();
  const { data, error } = await staff.client.rpc("commerce_dashboard",{days_count:period});
  if (!error && data) return { data, error:null };
  const code=error?.code ?? "empty_response";
  const safeCode=/^[A-Z0-9_]{1,30}$/i.test(code) ? code : "unavailable";
  console.error("commerce_dashboard_rpc",safeCode);
  return { data:null, error:safeCode };
}
