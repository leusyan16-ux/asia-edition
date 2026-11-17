import { randomUUID } from "node:crypto";
import type { Database, SQL } from "./postgres-worker";
import {
  adminTourSchema,
  adminSummarySchema,
  missingInformation,
  type AdminTour,
  type AdminTaxonomy,
} from "../admin/model";
import { localTourPayload } from "../tours/local-catalog";
import type { TourQuery, TourRepository } from "../tours/model";
import { querySchema } from "../tours/query";
import { countries, adminCountries } from "../../lib/catalog";
import { localCategories } from "../admin/local-taxonomy";
import { digest } from "../admin/import-engine";
import { z } from "zod";
import { isAllowedCountry, isAllowedTour, southeastAsianCountries } from "../../lib/geography";

// Applied before COUNT/LIMIT so region filtering preserves pagination. This is
// an application predicate; no existing database schema or RLS is modified.
const publicRegionSQL = `country in (${southeastAsianCountries.map((c) => `'${c}'`).join(",")})
 and document::text !~* '(russia|росси|москов|moscow|petersburg|петербург|vladivostok|владивосток|sochi|сочи|kaliningrad|калининград)'
 and not exists (select 1 from jsonb_array_elements_text(coalesce(document->'routeCountries','[]'::jsonb)) c where c not in (${southeastAsianCountries.map((c) => `'${c}'`).join(",")}))`;

export async function projectionTaxonomy(
  db: SQL,
  publicOnly = false,
): Promise<AdminTaxonomy> {
  const extra = await db.query<{
    location: AdminTaxonomy["locations"][number];
  }>(
    `select distinct l as location from catalog_projection.documents d cross join lateral jsonb_array_elements(source_locations) l ${publicOnly ? "where public_visible" : ""}`,
  );
  const locations = [
    ...(publicOnly ? countries : adminCountries).flatMap((c) =>
      c.destinations.map((d) => ({
        slug: d.slug,
        country: c.slug,
        name: d.name,
        kind: "destination" as const,
        parent: null,
      })),
    ),
    ...extra.rows.map((r) => r.location),
  ];
  return {
    locations: locations.filter(
      (l, i, a) =>
        (!publicOnly || isAllowedCountry(l.country)) && a.findIndex((o) => o.slug === l.slug && o.country === l.country) === i,
    ),
    categories: localCategories,
    operators: publicOnly
      ? []
      : (
          await db.query<{
            id: string;
            name: string;
            verifiedAt: string | null;
          }>(
            'select id,name,verified_at as "verifiedAt" from public.operators order by name,id',
          )
        ).rows,
  };
}
export function projectionRepository(db: SQL): TourRepository {
  return {
    taxonomy: () => projectionTaxonomy(db, true),
    async bySlug(slug) {
      const r = await db.query<{ document: unknown }>(
        `select document from catalog_projection.documents where public_visible and ${publicRegionSQL} and slug=$1`,
        [slug],
      );
      return r.rows[0] && isAllowedTour(r.rows[0].document)
        ? localTourPayload(adminTourSchema.parse(r.rows[0].document))
        : null;
    },
    async list(input: TourQuery) {
      const q = querySchema.parse(input),
        limit = Math.max(1, Math.min(100, input.pageSize));
      const params: unknown[] = [];
      const bind = (v: unknown) => {
        params.push(v);
        return "$" + params.length;
      };
      const where = ["public_visible", publicRegionSQL];
      for (const key of ["country", "location", "category"] as const)
        if (q[key]) where.push(`${key}=${bind(q[key])}`);
      if (q.search?.trim())
        where.push(
          `position(${bind(q.search.trim().toLowerCase())} in search_text)>0`,
        );
      const currency = bind(q.currency),
        today = bind(new Date().toISOString().slice(0, 10));
      const price = `(select (p->>'adult')::numeric from jsonb_array_elements(price_snapshot) p where p->>'currency'=${currency} and nullif(p->>'verifiedAt','') is not null and (p->>'validFrom' is null or p->>'validFrom'<=${today}) and (p->>'validUntil' is null or p->>'validUntil'>=${today}) limit 1)`;
      const duration = "duration_minutes";
      if (q.minPrice !== undefined) where.push(`${price}>=${bind(q.minPrice)}`);
      if (q.maxPrice !== undefined) where.push(`${price}<=${bind(q.maxPrice)}`);
      if (q.duration)
        where.push(
          {
            short: `${duration}<180`,
            half: `${duration}>=180 and ${duration}<360`,
            full: `${duration}>=360 and ${duration}<=720`,
            multi: `${duration}>720`,
          }[q.duration],
        );
      const order =
        q.sort === "price-asc"
          ? `price asc nulls last,slug`
          : q.sort === "price-desc"
            ? `price desc nulls last,slug`
            : q.sort === "duration"
              ? `${duration} asc nulls last,slug`
              : 'featured desc,slug collate "C"';
      // Use price in base SELECT so parameters exist even without price filtering/sorting.
      const base = `select document,slug,featured,duration_minutes,${price} as price from catalog_projection.documents where ${where.join(" and ")}`;
      const total = (
        await db.query<{ n: number }>(
          `select count(*)::int n from (${base}) t`,
          params,
        )
      ).rows[0].n;
      const data = await db.query<{ document: unknown }>(
        `select document from (${base}) t order by ${order} limit ${limit} offset ${(q.page - 1) * limit}`,
        params,
      );
      return {
        items: data.rows.map((r) => {
          if (!isAllowedTour(r.document)) throw new Error("Route requires geography review");
          return localTourPayload(adminTourSchema.parse(r.document));
        }),
        total,
      };
    },
  };
}
export async function projectionById(db: SQL, id: string) {
  const rows = await db.query<{ document: unknown }>(
    "select document from catalog_projection.documents where id=$1",
    [id],
  );
  return rows.rows[0] ? adminTourSchema.parse(rows.rows[0].document) : null;
}
export async function saveProjection(
  db: Database,
  tours: AdminTour[],
  expected: Record<string, string>,
  actor: string,
) {
  if (
    !tours.length ||
    tours.length > 1000 ||
    new Set(tours.map((t) => t.id)).size !== tours.length
  )
    throw new Error("Invalid batch");
  return db.transaction(async (tx) => {
    const result: AdminTour[] = [];
    for (const t of [...tours].sort((a, b) => a.id.localeCompare(b.id))) {
      const prior = (
        await tx.query<{ document: AdminTour }>(
          "select document from catalog_projection.documents where id=$1 for update",
          [t.id],
        )
      ).rows[0]?.document;
      if (prior ? expected[t.id] !== prior.updatedAt : !!expected[t.id])
        throw new Error("Данные изменились. Обновите страницу");
      if (digest(t.externalProduct) !== digest(prior?.externalProduct ?? null))
        throw new Error("Данные источника доступны только для чтения");
      const saved = adminTourSchema.parse({
        ...t,
        updatedAt: new Date(
          Math.max(Date.now(), prior ? Date.parse(prior.updatedAt) + 1 : 0),
        ).toISOString(),
      });
      await tx.query(
        prior
          ? "update catalog_projection.documents set document=$2::jsonb,missing=$3::jsonb,revision=revision+1 where id=$1"
          : "insert into catalog_projection.documents(id,document,missing) values($1,$2::jsonb,$3::jsonb)",
        [
          t.id,
          JSON.stringify(saved),
          JSON.stringify(missingInformation(saved)),
        ],
      );
      await tx.query(
        "insert into catalog_projection.audit(product_id,actor,event) values($1,$2,'editor_save')",
        [t.id, actor],
      );
      result.push(saved);
    }
    return result;
  });
}
const adminQuery = z.object({
  search: z.string().max(120).default(""),
  country: z.string().max(80).default(""),
  status: z
    .enum(["", "draft", "published", "unavailable", "archived"])
    .default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export async function projectionOverview(db: SQL, input: unknown) {
  const parsed = adminQuery.safeParse(input),
    q = parsed.success ? parsed.data : adminQuery.parse({});
  const params: unknown[] = [q.country, q.status, q.search.toLowerCase()];
  const condition =
    "($1='' or country=$1) and ($2='' or ($2='archived' and archived) or ($2<>'archived' and not archived and status=$2)) and ($3='' or position($3 in admin_search)>0)";
  const total = (
    await db.query<{ n: number }>(
      `select count(*)::int n from catalog_projection.documents where ${condition}`,
      params,
    )
  ).rows[0].n;
  const page = Math.min(q.page, Math.max(1, Math.ceil(total / 25)));
  const rows = await db.query<{ summary: unknown }>(
    `select jsonb_build_object('id',id,'slug',slug,'country',country,'status',status,'archived',document->'archived','visible',document->'visible','featured',document->'featured','isDemo',document->'isDemo','title',document->'title','updatedAt',document->'updatedAt','missing',missing) summary from catalog_projection.documents where ${condition} order by id limit 25 offset ${(page - 1) * 25}`,
    params,
  );
  const stats = (
    await db.query<{
      total: number;
      published: number;
      draft: number;
      missing: number;
    }>(
      "select count(*)::int total,count(*) filter(where status='published' and not archived)::int published,count(*) filter(where status='draft' and not archived)::int draft,count(*) filter(where jsonb_array_length(missing)>0 and not archived)::int missing from catalog_projection.documents",
    )
  ).rows[0];
  const byCountry = (
    await db.query<{ country: string; n: number }>(
      "select country,count(*)::int n from catalog_projection.documents group by country",
    )
  ).rows;
  return {
    items: rows.rows.map((r) => adminSummarySchema.parse(r.summary)),
    pagination: { ...q, page, total },
    stats,
    byCountry,
  };
}
export async function importDashboard(db: SQL, page = 1) {
  page = Number.isFinite(page)
    ? Math.max(1, Math.min(10000, Math.floor(page)))
    : 1;
  const offset = (Math.max(1, Math.min(10000, page)) - 1) * 25;
  const jobs = await db.query<Record<string, unknown>>(
    `select id,provider,state,cursor,parts,attempts,last_error,created_at,finished_at from catalog_ingest.jobs order by created_at desc,id limit 25 offset ${offset}`,
  );
  const events = await db.query<Record<string, unknown>>(
    `select id,job_id,at,cursor,event,details from catalog_ingest.events order by id desc limit 50 offset ${offset * 2}`,
  );
  return { jobs: jobs.rows, events: events.rows, page };
}
export function newWorkerOwner() {
  return `worker-${process.pid}-${randomUUID()}`;
}
