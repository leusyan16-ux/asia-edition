import { allowAuthAttempt } from "@/features/commerce/rate-limit";
import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import {
  commerceEnabled,
  commerceClient,
  commerceIdentity,
  commerceStaff,
  writeSession,
  authOrigin,
} from "@/features/commerce/server";
import {
  requestSchema,
  validateRequestDates,
  mergeCart,
  cartLineSchema,
  relationArray,
} from "@/features/commerce/model";
import { requestPDF } from "@/features/commerce/pdf";
import { deliverTelegramOrder } from "@/features/commerce/telegram-outbox";
import { bookingTelegramUrl } from "@/features/inquiries/booking-contact";
import { managerContact } from "@/features/commerce/contact";
import { limitedJSON } from "@/features/admin/http";
import { assertOrigin } from "@/features/admin/security";
import { getTourRepository } from "@/features/tours/repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers });
function authFailure(error: { status?: number; code?: string }) {
  if (error.status === 429) return reply({ error: "try_later" }, 429);
  if (error.code === "invalid_credentials") return reply({ error: "invalid_credentials" }, 422);
  if (error.code === "email_not_confirmed") return reply({ error: "email_not_confirmed" }, 422);
  if (error.code === "weak_password") return reply({ error: "weak_password" }, 422);
  return reply({ error: "auth_service_unavailable" }, 503);
}
function checked<T>(result: { data: T; error: unknown }) {
  if (result.error) throw Error("Operation failed");
  return result.data;
}
export async function GET(
  req: Request,
  { params }: { params: Promise<{ action: string[] }> },
) {
  if (!commerceEnabled()) return reply({ error: "unavailable" }, 404);
  try {
    const { action } = await params;
    const url = new URL(req.url);
    if (action[0] === "callback") {
      const client = await commerceClient();
      const code = url.searchParams.get("code"),
        hash = url.searchParams.get("token_hash"),
        type = url.searchParams.get("type");
      const recovery =
        type === "recovery" ||
        (Boolean(code) &&
          (await cookies()).get("ae-auth-intent")?.value === "recovery");
      const result = code
        ? await client.auth.exchangeCodeForSession(code)
        : hash && ["signup", "recovery", "email"].includes(type ?? "")
          ? await client.auth.verifyOtp({
              token_hash: hash,
              type: type as "signup" | "recovery" | "email",
            })
          : null;
      if (!result || result.error || !result.data.session) {
        const locale = (await cookies()).get("ae-auth-locale")?.value === "en" ? "en" : "ru";
        return new Response(null, {
          status: 303,
          headers: { ...headers, Location: authOrigin() + "/" + locale + "/account?auth=expired" },
        });
      }
      await writeSession(result.data.session);
      (await cookies()).set("ae-auth-intent", "", {
        path: "/api/commerce",
        maxAge: 0,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });
      const response = new Response(null, {
        status: 303,
        headers: {
          ...headers,
          Location:
            authOrigin() +
            "/" +
            (result.data.user?.user_metadata?.locale === "en" ? "en" : "ru") +
            "/account" +
            (recovery ? "/password" : "?auth=confirmed"),
        },
      });
      return response;
    }
    if (action[0] === "products") {
      const slugs = z
        .array(z.string().regex(/^[a-z0-9-]{1,150}$/))
        .max(20)
        .parse(
          (url.searchParams.get("slugs") ?? "").split(",").filter(Boolean),
        );
      const products = await Promise.all(
        slugs.map(async (slug) => {
          const tour = await getTourRepository().bySlug(slug);
          return tour && !tour.isDemo && tour.status === "published"
            ? { slug, title: tour.title }
            : null;
        }),
      );
      return reply(products.filter(Boolean));
    }
    if (action[0] === "session") {
      const jar = await cookies();
      if (!jar.has("ae-access") && !jar.has("ae-refresh")) return reply(null);
    }
    const { client, user } = await commerceIdentity(action[0] === "mfa-factors");
    if (action[0] === "mfa-factors") {
      const result = await client.auth.mfa.listFactors();
      if (result.error) throw result.error;
      return reply(
        result.data.totp.map((f) => ({ id: f.id, status: f.status })),
      );
    }
    if (action[0] === "session") {
      const [profile, cart, staffRole] = await Promise.all([
        client
          .from("commerce_profiles")
          .select("display_name,phone,locale")
          .eq("user_id", user.id)
          .maybeSingle(),
        url.searchParams.get("view") === "cart"
          ? client.from("commerce_carts").select("items,revision").eq("user_id", user.id).maybeSingle()
          : null,
        client.rpc("commerce_staff_role"),
      ]);
      return reply({ user: { id: user.id, email: user.email }, profile: checked(profile), cart: cart && checked(cart),
        adminRole: !staffRole.error && ["owner","admin"].includes(staffRole.data) ? staffRole.data : null,
        staffRole: !staffRole.error && ["owner","admin","manager","support"].includes(staffRole.data) ? staffRole.data : null });
    }
    if (action[0] === "orders") {
      const orders = checked(
          await client
            .from("commerce_orders")
            .select("*,commerce_order_items(*,commerce_bookings(*))")
            .eq("customer_id", user.id)
            .order("created_at", { ascending: false })
            .limit(100),
      );
      return reply((orders ?? []).map(order => ({
        ...order,
        commerce_order_items: relationArray(order.commerce_order_items).map(item => ({
          ...item,
          commerce_bookings: relationArray(item.commerce_bookings),
        })),
      })));
    }
    if (action[0] === "favorites")
      return reply(
        checked(await client.from("commerce_favorites").select("product_slug")),
      );
    if (action[0] === "cart")
      return reply(
        checked(
          await client
            .from("commerce_carts")
            .select("items,revision")
            .eq("user_id", user.id)
            .maybeSingle(),
        ),
      );
    if (action[0] === "documents")
      return reply(
        checked(
          await client
            .from("commerce_documents")
            .select("id,order_id,kind,version,created_at")
            .order("created_at", { ascending: false })
            .limit(100),
        ),
      );
    if (action[0] === "document") {
      const id = z.uuid().parse(action[1]);
      const doc = checked(
        await client
          .from("commerce_documents")
          .select("*")
          .eq("id", id)
          .single(),
      );
      if (doc.kind === "voucher") {
        const b = checked(
          await client
            .from("commerce_bookings")
            .select("status")
            .eq("id", doc.payload.booking_id)
            .single(),
        );
        if (!b || (b.status !== "confirmed" && b.status !== "completed"))
          return reply({ error: "voucher_revoked" }, 409);
      }
      const bytes = await requestPDF(
        { ...doc.payload, documentVersion: doc.version },
        doc.kind,
        url.searchParams.get("locale") === "en" ? "en" : "ru",
      );
      return new Response(Buffer.from(bytes), {
        headers: {
          ...headers,
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="ASIA-EDITION-${id}.pdf"`,
        },
      });
    }
    if (action[0] === "export") {
      const data = checked(await client.rpc("commerce_export_personal"));
      return new Response(JSON.stringify(data), {
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Disposition":
            'attachment; filename="asia-edition-personal-data.json"',
        },
      });
    }
    return reply({ error: "not_found" }, 404);
  } catch {
    return reply(
      { error: "authentication_required_or_resource_unavailable" },
      401,
    );
  }
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ action: string[] }> },
) {
  if (!commerceEnabled()) return reply({ error: "unavailable" }, 404);
  try {
    assertOrigin(req);
    const { action } = await params;
    const body = await limitedJSON(req, 32768);
    if (["login", "register", "reset", "resend"].includes(action[0])) {
      const address =
        process.env.VERCEL === "1"
          ? (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            "unknown")
          : "local";
      if (body.website || !allowAuthAttempt(address))
        return reply({ error: "try_later" }, 429);
    }
    const client = await commerceClient();
    if (
      ["login", "register", "reset", "resend", "oauth", "refresh", "logout"].includes(
        action[0],
      )
    ) {
      const locale = body.locale === "en" ? "en" : "ru";
      if (action[0] === "logout") {
        const token = (await cookies()).get("ae-access")?.value;
        if (token)
          await (
            await commerceClient(token)
          ).auth.admin.signOut(token, "local");
        await writeSession(null);
        return reply({ ok: true });
      }
      if (action[0] === "refresh") {
        const refresh_token = (await cookies()).get("ae-refresh")?.value;
        if (!refresh_token) throw Error("Session expired");
        const r = await client.auth.refreshSession({ refresh_token });
        if (r.error || !r.data.session) throw Error("Session expired");
        await writeSession(r.data.session);
        return reply({ ok: true });
      }
      if (action[0] === "oauth") {
        if (process.env.COMMERCE_GOOGLE_ENABLED !== "true")
          return reply({ error: "provider_disabled" }, 503);
        const r = await client.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: authOrigin() + "/api/commerce/callback",
            skipBrowserRedirect: true,
          },
        });
        if (r.error) throw r.error;
        return reply({ url: r.data.url });
      }
      const email = z.email().max(254).parse(body.email);
      (await cookies()).set("ae-auth-locale", locale, {
        path: "/api/commerce", maxAge: 86400, httpOnly: true,
        secure: process.env.NODE_ENV === "production", sameSite: "lax",
      });
      if (action[0] === "resend") {
        const { error } = await client.auth.resend({
          type: "signup", email,
          options: { emailRedirectTo: authOrigin() + "/api/commerce/callback" },
        });
        return error ? authFailure(error) : reply({ status: "check_inbox" });
      }
      if (action[0] === "reset") {
        const reset = await client.auth.resetPasswordForEmail(email, {
          redirectTo: authOrigin() + "/api/commerce/callback",
        });
        if (reset.error)
          return authFailure(reset.error);
        (await cookies()).set("ae-auth-intent", "recovery", {
          path: "/api/commerce",
          maxAge: 600,
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
        });
        return reply({
          message: "If this email exists, recovery instructions will be sent.",
        });
      }
      const password = z.string().min(action[0] === "login" ? 1 : 12).max(128).parse(body.password);
      if (action[0] === "register") {
        const r = await client.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: authOrigin() + "/api/commerce/callback",
            data: { locale },
          },
        });
        if (r.error) return authFailure(r.error);
        if (r.data.session && r.data.user?.email_confirmed_at) {
          await writeSession(r.data.session);
          return reply({ status: "signed_in" });
        }
        return reply({ status: "check_inbox" });
      }
      const r = await client.auth.signInWithPassword({ email, password });
      if (r.error) return authFailure(r.error);
      if (!r.data.session || !r.data.user?.email_confirmed_at)
        return reply({ error: "email_not_confirmed" }, 422);
      await writeSession(r.data.session);
      return reply({ ok: true });
    }
    const identity = await commerceIdentity(["mfa-enroll", "mfa-verify", "password"].includes(action[0]));
    if (action[0] === "customer-note" || action[0] === "crm-stage") {
      const staff = await commerceStaff();
      if (!["owner", "admin", "manager"].includes(staff.role)) return reply({ error: "forbidden" }, 403);
      if (action[0] === "customer-note") {
        const input = z.object({ customer: z.uuid(), note: z.string().trim().min(1).max(2000) }).parse(body);
        checked(await staff.client.from("commerce_customer_notes").insert({
          customer_id: input.customer, note: input.note, actor: staff.user.id,
        }));
      } else {
        const input = z.object({ order: z.uuid(), stage: z.enum(["new","in_progress","awaiting_customer","awaiting_confirmation","confirmed","completed","cancelled"]) }).parse(body);
        checked(await staff.client.rpc("commerce_crm_stage", { oid: input.order, target: input.stage }));
      }
      return reply({ ok: true });
    }

    if (action[0] === "mfa-enroll") {
      const result = await identity.client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "ASIA EDITION",
      });
      if (result.error) throw result.error;
      return reply({ id: result.data.id, qr: result.data.totp.qr_code });
    }
    if (action[0] === "mfa-verify") {
      const factorId = z.uuid().parse(body.factor),
        code = z
          .string()
          .regex(/^\d{6}$/)
          .parse(body.code);
      const result = await identity.client.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
      if (result.error) throw result.error;
      const session = await identity.client.auth.setSession({
        access_token: result.data.access_token,
        refresh_token: result.data.refresh_token,
      });
      if (session.error || !session.data.session) throw Error("MFA failed");
      await writeSession(session.data.session);
      return reply({ ok: true });
    }
    if (action[0] === "invite") {
      const staff = await commerceStaff();
      if (staff.role !== "owner") return reply({ error: "forbidden" }, 403);
      const token = randomBytes(32).toString("hex");
      const id = checked(
        await staff.client.rpc("commerce_invite", {
          mail: z.email().parse(body.email),
          invited_role: z
            .enum(["admin", "manager", "editor", "support"])
            .parse(body.role),
          secret_hash: createHash("sha256").update(token).digest("hex"),
        }),
      );
      return reply({ id, token, expiresInHours: 48 });
    }
    if (action[0] === "invite-accept") {
      const token = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(body.token);
      checked(
        await identity.client.rpc("commerce_accept_invite", {
          secret_hash: createHash("sha256").update(token).digest("hex"),
        }),
      );
      return reply({ ok: true });
    }
    if (action[0] === "invite-revoke") {
      const staff = await commerceStaff();
      checked(
        await staff.client.rpc("commerce_revoke_invite", {
          invite_id: z.uuid().parse(body.id),
        }),
      );
      return reply({ ok: true });
    }
    if (action[0] === "password") {
      const result = await identity.client.auth.updateUser({
        password: z.string().min(12).max(128).parse(body.password),
      });
      if (result.error) throw result.error;
      return reply({ ok: true });
    }
    if (action[0] === "profile") {
      const p = z
        .object({
          display_name: z.string().max(120),
          phone: z.string().max(40),
          locale: z.enum(["ru", "en"]),
        })
        .parse(body);
      checked(
        await identity.client.from("commerce_profiles").upsert({
          ...p,
          user_id: identity.user.id,
          updated_at: new Date().toISOString(),
        }),
      );
      return reply({ ok: true });
    }
    if (action[0] === "request") {
      const input = requestSchema.parse(body);
      validateRequestDates(input.items);
      const repository = getTourRepository();
      await Promise.all(input.items.map(async (line) => {
        const tour = await repository.bySlug(line.slug);
        if (!tour || tour.isDemo || tour.status !== "published")
          throw Error("Product unavailable");
        return { line, tour };
      }));
      const contact = bookingTelegramUrl(managerContact);
      if (input.contact) {
        checked(await identity.client.from("commerce_profiles").upsert({
          user_id: identity.user.id,
          display_name: input.contact.name,
          phone: input.contact.phone,
          locale: input.locale,
          updated_at: new Date().toISOString(),
        }));
      }
      const result = await identity.client.rpc("commerce_request", {
          key: input.key,
          lang: input.locale,
          lines: input.items,
      });
      if (result.error?.message === "Requests disabled")
        return reply({ error: "requests_disabled" }, 503);
      const id = z.uuid().parse(checked(result));
      const order = await identity.client.from("commerce_orders").select("number").eq("id", id).maybeSingle();
      after(async () => {
        const delivery = await deliverTelegramOrder(id).catch(() => "delivery_error");
        console.info("commerce_telegram", delivery);
      });
      return reply(
        {
          id,
          number: order.data?.number ?? id,
          status: "requested",
          bookingConfirmed: false,
          paymentTaken: false,
          chat: contact ? { url: contact } : null,
        },
        201,
      );
    }
    if (action[0] === "cart") {
      const input = z
        .object({
          items: z.array(cartLineSchema).max(20),
          revision: z.number().int().nonnegative(),
        })
        .parse(body);
      const old = checked(
        await identity.client
          .from("commerce_carts")
          .select("items,revision")
          .eq("user_id", identity.user.id)
          .maybeSingle(),
      );
      const items =
        body.replace === true
          ? input.items
          : mergeCart(old?.items ?? [], input.items);
      if (old) {
        if (old.revision !== input.revision)
          return reply({ error: "cart_conflict" }, 409);
        const updated = checked(
          await identity.client
            .from("commerce_carts")
            .update({ items, revision: old.revision + 1 })
            .eq("user_id", identity.user.id)
            .eq("revision", old.revision)
            .select("revision"),
        );
        if (!updated?.length) return reply({ error: "cart_conflict" }, 409);
      } else
        checked(
          await identity.client
            .from("commerce_carts")
            .insert({ user_id: identity.user.id, items }),
        );
      return reply({ ok: true });
    }
    if (action[0] === "favorite") {
      const slug = z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .parse(body.slug);
      if (!body.remove && !await getTourRepository().bySlug(slug)) throw Error("Product unavailable");
      if (body.remove)
        checked(
          await identity.client
            .from("commerce_favorites")
            .delete()
            .eq("user_id", identity.user.id)
            .eq("product_slug", slug),
        );
      else
        checked(
          await identity.client
            .from("commerce_favorites")
            .upsert({ user_id: identity.user.id, product_slug: slug }),
        );
      return reply({ ok: true });
    }
    if (action[0] === "regenerate-receipt") {
      const id = checked(
        await identity.client.rpc("commerce_regenerate_receipt", {
          oid: z.uuid().parse(body.order),
        }),
      );
      return reply({ id });
    }
    if (action[0] === "privacy") {
      checked(await identity.client.rpc("commerce_privacy_request"));
      return reply({ status: "pending", retentionReviewRequired: true });
    }
    if (action[0] === "transition") {
      const input = z
        .object({
          booking: z.uuid(),
          revision: z.number().int().positive(),
          target: z.string().max(40),
          basis: z.string().min(10).max(2000),
          supplier: z.string().max(200).optional(),
        })
        .parse(body);
      checked(
        await identity.client.rpc("commerce_transition", {
          bid: input.booking,
          expected_revision: input.revision,
          target: input.target,
          basis: input.basis,
          supplier: input.supplier ?? null,
        }),
      );
      return reply({ ok: true });
    }
    if (action[0] === "manage-order") {
      const staff = await commerceStaff();
      checked(
        await staff.client.rpc("commerce_manage_order", {
          oid: z.uuid().parse(body.order),
          manager: body.manager ? z.uuid().parse(body.manager) : null,
          memo: z
            .string()
            .max(2000)
            .parse(body.note ?? ""),
        }),
      );
      return reply({ ok: true });
    }
    if (action[0] === "staff") {
      const staff = await commerceStaff();
      if (staff.role !== "owner") return reply({ error: "forbidden" }, 403);
      checked(
        await staff.client.rpc("commerce_staff_set", {
          subject: z.uuid().parse(body.user),
          new_role: z
            .enum(["owner", "admin", "manager", "editor", "support"])
            .parse(body.role),
          enabled: z.boolean().parse(body.active),
        }),
      );
      return reply({ ok: true });
    }
    return reply({ error: "not_found" }, 404);
  } catch {
    return reply({ error: "operation_not_completed" }, 400);
  }
}
