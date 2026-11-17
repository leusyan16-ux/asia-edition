import {
  readdir,
  lstat,
  readFile,
  mkdir,
  writeFile,
  appendFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { performance } from "node:perf_hooks";
import { KlookAdapter } from "./klook-adapter";
import {
  parseKlookSavedHtml,
  MAX_SAVED_HTML_BYTES,
  type SavedPageMapping,
} from "./klook-offline-html";
import {
  prepareImport,
  summary,
  MAX_IMPORT_BYTES,
  IMPORT_BATCH_SIZE,
  type ExternalImportRecord,
} from "./import-engine";
import { localCategories } from "./local-taxonomy";
import {
  translationTasks,
  reviewedDraftMapping,
  type OfflineTranslator,
  type TranslationProposal,
} from "./offline-translations";

export async function discoverSavedHtml(
  directory: string,
  prefix = "",
  depth = 0,
): Promise<string[]> {
  if (depth > 6) throw Error("Input directory depth exceeds 6");
  const result: string[] = [];
  for (const entry of (
    await readdir(path.join(directory, prefix), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && !/_files$/i.test(entry.name))
      result.push(...(await discoverSavedHtml(directory, name, depth + 1)));
    else if (entry.isFile() && /\.html?$/i.test(entry.name)) result.push(name);
    if (result.length > 5000)
      throw Error("At most 5000 saved product HTML files per run");
  }
  return result;
}

async function auditPhotos(
  filename: string,
  inputRoot: string,
  result: ReturnType<typeof parseKlookSavedHtml>,
) {
  const local = result.observation.imageCandidates.filter((i) =>
    i.origin.endsWith(":local-saved-reference"),
  );
  const images: {
    reference: string;
    status: string;
    width?: number;
    height?: number;
    format?: string;
  }[] = [];
  for (const image of local) {
    try {
      const value = decodeURIComponent(image.reference.split(/[?#]/)[0]);
      const resolved = await realpath(
        path.resolve(path.dirname(filename), value),
      );
      if (!resolved.startsWith(inputRoot + path.sep))
        throw Error("outside-input");
      const info = await lstat(resolved);
      if (!info.isFile() || info.size > 20 * 1024 * 1024)
        throw Error("invalid-size-or-type");
      const bytes = await readFile(resolved);
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const png = bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const webp =
        bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP";
      const avif =
        bytes.subarray(4, 8).toString("ascii") === "ftyp" &&
        /avif|avis/.test(bytes.subarray(8, 32).toString("ascii"));
      if (!jpeg && !png && !webp && !avif)
        throw Error("unsupported-image-magic");
      const metadata = await sharp(bytes, {
        limitInputPixels: 40000000,
      }).metadata();
      const { width = 0, height = 0, format } = metadata;
      if (!["jpeg", "png", "webp", "avif"].includes(format || ""))
        throw Error("unsupported-image");
      images.push({
        reference: image.reference,
        status:
          width >= 440 && height >= 270
            ? "large-candidate-needs-review"
            : "small-or-ui",
        width,
        height,
        format,
      });
    } catch {
      images.push({
        reference: image.reference,
        status: "missing-invalid-or-outside-input",
      });
    }
  }
  return {
    localReferences: local.length,
    existingDecodable: images.filter((i) => i.width).length,
    largeCandidates: images.filter(
      (i) => i.status === "large-candidate-needs-review",
    ).length,
    missingOrInvalid: images.filter(
      (i) => i.status === "missing-invalid-or-outside-input",
    ).length,
    remoteReferencesNotFetched:
      result.observation.imageCandidates.length - local.length,
    visualApproval: false,
    rightsApproval: false,
    images,
  };
}

export type OfflineBatchOptions = {
  dataset?: "real" | "synthetic";
  translator?: OfflineTranslator;
  proposals?: TranslationProposal[];
};
export async function runSavedHtmlBatch(
  input: string,
  output: string,
  manifest: Record<string, SavedPageMapping> = {},
  options: OfflineBatchOptions = {},
) {
  const started = performance.now(),
    inputRoot = await realpath(input),
    destination = path.resolve(output),
    dataRoot = await realpath("data");
  if (
    !inputRoot.startsWith(dataRoot + path.sep) ||
    !destination.startsWith(dataRoot + path.sep) ||
    destination === inputRoot ||
    destination.startsWith(inputRoot + path.sep)
  )
    throw Error("Use separate input/output directories inside private data/");
  // Resolve every existing output ancestor: a junction must not escape the private data root.
  let ancestor = path.dirname(destination);
  while (true) {
    try {
      const actual = await realpath(ancestor);
      if (actual !== dataRoot && !actual.startsWith(dataRoot + path.sep))
        throw Error("Output ancestor outside data/");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  try {
    await lstat(destination);
    throw Error("Output already exists; choose a new directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const files = await discoverSavedHtml(inputRoot);
  if (!files.length) throw Error("No saved HTML files found");
  await mkdir(destination, { recursive: true });
  const capturedAt = new Date().toISOString(),
    seen = new Map<string, { file: string; hash: string }>();
  const failures: { file: string; error: string }[] = [],
    validation: { file: string; errors: string[] }[] = [];
  const batches: { file: string; products: number; repeatSkipped: number }[] =
    [];
  const geography = new Map<string, string>();
  const countryCounts: Record<string, number> = {};
  let pending: ExternalImportRecord[] = [],
    candidates = 0,
    duplicateFiles = 0,
    taskCount = 0,
    proposalCount = 0,
    peakRss = process.memoryUsage().rss;
  const flush = async () => {
    if (!pending.length) return;
    const name = batches.length
      ? `products-${String(batches.length + 1).padStart(3, "0")}.json`
      : "products.json";
    const content = JSON.stringify({ schema_version: 1, products: pending });
    const taxonomy = {
      locations: pending
        .flatMap((r) => r.locations || [])
        .filter(
          (l, i, a) =>
            a.findIndex((o) => o.country === l.country && o.slug === l.slug) ===
            i,
        ),
      categories: localCategories,
      operators: [],
    };
    const rows = prepareImport(
      content,
      "json",
      taxonomy,
      [],
      options.dataset === "synthetic",
    );
    const accepted = pending.filter((_, i) => rows[i].action === "create");
    if (accepted.length !== pending.length)
      throw Error(
        "Unexpected cross-product taxonomy conflict; batch output stopped for review",
      );
    const replay = summary(
      prepareImport(
        content,
        "json",
        taxonomy,
        rows.map((r) => r.tour!),
        options.dataset === "synthetic",
      ),
    );
    await writeFile(path.join(destination, name), content, { flag: "wx" });
    batches.push({
      file: name,
      products: accepted.length,
      repeatSkipped: replay.skipped,
    });
    pending = [];
  };
  for (const file of files) {
    try {
      const filename = path.join(inputRoot, file),
        info = await lstat(filename);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > MAX_SAVED_HTML_BYTES
      )
        throw Error("Not a regular file or exceeds 16 MiB");
      const bytes = await readFile(filename);
      if (bytes.includes(0))
        throw Error("Save HTML as UTF-8, not binary/UTF-16");
      const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const mapping =
        manifest[file.replaceAll(path.sep, "/")] || manifest[file] || {};
      let result = parseKlookSavedHtml(html, mapping, capturedAt);
      if (
        options.dataset !== "synthetic" &&
        /TEST[ _-]*ONLY|SYNTHETIC|СИНТЕТИЧ|ТЕСТОВ(?:АЯ|ЫЙ|ЫЕ)/i.test(
          result.observation.title,
        )
      )
        throw Error(
          "Synthetic-labelled input is forbidden in the real dataset",
        );
      const initial = result.observation,
        previous = seen.get(initial.external_product_id);
      if (previous) {
        duplicateFiles++;
        const error = `Duplicate product ID; first source: ${previous.file}`;
        failures.push({ file, error });
        await appendFile(
          path.join(destination, "quality.jsonl"),
          JSON.stringify({
            file,
            productId: initial.external_product_id,
            dataset: options.dataset || "real",
            duplicate:
              previous.hash === initial.html_sha256
                ? "exact-html"
                : "source-variant-needs-review",
            duplicateOf: previous.file,
            status: "held",
            readyForPublication: false,
          }) + "\n",
        );
        continue;
      }
      seen.set(initial.external_product_id, {
        file,
        hash: initial.html_sha256,
      });
      const tasks = translationTasks(initial).filter((t) => {
        if (t.field === "title" || t.field === "description")
          return !mapping[t.field]?.[t.to];
        const pkg = /^package:(\d+):(title|description)$/.exec(t.field);
        return (
          !pkg ||
          !mapping.packageTranslations?.[pkg[1]]?.[
            pkg[2] as "title" | "description"
          ]?.[t.to]
        );
      });
      taskCount += tasks.length;
      const proposals = [...(options.proposals || [])];
      const translationErrors: string[] = [];
      if (options.translator) {
        const uncached = tasks.filter(
          (t) =>
            !proposals.some(
              (p) => p.key === t.key && p.sourceHash === t.sourceHash,
            ),
        );
        for (let i = 0; i < uncached.length;) {
          const group = [];
          let size = 0;
          while (
            i < uncached.length &&
            group.length < 20 &&
            size + JSON.stringify(uncached[i]).length < 90000
          ) {
            size += JSON.stringify(uncached[i]).length;
            group.push(uncached[i++]);
          }
          if (!group.length) {
            i++;
            translationErrors.push("Oversize translation task held");
            continue;
          }
          try {
            proposals.push(...(await options.translator.translate(group)));
          } catch (error) {
            translationErrors.push(
              error instanceof Error ? error.message : "Translation failed",
            );
          }
        }
      }
      const translations = reviewedDraftMapping(mapping, tasks, proposals);
      proposalCount += translations.accepted.length;
      if (translations.accepted.length)
        result = parseKlookSavedHtml(html, translations.mapping, capturedAt);
      const photos = await auditPhotos(filename, inputRoot, result);
      let record = result.record;
      let packageJson:
        | ReturnType<KlookAdapter["normalizeSavedPackages"]>["observation"]
        | null = null;
      const sidecar = path.join(
        path.dirname(filename),
        `klook-${initial.external_product_id}-packages.json`,
      );
      try {
        const packageInfo = await lstat(sidecar);
        if (
          !packageInfo.isFile() ||
          packageInfo.isSymbolicLink() ||
          packageInfo.size > MAX_IMPORT_BYTES
        )
          throw Error("Invalid/oversize package JSON sidecar");
        if (!record) throw Error("Package JSON requires a mapped HTML draft");
        const payload = JSON.parse(
          (await readFile(sidecar, "utf8")).replace(/^\uFEFF/, ""),
        );
        const merged = new KlookAdapter().normalizeSavedPackages(
          payload,
          record,
          capturedAt,
          initial.locale || "en",
        );
        record = merged.record;
        packageJson = merged.observation;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (record && options.dataset === "synthetic")
        record = { ...record, provider: "test_fixture", test_data: true };
      let recordErrors: string[] = [];
      if (record) {
        const row = prepareImport(
          JSON.stringify({ schema_version: 1, products: [record] }),
          "json",
          {
            locations: record.locations || [],
            categories: localCategories,
            operators: [],
          },
          [],
          options.dataset === "synthetic",
        )[0];
        recordErrors = row.errors;
        if (row.action === "error") {
          validation.push({ file, errors: row.errors });
          record = null;
        }
      }
      if (record) {
        for (const location of record.locations || []) {
          const key = `${location.country}/${location.slug}`;
          const signature = JSON.stringify([
            location.name,
            location.kind,
            location.parent || null,
          ]);
          if (geography.has(key) && geography.get(key) !== signature)
            recordErrors.push(`Conflicting localized city mapping: ${key}`);
        }
        if (recordErrors.length) {
          validation.push({ file, errors: recordErrors });
          record = null;
        }
      }
      if (record) {
        for (const location of record.locations || [])
          geography.set(
            `${location.country}/${location.slug}`,
            JSON.stringify([
              location.name,
              location.kind,
              location.parent || null,
            ]),
          );
        const size = Buffer.byteLength(
          JSON.stringify({ schema_version: 1, products: [...pending, record] }),
        );
        if (size > MAX_IMPORT_BYTES && pending.length) await flush();
        if (
          Buffer.byteLength(
            JSON.stringify({ schema_version: 1, products: [record] }),
          ) > MAX_IMPORT_BYTES
        ) {
          recordErrors = ["Product exceeds importer byte limit"];
          record = null;
        } else {
          pending.push(record);
          const country = String(record.product.country);
          countryCounts[country] = (countryCounts[country] || 0) + 1;
          candidates++;
          if (pending.length >= IMPORT_BATCH_SIZE) await flush();
        }
      }
      const fields = {
        id: Boolean(initial.external_product_id),
        title: Boolean(initial.title),
        description: Boolean(initial.description),
        country: Boolean(initial.normalized.country),
        city: Boolean(initial.normalized.location),
        category: Boolean(initial.normalized.category),
        duration: Boolean(initial.duration),
        packages: initial.packageCards.length > 0,
        prices:
          initial.packageCards.some((p) => p.priceText) ||
          initial.offers.some(
            (o) =>
              o.price !== null || o.lowPrice !== null || o.highPrice !== null,
          ) ||
          Boolean(initial.metadataPrice.amount) ||
          initial.visiblePrices.length > 0,
        photos: photos.largeCandidates > 0,
        currency:
          Boolean(initial.metadataPrice.currency) ||
          initial.packageCards.some((p) => p.currency) ||
          initial.offers.some((o) => o.currency),
        source: Boolean(initial.source_url),
        bilingualText: !result.observation.missing.some((m) =>
          /Russian|English/.test(m),
        ),
      };
      await appendFile(
        path.join(destination, "observations.jsonl"),
        JSON.stringify({
          file,
          file_mtime: info.mtime.toISOString(),
          ...result.observation,
          packageJson,
        }) + "\n",
      );
      await appendFile(
        path.join(destination, "translation-tasks.jsonl"),
        JSON.stringify({
          file,
          productId: initial.external_product_id,
          tasks,
          proposals: translations.accepted,
          rejected: translations.rejected,
          errors: translationErrors,
          reviewStatus: "needs_review",
          configured: Boolean(options.translator),
          engine: options.translator?.name || null,
        }) + "\n",
      );
      await appendFile(
        path.join(destination, "quality.jsonl"),
        JSON.stringify({
          file,
          productId: initial.external_product_id,
          dataset: options.dataset || "real",
          duplicate: false,
          sourceSha256: initial.html_sha256,
          packageJson: packageJson
            ? {
                packages: packageJson.package_count,
                detailedPackage: packageJson.detailed_package_id,
                currency: packageJson.currency,
                comparison: packageJson.comparison,
                verifiedPrices: 0,
              }
            : null,
          fields,
          completeness: {
            present: Object.values(fields).filter(Boolean).length,
            total: Object.keys(fields).length,
          },
          geography: initial.normalized,
          photos,
          packages: {
            total: initial.packageCards.length,
            withIds: initial.packageCards.filter((p) => p.external_package_id)
              .length,
            priceVerified: 0,
            missingRuTitles: initial.packageCards.filter(
              (p) =>
                !(initial.locale === "ru"
                  ? p.name
                  : translations.mapping.packageTranslations?.[
                      p.external_package_id
                    ]?.title?.ru),
            ).length,
            missingEnTitles: initial.packageCards.filter(
              (p) =>
                !(initial.locale === "en"
                  ? p.name
                  : translations.mapping.packageTranslations?.[
                      p.external_package_id
                    ]?.title?.en),
            ).length,
          },
          prices: {
            verified: false,
            requires: [
              "package/person/date mapping",
              "conditions",
              "freshness",
            ],
          },
          translations: {
            tasks: tasks.length,
            proposed: translations.accepted.length,
            pending: tasks.length - translations.accepted.length,
            rejected: translations.rejected,
            reviewStatus: "needs_review",
            errors: translationErrors,
          },
          missing: result.observation.missing,
          validationErrors: recordErrors,
          status: record ? "draft-candidate" : "held",
          editorialStatus: "pending",
          rightsStatus: "unknown",
          publicationReadiness: "blocked",
          readyForPublication: false,
        }) + "\n",
      );
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid file";
      failures.push({ file, error: message });
      await appendFile(
        path.join(destination, "quality.jsonl"),
        JSON.stringify({
          file,
          dataset: options.dataset || "real",
          status: "error",
          error: message,
          readyForPublication: false,
        }) + "\n",
      );
    }
  }
  await flush();
  if (!batches.length)
    await writeFile(
      path.join(destination, "products.json"),
      JSON.stringify({ schema_version: 1, products: [] }),
      { flag: "wx" },
    );
  const report = {
    files: files.length,
    candidates,
    held: files.length - candidates,
    dataset: options.dataset || "real",
    countryCounts,
    uniqueSourceProducts: seen.size,
    duplicateFiles,
    failures,
    validation,
    batches,
    repeat: {
      created: 0,
      updated: 0,
      skipped: batches.reduce((sum, b) => sum + b.repeatSkipped, 0),
      failed: 0,
    },
    translation: {
      configured: Boolean(options.translator),
      engine: options.translator?.name || null,
      tasks: taskCount,
      proposals: proposalCount,
      pending: taskCount - proposalCount,
      reviewStatus: "needs_review",
    },
    elapsedMs: Math.round(performance.now() - started),
    peakRssMiB: Math.round(
      Math.max(peakRss, process.memoryUsage().rss) / 1024 / 1024,
    ),
    rssScope:
      "Node.js process only; external local-translator process excluded",
    readyForPublication: 0,
    networkRequests: 0,
    translatorNetworkIsolation: options.translator
      ? "operator must ensure local command is genuinely offline"
      : "not applicable",
    activeCatalogModified: false,
  };
  await writeFile(
    path.join(destination, "report.json"),
    JSON.stringify(report, null, 2),
    { flag: "wx" },
  );
  return report;
}
