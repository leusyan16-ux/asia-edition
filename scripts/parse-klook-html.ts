import { readFile, lstat } from "node:fs/promises";
import { z } from "zod";
import { runSavedHtmlBatch } from "../src/features/admin/klook-offline-batch";
import {
  LocalCommandTranslator,
  translationProposalSchema,
} from "../src/features/admin/offline-translations";
import type { SavedPageMapping } from "../src/features/admin/klook-offline-html";
const configSchema = z
  .object({
    dataset: z.enum(["real", "synthetic"]).default("real"),
    proposalsFile: z.string().optional(),
    localTranslation: z
      .object({
        executable: z.string(),
        args: z.array(z.string()).max(30).default([]),
      })
      .optional(),
  })
  .strict();
async function json(filename: string, maxBytes: number) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes)
    throw Error("Invalid/oversize local config file");
  return JSON.parse(await readFile(filename, "utf8"));
}
async function main() {
  const [input, output, manifestPath, configPath] = process.argv.slice(2);
  if (!input || !output)
    throw Error(
      "Usage: node --import tsx scripts/parse-klook-html.ts INPUT_DIRECTORY NEW_OUTPUT_DIRECTORY [MANIFEST.json|-] [CONFIG.json]",
    );
  const manifest =
    manifestPath && manifestPath !== "-"
      ? ((await json(manifestPath, 8 * 1024 * 1024)) as Record<
          string,
          SavedPageMapping
        >)
      : {};
  const config = configSchema.parse(
    configPath ? await json(configPath, 1024 * 1024) : {},
  );
  const proposals = config.proposalsFile
    ? z
        .array(translationProposalSchema)
        .max(100000)
        .parse(await json(config.proposalsFile, 64 * 1024 * 1024))
    : [];
  const translator = config.localTranslation
    ? new LocalCommandTranslator(
        config.localTranslation.executable,
        config.localTranslation.args,
      )
    : undefined;
  console.log(
    JSON.stringify(
      await runSavedHtmlBatch(input, output, manifest, {
        dataset: config.dataset,
        proposals,
        translator,
      }),
      null,
      2,
    ),
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
