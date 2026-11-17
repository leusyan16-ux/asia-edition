import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, type Session } from "@supabase/supabase-js";
import { commerceEnabled } from "./config";
export { commerceEnabled } from "./config";
export async function commerceClient(token?: string) {
  if (!commerceEnabled()) throw Error("Commerce disabled");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw Error("Authentication not configured");
  const jar = await cookies();
  const memory = new Map<string, string>();
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      flowType: "pkce",
      storage: {
        getItem: (k) =>
          k.endsWith("-code-verifier")
            ? (jar.get("ae-pkce-" + k)?.value ?? null)
            : (memory.get(k) ?? null),
        setItem: (k, v) => {
          if (!k.endsWith("-code-verifier")) {
            memory.set(k, v);
            return;
          }
          jar.set("ae-pkce-" + k, v, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/api/commerce",
            maxAge: 600,
          });
        },
        removeItem: (k) => {
          if (!k.endsWith("-code-verifier")) {
            memory.delete(k);
            return;
          }
          jar.set("ae-pkce-" + k, "", {
            path: "/api/commerce",
            maxAge: 0,
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
          });
        },
      },
    },
    global: token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : undefined,
  });
}
export async function writeSession(session: Session | null) {
  const jar = await cookies();
  for (const [name, value, age] of [
    ["ae-access", session?.access_token, session?.expires_in ?? 3600],
    ["ae-refresh", session?.refresh_token, 30 * 86400],
  ] as const) {
    if (value)
      jar.set(name, value, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: age,
      });
    else jar.delete(name);
  }
}
export async function commerceIdentity(withAuthSession = false) {
  const token = (await cookies()).get("ae-access")?.value;
  if (!token) throw Error("Authentication required");
  const client = await commerceClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user || !data.user.email_confirmed_at)
    throw Error("Authentication required");
  const refresh_token = (await cookies()).get("ae-refresh")?.value;
  if (withAuthSession && refresh_token) {
    const session = await client.auth.setSession({
      access_token: token,
      refresh_token,
    });
    if (session.error) throw Error("Session expired");
  }
  return { client, user: data.user };
}
export async function commerceStaff() {
  const { client, user } = await commerceIdentity();
  const { data, error } = await client.rpc("commerce_staff_role");
  if (error || !["owner", "admin", "manager", "support"].includes(data))
    throw Error("Staff MFA required");
  return { client, user, role: data as string };
}
export async function requireCommerceStaff(path: string) {
  try {
    return await commerceStaff();
  } catch (error) {
    const reason = error instanceof Error && error.message === "Authentication required"
      ? "session_required" : error instanceof Error && error.message === "Staff MFA required"
        ? "staff_mfa_required" : "auth_unavailable";
    console.warn("commerce_admin_access", reason);
  }
  // Server Components cannot renew cookies. The login screen uses the existing
  // same-origin API to refresh once before retrying the server authorization.
  redirect("/admin/login?next=" + encodeURIComponent(path));
}
export function authOrigin() {
  const origin = process.env.SITE_URL;
  if (!origin) throw Error("SITE_URL required");
  const u = new URL(origin);
  if (u.pathname !== "/" || u.search || u.hash || u.username || u.password)
    throw Error("Root origin required");
  if (
    u.protocol !== "https:" &&
    !(
      process.env.NODE_ENV === "development" &&
      ["localhost", "127.0.0.1"].includes(u.hostname)
    )
  )
    throw Error("HTTPS required");
  return u.origin;
}
