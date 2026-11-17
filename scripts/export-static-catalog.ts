import { readFile, writeFile, access, stat } from "node:fs/promises";
import path from "node:path";
import {
  compileStaticCatalog,
  publicationDigest,
  compileInformationCatalog,
  approvedSourceImage,
} from "../src/features/tours/static-catalog";

// Reads only explicitly supplied exports. Never opens .env or active local stores.
async function main() {
  const [inputPath, reviewPath, outputPath, mode] = process.argv.slice(2);
  if (mode && mode !== "--information") throw Error("Unknown export mode");
  if (!inputPath || !reviewPath || !outputPath)
    throw Error(
      "Usage: node --import tsx scripts/export-static-catalog.ts INPUT.json REVIEWS.json OUTPUT.json (use REVIEWS=- for digests only)",
    );
  if ((await stat(inputPath)).size > 64 * 1024 * 1024)
    throw Error("Export exceeds 64 MiB; use the existing batch importer first");
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  if (!Array.isArray(input.tours) || input.tours.length > 10000)
    throw Error(
      "Expected { tours: [...], taxonomy: {...} }, at most 10000 documents",
    );
  if (reviewPath === "-") {
    await writeFile(
      outputPath,
      JSON.stringify(
        input.tours.map((t: unknown) => ({
          digest: publicationDigest(t),
          publicationApproved: false,
          imagesApproved: false,
          geographyApproved: false,
        })),
        null,
        2,
      ),
      { flag: "wx" },
    );
    console.log(
      "Review worksheet written. No publication approval was granted.",
    );
  } else {
    const result = (mode === "--information" ? compileInformationCatalog : compileStaticCatalog)(
      input.tours,
      JSON.parse(await readFile(reviewPath, "utf8")),
      input.taxonomy,
    );
    console.log(
      JSON.stringify(
        { ready: result.snapshot.records.length, rejected: result.rejected },
        null,
        2,
      ),
    );
    if (result.rejected.length || !result.snapshot.records.length)
      throw Error(
        "Export blocked: fix rejected records; previous snapshot is unchanged",
      );
    for (const record of result.snapshot.records)
      for (const image of record.tour.images) {
        if (mode === "--information" && approvedSourceImage(image.url)) continue;
        await access(path.join(process.cwd(), "public", image.url));
      }
    // Explicit output, no implicit overwrite of the deployed snapshot.
    await writeFile(outputPath, JSON.stringify(result.snapshot), {
      flag: "wx",
    });
    console.log(
      "Sanitized snapshot written; no local records changed and no deployment performed.",
    );
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
