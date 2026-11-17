import { z } from "zod";
import { tourSchema } from "../tours/model";
import type { AdminSummary } from "./model";
export type OverviewPagination = {
  total: number;
  page: number;
  search: string;
  country: string;
  status: string;
};
const schema = z.object({
  search: z.string().max(120).default(""),
  country: tourSchema.shape.country.or(z.literal("")).default(""),
  status: z
    .enum(["", "draft", "published", "unavailable", "archived"])
    .default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export function overviewPage(tours: AdminSummary[], input: unknown) {
  const parsed = schema.safeParse(input),
    query = parsed.success ? parsed.data : schema.parse({});
  const filtered = tours.filter(
    (t) =>
      (!query.country || t.country === query.country) &&
      (!query.status ||
        (query.status === "archived"
          ? t.archived
          : !t.archived && t.status === query.status)) &&
      `${t.title.ru} ${t.title.en} ${t.slug}`
        .toLowerCase()
        .includes(query.search.toLowerCase()),
  );
  const page = Math.min(
    query.page,
    Math.max(1, Math.ceil(filtered.length / 25)),
  );
  return {
    items: filtered.slice((page - 1) * 25, page * 25),
    pagination: { ...query, page, total: filtered.length },
  };
}
