import { readFile, stat, writeFile } from "node:fs/promises";
import {
  prepareImport,
  MAX_IMPORT_BYTES,
} from "../src/features/admin/import-engine";
import { countries } from "../src/lib/catalog";
import { localCategories } from "../src/features/admin/local-taxonomy";

async function main() {
  const [source, output] = process.argv.slice(2);
  if (!source || !output || !/\.(csv|json)$/i.test(source))
    throw Error(
      "Usage: node --import tsx scripts/prepare-public-feed.ts normalized.csv|json NEW_PRIVATE_OUTPUT.json",
    );
  if ((await stat(source)).size > MAX_IMPORT_BYTES)
    throw Error(
      "Feed exceeds existing importer limit (8 MiB); split with the existing batch pipeline",
    );
  const taxonomy = {
    locations: countries.flatMap((c) =>
      c.destinations.map((d) => ({
        slug: d.slug,
        country: c.slug,
        name: d.name,
      })),
    ),
    categories: localCategories,
    operators: [],
  };
  const rows = prepareImport(
    await readFile(source, "utf8"),
    /\.csv$/i.test(source) ? "csv" : "json",
    taxonomy,
    [],
    false,
  );
  const errors = rows.filter((r) => r.action === "error");
  console.log(
    JSON.stringify(
      {
        total: rows.length,
        errors: errors.map((r) => ({ row: r.row, errors: r.errors })),
      },
      null,
      2,
    ),
  );
  if (errors.length || !rows.length)
    throw Error("Feed validation failed; no output written");
  const tours = rows.map((r) => r.tour!);
  const locations = [...taxonomy.locations];
  for (const tour of tours)
    for (const location of tour.externalProduct?.locations ?? [])
      if (
        !locations.some(
          (l) => l.country === location.country && l.slug === location.slug,
        )
      )
        locations.push(location);
  await writeFile(
    output,
    JSON.stringify({ tours, taxonomy: { ...taxonomy, locations } }),
    { flag: "wx" },
  );
  console.log(
    `${tours.length} draft candidates written to explicit output; active catalogs unchanged. Reimports/updates must use the existing checkpoint importer, not this initial staging command.`,
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
