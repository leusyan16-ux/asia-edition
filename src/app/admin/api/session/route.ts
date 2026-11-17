import { cookies } from "next/headers";
import { z } from "zod";
import {
  adminMode,
  localIdentity,
  sessionCookie,
  supabaseClient,
} from "@/features/admin/server";
import {
  assertOrigin,
  isLoopback,
  passwordMatches,
  signSession,
} from "@/features/admin/security";
import { limitedJSON } from "@/features/admin/http";
const attempts = new Map<string, { count: number; until: number }>();
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    if (Number(request.headers.get("content-length")) > 4096)
      return Response.json(
        { error: "Запрос слишком большой" },
        { status: 413 },
      );
    const { email, password } = z
      .object({
        email: z.email().max(254),
        password: z.string().min(1).max(256),
      })
      .parse(await limitedJSON(request, 4096));
    const key = email.toLowerCase();
    const now = Date.now();
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    const a = attempts.get(key) || { count: 0, until: now + 900000 };
    if (a.count >= 5 || attempts.size > 1000)
      return Response.json(
        { error: "Слишком много попыток. Повторите через 15 минут" },
        { status: 429 },
      );
    a.count++;
    attempts.set(key, a);
    let token: string;
    let maxAge = 3600;
    if (adminMode() === "local") {
      if (!isLoopback(request.headers.get("host") || ""))
        throw new Error("Локальный режим доступен только на localhost");
      const identity = await localIdentity();
      if (
        !identity ||
        identity.email.toLowerCase() !== key ||
        !passwordMatches(password, identity)
      )
        throw new Error("Неверные данные или нет доступа администратора");
      token = signSession(identity);
    } else if (adminMode() === "supabase") {
      const client = supabaseClient();
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error || !data.session)
        throw new Error("Неверные данные или нет доступа администратора");
      const role = await client
        .from("admin_members")
        .select("role")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (role.data?.role !== "admin") {
        await client.auth.signOut();
        throw new Error("Неверные данные или нет доступа администратора");
      }
      token = data.session.access_token;
      maxAge = Math.min(3600, data.session.expires_in);
    } else throw new Error("Администрирование не настроено");
    (await cookies()).set(sessionCookie, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/admin",
      maxAge,
    });
    attempts.delete(key);
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      {
        error:
          "Вход не выполнен. Проверьте учётные данные и настройку администратора",
      },
      { status: 401 },
    );
  }
}
export async function DELETE(request: Request) {
  try {
    assertOrigin(request);
    const jar = await cookies();
    jar.set(sessionCookie, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/admin",
      maxAge: 0,
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Недопустимый запрос" }, { status: 403 });
  }
}
