import {
  lstat,
  readFile,
  mkdir,
  writeFile,
  copyFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  GetYourGuideAdapter,
  parseGygInput,
  gygRowSchema,
  gygTitleTask,
} from "../src/features/admin/getyourguide-adapter";
import {
  LocalCommandTranslator,
  translationProposalSchema,
  type TranslationProposal,
} from "../src/features/admin/offline-translations";
import {
  prepareImport,
  commitExternalImport,
  previewDigest,
  IMPORT_BATCH_SIZE,
  digest,
} from "../src/features/admin/import-engine";
import {
  readLocalState,
  localDirectory,
} from "../src/features/admin/local-store";
import { localCategories } from "../src/features/admin/local-taxonomy";

async function main() {
  const [requested, output, commitFlag, translationCache] =
    process.argv.slice(2);
  if (!requested || !output || !["--commit", undefined].includes(commitFlag))
    throw Error(
      "Usage: node --import tsx scripts/import-getyourguide.ts INPUT.json|csv NEW_DATA_DIRECTORY [--commit]",
    );
  const root = await realpath("data"),
    dest = path.resolve(output);
  if (!dest.startsWith(root + path.sep))
    throw Error("Output must be under private data/");
  let parent = path.dirname(dest);
  while (true) {
    try {
      const r = await realpath(parent);
      if (r !== root && !r.startsWith(root + path.sep))
        throw Error("Output outside data/");
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      parent = path.dirname(parent);
    }
  }
  const jsonCandidate = requested.replace(/\.csv$/i, ".json");
  let source = requested;
  try {
    await lstat(jsonCandidate);
    source = jsonCandidate;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024)
    throw Error("Invalid/oversize source file");
  const bytes = await readFile(source),
    raw = bytes.toString("utf8"),
    format = /\.json$/i.test(source) ? "json" : "csv";
  const rows = parseGygInput(raw, format),
    sha = createHash("sha256").update(bytes).digest("hex");
  const preflight = new GetYourGuideAdapter().prepare(rows);
  if (!preflight.records.length)
    throw Error("No geographically eligible source rows; no store changed");
  await mkdir(path.dirname(dest), { recursive: true });
  await mkdir(dest);
  await copyFile(source, path.join(dest, `source.${format}`));
  const accepted = new Set(preflight.records.map((r) => r.external_product_id));
  const tasks = rows
    .map((r) => gygRowSchema.parse(r))
    .filter((r) => accepted.has(r.source_product_id))
    .map(gygTitleTask);
  let proposals: TranslationProposal[] = [],
    translationError: string | null = null;
  if (translationCache) {
    const cached = await lstat(translationCache);
    if (
      !cached.isFile() ||
      cached.isSymbolicLink() ||
      cached.size > 8 * 1024 * 1024
    )
      throw Error("Invalid translation cache");
    const rawCache = JSON.parse(await readFile(translationCache, "utf8"));
    if (!Array.isArray(rawCache))
      throw Error("Invalid translation cache array");
    proposals = rawCache.map((p) => translationProposalSchema.parse(p));
  }
  try {
    const config = JSON.parse(
      await readFile(
        "data/manual-klook-html/local-translator-config.json",
        "utf8",
      ),
    );
    const translator = new LocalCommandTranslator(
      config.localTranslation.executable,
      config.localTranslation.args,
    );
    const pending = tasks.filter(
      (t) =>
        !proposals.some(
          (p) => p.key === t.key && p.sourceHash === t.sourceHash,
        ),
    );
    for (let i = 0; i < pending.length; i += 20) {
      proposals.push(...(await translator.translate(pending.slice(i, i + 20))));
      console.log(
        `Local title translation: ${proposals.length}/${tasks.length}`,
      );
    }
  } catch (e) {
    translationError =
      e instanceof Error ? e.message : "Local translation unavailable";
  }
  proposals = proposals.map((p) => translationProposalSchema.parse(p));
  await writeFile(
    path.join(dest, "translations.json"),
    JSON.stringify(proposals, null, 2),
    { flag: "wx" },
  );
  const { records, excluded } = new GetYourGuideAdapter(proposals).prepare(
    rows,
  );
  const locations = [
    ...new Map(
      records
        .flatMap((r) => r.locations ?? [])
        .map((l) => [`${l.country}/${l.slug}`, l]),
    ).values(),
  ];
  const taxonomy = { locations, categories: localCategories, operators: [] };
  const content = JSON.stringify({ schema_version: 1, products: records });
  const revision = digest(
    records.map((r) => ({ ...r, last_synced_at: "" })),
  ).slice(0, 16);
  const preview = prepareImport(content, "json", taxonomy, []);
  const failures = preview.filter((r) => r.action === "error");
  if (failures.length) {
    await writeFile(
      path.join(dest, "validation-errors.json"),
      JSON.stringify(failures, null, 2),
    );
    throw Error(
      `Validation failed for ${failures.length} rows; no store changed`,
    );
  }
  await writeFile(path.join(dest, "products.json"), content, { flag: "wx" });
  await writeFile(
    path.join(dest, "excluded.json"),
    JSON.stringify(excluded, null, 2),
    { flag: "wx" },
  );
  const directory = localDirectory();
  const logs: unknown[] = [];
  let backup: string | null = null,
    stored = preview.map((r) => r.tour!);
  if (commitFlag === "--commit") {
    if (
      process.env.NODE_ENV !== "development" ||
      process.env.ADMIN_MODE !== "local"
    )
      throw Error("Commit requires explicit development/local mode");
    if (path.basename(directory) === "pilot-editorial-26")
      throw Error("Never import into protected editorial profile");
    await mkdir(directory, { recursive: true });
    const initial = await readLocalState(directory),
      unrelated = initial.tours.filter(
        (t) => t.externalProduct?.provider !== "getyourguide",
      );
    try {
      const previous = await readFile(path.join(directory, "tours.json"));
      backup = path.join(
        directory,
        `before-getyourguide-${Date.now()}.backup.json`,
      );
      await writeFile(backup, previous, { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    for (let offset = 0; offset < records.length; offset += IMPORT_BATCH_SIZE) {
      const state = await readLocalState(directory);
      const log = await commitExternalImport(
        {
          content,
          format: "json",
          offset,
          limit: IMPORT_BATCH_SIZE,
          batch_id: `gyg-${sha.slice(0, 12)}-${revision}-${offset}`,
          preview_digest: previewDigest(
            content,
            "json",
            state.tours,
            offset,
            IMPORT_BATCH_SIZE,
          ),
        },
        taxonomy,
        "getyourguide-file-import",
        directory,
      );
      if (log.status !== "committed")
        throw Error("Existing importer rejected packet; inspect local journal");
      logs.push(log);
    }
    const state = await readLocalState(directory);
    stored = state.tours.filter(
      (t) =>
        t.externalProduct?.provider === "getyourguide" &&
        accepted.has(t.externalProduct.external_product_id),
    );
    if (
      JSON.stringify(
        state.tours.filter(
          (t) => t.externalProduct?.provider !== "getyourguide",
        ),
      ) !== JSON.stringify(unrelated)
    )
      throw Error("Unexpected unrelated record change");
  }
  const repeat = prepareImport(content, "json", taxonomy, stored);
  const report = {
    source: path.resolve(source),
    usedCsvFallback: format === "csv",
    sourceSha256: sha,
    inputRows: rows.length,
    uniqueSourceIds: new Set(
      rows.map((r) => gygRowSchema.parse(r).source_product_id),
    ).size,
    eligible: records.length,
    excluded,
    imported: commitFlag ? stored.length : 0,
    store: commitFlag ? directory : null,
    backup,
    logs,
    draftCount: stored.filter((t) => t.status === "draft").length,
    publishedCount: stored.filter((t) => t.status === "published").length,
    readyForPublication: 0,
    countries: Object.fromEntries(
      [...new Set(stored.map((t) => t.country))].map((c) => [
        c,
        stored.filter((t) => t.country === c).length,
      ]),
    ),
    locations: locations.length,
    observedPrices: records.filter(
      (r) =>
        r.source_metadata?.original &&
        Boolean(
          (r.source_metadata.original as { display_price_text?: string })
            .display_price_text,
        ),
    ).length,
    observedRatings: records.filter(
      (r) =>
        r.source_metadata?.original &&
        Boolean(
          (r.source_metadata.original as { rating_text?: string }).rating_text,
        ),
    ).length,
    photoReferences: records.filter(
      (r) => (r.source_metadata?.image_references as unknown[])?.length,
    ).length,
    downloadedPhotos: 0,
    verifiedPrices: 0,
    translationProposals: proposals.length,
    translationError,
    russianFallbacks: records.filter((r) =>
      JSON.stringify(r.source_metadata?.translation).includes("missing"),
    ).length,
    repeatSkipped: repeat.filter((r) => r.action === "skip").length,
    publicationBlockers: [
      "Source rights_status=unverified; no image publication approval",
      "Editorial/translation and full route review pending",
      "Displayed prices lack verified package/traveler/date/validity basis",
      "No separate publication/geography/image approval",
    ],
    remoteOperations: 0,
    deployed: false,
  };
  await writeFile(
    path.join(dest, "report.json"),
    JSON.stringify(report, null, 2),
    { flag: "wx" },
  );
  await writeFile(
    path.join(dest, "admin-links.json"),
    JSON.stringify(
      stored.map((t) => ({
        id: t.id,
        sourceId: t.externalProduct?.external_product_id,
        title: t.title,
        edit: `/admin/tours/${t.id}`,
        preview: `/admin/tours/${t.id}/preview`,
      })),
      null,
      2,
    ),
    { flag: "wx" },
  );
  console.log(JSON.stringify(report, null, 2));
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
