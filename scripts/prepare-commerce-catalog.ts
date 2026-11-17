import { isAllowedTour } from "../src/lib/geography";
import { readFile, writeFile } from "node:fs/promises";
import { snapshotSchema } from "../src/features/tours/static-catalog";
import { createHash } from "node:crypto";
async function main() {
  const [output] = process.argv.slice(2);
  if (!output) throw Error("Usage: prepare-commerce-catalog.ts OUTPUT.sql");
  const bytes = await readFile("src/features/tours/published-catalog.json");
  const snapshot = snapshotSchema.parse(JSON.parse(bytes.toString()));
  const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  const lines = [
    "-- Prepared locally from the explicitly approved public snapshot. Review and apply to STAGING only.",
    "begin;",
  ];
  const allowed = snapshot.records
    .filter(
      (r) =>
        !r.tour.isDemo &&
        r.tour.status === "published" &&
        isAllowedTour(r.tour) &&
        /^getyourguide-\d+$/.test(r.tour.slug),
    )
    .map((r) => quote(r.tour.slug));
  if (!allowed.length) throw Error("Refusing empty approved mirror");
  lines.push(
    "update public.commerce_products set requestable=false where provider='getyourguide' and slug not in (" +
      allowed.join(",") +
      ");",
  );
  for (const { tour } of snapshot.records) {
    if (tour.isDemo || tour.status !== "published" || !isAllowedTour(tour))
      continue;
    const location = snapshot.taxonomy.locations.find(
      (l) => l.slug === tour.location && l.country === tour.country,
    );
    const title = JSON.stringify(tour.title),
      destination = JSON.stringify(
        location?.name ?? { ru: tour.country, en: tour.country },
      );
    const id = tour.slug.match(/^getyourguide-(\d+)$/)?.[1];
    if (!id) continue;
    const digest = createHash("sha256")
      .update(JSON.stringify(tour))
      .digest("hex");
    lines.push(
      `insert into public.commerce_products(slug,provider,external_id,title,destination,requestable,source_digest) values(${quote(tour.slug)},'getyourguide',${quote(id)},${quote(title)}::jsonb,${quote(destination)}::jsonb,true,${quote(digest)}) on conflict(slug) do update set title=excluded.title,destination=excluded.destination,source_digest=excluded.source_digest;`,
    );
  }
  lines.push("commit;");
  await writeFile(output, lines.join("\n"), { flag: "wx" });
  console.log(
    "Prepared",
    lines.length - 4,
    "products; no connection or SQL execution.",
  );
}
void main();
