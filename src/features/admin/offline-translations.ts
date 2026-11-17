import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import type {
  parseKlookSavedHtml,
  SavedPageMapping,
} from "./klook-offline-html";

export type OfflineObservation = ReturnType<
  typeof parseKlookSavedHtml
>["observation"];
export type TranslationTask = {
  key: string;
  sourceHash: string;
  productId: string;
  field: string;
  from: "ru" | "en";
  to: "ru" | "en";
  text: string;
};
export const translationProposalSchema = z.object({
  key: z.string().min(1),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  targetText: z.string().trim().min(1).max(20000),
});
export type TranslationProposal = z.infer<typeof translationProposalSchema>;
export interface OfflineTranslator {
  readonly name: string;
  translate(tasks: TranslationTask[]): Promise<TranslationProposal[]>;
}
export function translationTasks(o: OfflineObservation): TranslationTask[] {
  if (!o.locale) return [];
  const from = o.locale,
    to = from === "en" ? "ru" : "en";
  const fields = [
    { field: "title", text: o.title },
    { field: "description", text: o.description },
    ...o.packageCards.flatMap((p) => [
      { field: `package:${p.external_package_id}:title`, text: p.name },
      {
        field: `package:${p.external_package_id}:description`,
        text: p.description,
      },
    ]),
    ...o.detailedHighlights.flatMap((h, i) => [
      { field: `highlight:${i}:title`, text: h.title },
      { field: `highlight:${i}:description`, text: h.description },
    ]),
  ];
  return fields
    .filter((f) => f.text)
    .map((f) => ({
      ...f,
      productId: o.external_product_id,
      from,
      to,
      key: `klook:${o.external_product_id}:${f.field}:${to}`,
      sourceHash: createHash("sha256")
        .update(JSON.stringify([from, to, f.text]))
        .digest("hex"),
    }));
}
export function reviewedDraftMapping(
  mapping: SavedPageMapping,
  tasks: TranslationTask[],
  proposals: TranslationProposal[],
) {
  const result = structuredClone(mapping);
  const accepted: {
    key: string;
    sourceHash: string;
    targetText: string;
    reviewStatus: "needs_review";
  }[] = [];
  const rejected: { key: string; reason: string }[] = [];
  const indexed = new Map<string, TranslationProposal[]>();
  for (const p of proposals) {
    const key = `${p.key}/${p.sourceHash}`;
    indexed.set(key, [...(indexed.get(key) || []), p]);
  }
  for (const task of tasks) {
    const matches = indexed.get(`${task.key}/${task.sourceHash}`) || [];
    if (!matches.length) continue;
    const checked = translationProposalSchema.safeParse(matches[0]);
    const numbers = (s: string) =>
      (s.match(/\d+(?:[.,]\d+)*/g) || [])
        .map((n) => n.replaceAll(",", "."))
        .sort();
    if (
      matches.length !== 1 ||
      !checked.success ||
      /<[^>]*>/.test(matches[0].targetText) ||
      JSON.stringify(numbers(task.text)) !==
        JSON.stringify(numbers(matches[0].targetText))
    ) {
      rejected.push({
        key: task.key,
        reason: "Invalid/duplicate translation or changed numerical facts",
      });
      continue;
    }
    const targetText = checked.data.targetText;
    if (task.from === "en" && task.to === "ru") {
      const domainError =
        /\btram\b/i.test(task.text) && !/трамв/i.test(targetText)
          ? "Transport term Tram lost or mistranslated"
          : /high tea/i.test(task.text) &&
              /высок\S*\s+ча|чай с чаем/i.test(targetText)
            ? "High tea translated literally; editorial correction required"
            : /redemption voucher/i.test(task.text) && /выкуп/i.test(targetText)
              ? "Voucher redemption mistranslated as buyout"
              : null;
      if (domainError) {
        rejected.push({ key: task.key, reason: domainError });
        continue;
      }
    }
    accepted.push({
      key: task.key,
      sourceHash: task.sourceHash,
      targetText,
      reviewStatus: "needs_review",
    });
    if (task.field === "title" || task.field === "description") {
      result[task.field] = {
        ...result[task.field],
        [task.to]: result[task.field]?.[task.to] || targetText,
      };
    }
    const pkg = /^package:(\d+):(title|description)$/.exec(task.field);
    if (pkg) {
      result.packageTranslations ??= {};
      const current = (result.packageTranslations[pkg[1]] ??= {});
      const field = pkg[2] as "title" | "description";
      current[field] = {
        ...current[field],
        [task.to]: current[field]?.[task.to] || targetText,
      };
    }
  }
  return { mapping: result, accepted, rejected };
}

// Explicit trusted local program, stdin/stdout JSON. No shell and no API endpoint.
// The caller must choose a genuinely offline model; a process is not a network sandbox.
export class LocalCommandTranslator implements OfflineTranslator {
  readonly name = "local-command";
  constructor(
    private executable: string,
    private args: string[] = [],
    private timeoutMs = 60000,
  ) {
    if (!path.isAbsolute(executable))
      throw Error(
        "Translator executable must be an explicit absolute local path",
      );
  }
  async translate(tasks: TranslationTask[]): Promise<TranslationProposal[]> {
    if (tasks.length > 20 || JSON.stringify(tasks).length > 100000)
      throw Error("Translation request exceeds local batch limit");
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, this.args, {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          NODE_ENV: "development",
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          HF_HUB_OFFLINE: "1",
          TRANSFORMERS_OFFLINE: "1",
        },
      });
      let output = Buffer.alloc(0),
        stderrBytes = 0,
        failed = false;
      const timer = setTimeout(() => {
        failed = true;
        child.kill();
        reject(Error("Local translation timed out"));
      }, this.timeoutMs);
      const fail = (error: Error) => {
        failed = true;
        clearTimeout(timer);
        child.kill();
        reject(error);
      };
      child.on("error", fail);
      child.stdin.on("error", () => {});
      child.stdout.on("data", (chunk: Buffer) => {
        output = Buffer.concat([output, chunk]);
        if (output.length > 2 * 1024 * 1024)
          fail(Error("Local translation output too large"));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > 1024 * 1024)
          fail(Error("Local translation stderr too large"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failed) return;
        if (code !== 0) {
          reject(Error(`Local translator exited with code ${code}`));
          return;
        }
        try {
          resolve(
            z
              .array(translationProposalSchema)
              .max(20)
              .parse(JSON.parse(output.toString("utf8"))),
          );
        } catch {
          reject(Error("Invalid local translation response"));
        }
      });
      child.stdin.end(JSON.stringify(tasks));
    });
  }
}
