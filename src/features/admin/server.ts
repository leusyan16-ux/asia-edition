import "server-only";
import { publicPreviewOnly } from "@/lib/public-preview";
import { cookies, headers } from "next/headers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  authorize,
  isLoopback,
  verifySession,
  type LocalIdentity,
  type Principal,
  configuredAdminMode,
} from "./security";
import {
  adminTourSchema,
  adminDocumentSchema,
  adminSummarySchema,
  type AdminSummary,
  validateTour,
  type AdminTaxonomy,
  type AdminTour,
} from "./model";
import {
  localDirectory,
  readLocalTours,
  readLocalTourById,
  readLocalSourceLocations,
  readLocalSummaries,
  saveLocalBatch,
} from "./local-store";
import { adminCountries as countries } from "@/lib/catalog";
import { localCategories } from "./local-taxonomy";
import { postgresSelected } from "../ingestion/config";
import { nativeSelected } from "../ingestion/native-config";
import { postgresFor } from "../ingestion/runtime";
import {
  projectionTaxonomy,
  projectionById,
  saveProjection,
  projectionOverview,
  importDashboard,
} from "../ingestion/projection";
export const sessionCookie = "asia-admin-session";
export function adminMode() {
  if (publicPreviewOnly()) return "disabled";
  if (
    postgresSelected() &&
    !nativeSelected() &&
    (process.env.ADMIN_MODE !== "local" ||
      process.env.NODE_ENV !== "development")
  )
    return "disabled";
  return configuredAdminMode(process.env.ADMIN_MODE, process.env.NODE_ENV);
}
export async function localIdentity(): Promise<LocalIdentity | null> {
  try {
    return JSON.parse(
      await readFile(path.join(localDirectory(), "identity.json"), "utf8"),
    );
  } catch {
    return null;
  }
}
export function supabaseClient(token?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error("Настройте Supabase URL и публичный anon key");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : undefined,
  });
}
export async function currentAdmin(): Promise<Principal | null> {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return null;
  if (adminMode() === "local") {
    if (!isLoopback((await headers()).get("host") || "")) return null;
    const identity = await localIdentity();
    return identity ? verifySession(token, identity) : null;
  }
  if (adminMode() === "supabase") {
    try {
      const client = supabaseClient(token);
      const {
        data: { user },
        error,
      } = await client.auth.getUser(token);
      if (error || !user) return null;
      const role = await client
        .from("admin_members")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      return role.data?.role === "admin"
        ? { id: user.id, role: "admin", mode: "supabase", token }
        : null;
    } catch {
      return null;
    }
  }
  return null;
}
export async function requireAdmin() {
  const p = await currentAdmin();
  authorize(p);
  return p;
}
export async function adminTaxonomy(p: Principal): Promise<AdminTaxonomy> {
  authorize(p);
  if (postgresSelected())
    return projectionTaxonomy(await postgresFor("asia_catalog_editor"));
  if (p.mode === "local")
    return {
      locations: [
        ...countries.flatMap((c) =>
          c.destinations.map((d) => ({
            slug: d.slug,
            country: c.slug,
            name: d.name,
            kind: "destination" as const,
            parent: null,
          })),
        ),
        ...(await readLocalSourceLocations()),
      ].filter(
        (l, i, a) =>
          a.findIndex((o) => o.slug === l.slug && o.country === l.country) ===
          i,
      ),
      categories: localCategories,
      operators: [],
    };
  const client = supabaseClient(p.token);
  const [l, c, o] = await Promise.all([
    client
      .from("locations")
      .select("slug,country_slug,name_ru,name_en,kind,parent_id,id"),
    client.from("categories").select("slug,name_ru,name_en"),
    client.from("operators").select("id,name,verified_at"),
  ]);
  if (l.error || c.error || o.error)
    throw new Error("Не удалось загрузить справочники");
  return {
    locations: l.data.map((a) => ({
      slug: a.slug,
      country: a.country_slug,
      name: { ru: a.name_ru, en: a.name_en },
      kind: a.kind,
      parent: l.data.find((parent) => parent.id === a.parent_id)?.slug ?? null,
    })),
    categories: c.data.map((a) => ({
      slug: a.slug,
      name: { ru: a.name_ru, en: a.name_en },
    })),
    operators: o.data.map((a) => ({
      id: a.id,
      name: a.name,
      verifiedAt: a.verified_at,
    })),
  };
}
export async function adminTours(p: Principal): Promise<AdminTour[]> {
  authorize(p);
  if (postgresSelected())
    throw new Error(
      "Полное чтение PostgreSQL запрещено: используйте постраничный обзор",
    );
  if (p.mode === "local") return readLocalTours();
  const { data, error } = await supabaseClient(p.token).rpc("admin_inventory");
  if (error)
    throw new Error(
      "Не удалось загрузить инвентарь. Проверьте миграцию и роль",
    );
  return z.array(adminDocumentSchema).parse(data);
}
export async function adminOverview(p: Principal): Promise<AdminSummary[]> {
  authorize(p);
  if (postgresSelected())
    throw new Error("Используйте постраничный PostgreSQL обзор");
  if (p.mode === "local") return readLocalSummaries();
  const { data, error } = await supabaseClient(p.token).rpc("admin_overview");
  if (error)
    throw new Error("Не удалось загрузить обзор. Проверьте миграцию и роль");
  return z.array(adminSummarySchema).parse(data);
}
export async function adminTourById(
  p: Principal,
  id: string,
): Promise<AdminTour | null> {
  authorize(p);
  if (!z.uuid().safeParse(id).success) return null;
  if (postgresSelected())
    return projectionById(await postgresFor("asia_catalog_editor"), id);
  if (p.mode === "local") return readLocalTourById(id);
  const { data, error } = await supabaseClient(p.token).rpc("admin_inventory", {
    tour_filter: id,
  });
  if (error) throw new Error("Не удалось загрузить экскурсию");
  return z.array(adminDocumentSchema).parse(data)[0] ?? null;
}
export async function saveTours(
  p: Principal,
  batch: unknown[],
  expected: Record<string, string>,
) {
  authorize(p);
  const taxonomy = await adminTaxonomy(p);
  const tours = batch.map((t) => validateTour(t, taxonomy));
  if (!tours.length || tours.length > 1000)
    throw new Error("Пакет должен содержать 1–1000 экскурсий");
  if (new Set(tours.map((t) => t.id)).size !== tours.length)
    throw new Error("Повтор ID в пакете");
  if (postgresSelected())
    return saveProjection(
      await postgresFor("asia_catalog_editor"),
      tours,
      expected,
      p.id,
    );
  if (p.mode === "local") return saveLocalBatch(tours, expected);
  const { data, error } = await supabaseClient(p.token).rpc(
    "admin_save_batch",
    { documents: tours, expected_versions: expected },
  );
  if (error) {
    if (error.message.includes("version"))
      throw new Error("Данные изменились. Обновите страницу");
    if (error.message.includes("duplicate"))
      throw new Error("Такой адрес уже существует");
    throw new Error(
      "Сохранение отклонено базой данных. Весь пакет отменён; проверьте данные и права",
    );
  }
  return z.array(adminTourSchema).parse(data);
}
export async function adminInventoryPage(p: Principal, input: unknown) {
  authorize(p);
  if (postgresSelected())
    return projectionOverview(await postgresFor("asia_catalog_editor"), input);
  const tours = await adminOverview(p);
  const { overviewPage } = await import("./overview-query");
  return {
    ...overviewPage(tours, input),
    stats: {
      total: tours.length,
      published: tours.filter((t) => t.status === "published" && !t.archived)
        .length,
      draft: tours.filter((t) => t.status === "draft" && !t.archived).length,
      missing: tours.filter((t) => t.missing.length && !t.archived).length,
    },
    byCountry: countries.map((c) => ({
      country: c.slug,
      n: tours.filter((t) => t.country === c.slug).length,
    })),
  };
}
export async function adminPostgresJobs(p: Principal, page = 1) {
  authorize(p);
  return importDashboard(await postgresFor("asia_catalog_editor"), page);
}
