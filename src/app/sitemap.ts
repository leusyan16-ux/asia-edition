import type { MetadataRoute } from "next";
import { countries } from "@/lib/catalog";
import { indexingEnabled, publicOrigin } from "@/lib/site-config";
import { getTourRepository } from "@/features/tours/repository";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!indexingEnabled()) return [];
  const origin = publicOrigin(),
    paths = [
      "",
      "/tours",
      ...countries.flatMap((c) => [
        `/countries/${c.slug}`,
        ...c.destinations.map((d) => `/countries/${c.slug}/${d.slug}`),
      ]),
    ];
  const repo = getTourRepository();
  for (let page = 1; page <= 100; page++) {
    const result = await repo.list({
      locale: "ru",
      page,
      pageSize: 100,
      sort: "featured",
    });
    paths.push(
      ...result.items.filter((t) => !t.isDemo).map((t) => `/tours/${t.slug}`),
    );
    if (page * 100 >= result.total) break;
  }
  return paths.flatMap((path) =>
    ["ru", "en"].map((locale) => ({
      url: `${origin}/${locale}${path}`,
      alternates: {
        languages: { ru: `${origin}/ru${path}`, en: `${origin}/en${path}` },
      },
    })),
  );
}
