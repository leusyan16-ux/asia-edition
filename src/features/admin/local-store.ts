import { isAllowedTour } from "@/lib/geography";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  rmdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  adminTourSchema,
  adminSummarySchema,
  missingInformation,
  type AdminTour,
} from "./model";
import { selectTours } from "../tours/query";
import type { TourQuery } from "../tours/model";
import { z } from "zod";
import { importLogSchema, type ImportLog } from "./external-model";
import { catalogJobSchema, type CatalogJob } from "./catalog-job-model";
export const localDirectory = () => {
  const root = path.join(process.cwd(), ".admin-local");
  const profile = process.env.ADMIN_LOCAL_DIRECTORY;
  if (!profile || profile === ".admin-local") return root;
  if (!/^\.admin-local[\\/][a-z0-9][a-z0-9_-]{0,63}$/i.test(profile))
    throw new Error(
      "Локальные данные должны находиться в отдельном профиле .admin-local",
    );
  return path.join(process.cwd(), ".admin-local", profile.split(/[\\/]/)[1]);
};

export type LocalState = {
  version: 2;
  tours: AdminTour[];
  imports: ImportLog[];
  catalogJobs?: CatalogJob[];
};
const snapshots = new Map<
  string,
  { version: string; promise: Promise<LocalState> }
>();
async function snapshot(directory: string): Promise<LocalState> {
  const file = path.join(directory, "tours.json");
  try {
    const info = await stat(file, { bigint: true });
    const version = `${info.mtimeNs}:${info.ctimeNs}:${info.size}:${info.ino}`;
    let entry = snapshots.get(file);
    if (!entry || entry.version !== version) {
      if (snapshots.size >= 2 && !snapshots.has(file))
        snapshots.delete(snapshots.keys().next().value!);
      entry = { version, promise: loadLocalState(directory) };
      snapshots.set(file, entry);
      entry.promise.catch(() => {
        if (snapshots.get(file) === entry) snapshots.delete(file);
      });
    }
    return await entry.promise;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      snapshots.delete(file);
      return { version: 2, tours: [], imports: [] };
    }
    throw e;
  }
}
export async function readLocalState(
  directory = localDirectory(),
): Promise<LocalState> {
  return structuredClone(await snapshot(directory));
}
export async function readLocalTourById(
  id: string,
  directory = localDirectory(),
) {
  const tour = (await snapshot(directory)).tours.find((t) => t.id === id);
  return tour ? structuredClone(tour) : null;
}
export async function readLocalSourceLocations(
  directory = localDirectory(),
  publishedOnly = false,
) {
  const locations = (await snapshot(directory)).tours
    .filter(
      (t) =>
        !publishedOnly ||
        (t.status === "published" && t.visible && !t.archived && isAllowedTour(t)),
    )
    .flatMap((t) => t.externalProduct?.locations || []);
  const unique = new Map(
    locations.map((l) => [JSON.stringify([l.country, l.slug]), l]),
  );
  return structuredClone([...unique.values()]);
}
export async function readLocalSummaries(directory = localDirectory()) {
  return (await snapshot(directory)).tours.map((t) =>
    adminSummarySchema.parse({ ...t, missing: missingInformation(t, []) }),
  );
}
export async function readLocalPublicPage(
  query: TourQuery,
  directory = localDirectory(),
  today = new Date().toISOString().slice(0, 10),
) {
  const tours = (await snapshot(directory)).tours
    .filter((t) => t.status === "published" && t.visible && !t.archived)
    .map((t) => ({
      ...t,
      prices: t.prices.filter(
        (p) =>
          p.verifiedAt &&
          (!p.validFrom || p.validFrom <= today) &&
          (!p.validUntil || p.validUntil >= today),
      ),
    }));
  const selected = selectTours(tours, query, false);
  return {
    total: selected.total,
    items: structuredClone(selected.items as AdminTour[]),
  };
}
export async function readLocalPublicBySlug(
  slug: string,
  directory = localDirectory(),
) {
  const tour = (await snapshot(directory)).tours.find(
    (t) =>
      t.slug === slug && t.status === "published" && t.visible && !t.archived && isAllowedTour(t),
  );
  return tour ? structuredClone(tour) : null;
}
async function loadLocalState(
  directory = localDirectory(),
): Promise<LocalState> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(directory, "tours.json"), "utf8"),
    );
    if (Array.isArray(raw))
      return {
        version: 2,
        tours: z.array(adminTourSchema).parse(raw),
        imports: [],
      };
    return z
      .object({
        version: z.literal(2),
        tours: z.array(adminTourSchema),
        imports: z.array(importLogSchema),
        catalogJobs: z.array(catalogJobSchema).default([]),
      })
      .parse(raw);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 2, tours: [], imports: [] };
    throw e;
  }
}
export async function readLocalTours(directory = localDirectory()) {
  return (await readLocalState(directory)).tours;
}
export async function updateLocalState<T>(
  mutate: (state: LocalState) => { state: LocalState; value: T },
  directory = localDirectory(),
): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, "write.lock");
  try {
    await mkdir(lock);
  } catch {
    throw new Error("Данные сейчас сохраняются. Повторите попытку");
  }
  const temp = path.join(directory, randomUUID() + ".tmp");
  try {
    const { state, value } = mutate(await readLocalState(directory));
    const slugs = new Set<string>(),
      ids = new Set<string>(),
      keys = new Set<string>();
    state.tours = state.tours.map((t) => adminTourSchema.parse(t));
    for (const t of state.tours) {
      if (ids.has(t.id) || slugs.has(t.slug))
        throw new Error("Повтор ID или адреса: " + t.slug);
      ids.add(t.id);
      slugs.add(t.slug);
      if (t.externalProduct) {
        const key = JSON.stringify([
          t.externalProduct.provider,
          t.externalProduct.external_product_id,
        ]);
        if (keys.has(key)) throw new Error("Повтор внешнего продукта");
        keys.add(key);
      }
    }
    state.imports = z.array(importLogSchema).parse(state.imports);
    if (state.catalogJobs)
      state.catalogJobs = z.array(catalogJobSchema).parse(state.catalogJobs);
    await writeFile(temp, JSON.stringify(state, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temp, path.join(directory, "tours.json"));
    // The transaction has already validated this snapshot. Reuse it rather than
    // parsing and validating the same large file again on the next packet.
    const file = path.join(directory, "tours.json");
    const info = await stat(file, { bigint: true });
    if (snapshots.size >= 2 && !snapshots.has(file))
      snapshots.delete(snapshots.keys().next().value!);
    snapshots.set(file, {
      version: `${info.mtimeNs}:${info.ctimeNs}:${info.size}:${info.ino}`,
      promise: Promise.resolve(structuredClone(state)),
    });
    return value;
  } finally {
    await unlink(temp).catch(() => {});
    await rmdir(lock);
  }
}
export async function saveLocalBatch(
  batch: AdminTour[],
  expected: Record<string, string>,
  directory = localDirectory(),
): Promise<AdminTour[]> {
  return updateLocalState((state) => {
    const merged = new Map(state.tours.map((t) => [t.id, t]));
    const saved: AdminTour[] = [];
    for (const t of batch) {
      const prior = merged.get(t.id);
      if (prior && expected[t.id] !== prior.updatedAt)
        throw new Error(
          "Экскурсия изменена другим администратором. Обновите страницу",
        );
      if (!prior && expected[t.id])
        throw new Error("Экскурсия больше не существует");
      if (
        JSON.stringify(t.externalProduct ?? null) !==
        JSON.stringify(prior?.externalProduct ?? null)
      )
        throw new Error("Данные источника меняются только через импорт");
      if (
        prior?.slots.some(
          (s) =>
            s.reserved > 0 &&
            !t.slots.some(
              (n) =>
                n.date === s.date &&
                n.time === s.time &&
                n.reserved === s.reserved,
            ),
        )
      )
        throw new Error("Нельзя удалить дату с занятыми местами");
      if (
        t.slots.some(
          (s) =>
            s.reserved !==
            (prior?.slots.find((n) => n.date === s.date && n.time === s.time)
              ?.reserved ?? 0),
        )
      )
        throw new Error("Число занятых мест нельзя изменять");
      const next = adminTourSchema.parse({
        ...t,
        updatedAt: new Date(
          Math.max(
            Date.now(),
            prior ? new Date(prior.updatedAt).getTime() + 1 : 0,
          ),
        ).toISOString(),
      });
      merged.set(next.id, next);
      saved.push(next);
    }
    return { state: { ...state, tours: [...merged.values()] }, value: saved };
  }, directory);
}
