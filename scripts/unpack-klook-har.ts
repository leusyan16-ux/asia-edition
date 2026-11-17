import { lstat, readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { extractKlookHar, harDigest } from "../src/features/admin/klook-har";

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
    throw Error(
      "Usage: node --import tsx scripts/unpack-klook-har.ts INPUT.har NEW_DIRECTORY_UNDER_DATA",
    );
  const file = await lstat(input);
  if (!file.isFile() || file.isSymbolicLink() || file.size > 64 * 1024 * 1024)
    throw Error(
      "HAR must be a regular file <=64 MiB; split capture into smaller batches",
    );
  const data = await realpath("data"),
    dest = path.resolve(output);
  if (!dest.startsWith(data + path.sep))
    throw Error("Output must be a new private directory under data/");
  // Existing-parent realpath check prevents a directory symlink escaping data/.
  let parent = path.dirname(dest);
  while (true) {
    try {
      const actual = await realpath(parent);
      if (actual !== data && !actual.startsWith(data + path.sep))
        throw Error("Output parent outside data/");
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      parent = path.dirname(parent);
    }
  }
  const bytes = await readFile(input);
  const result = extractKlookHar(
    JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")),
  );
  await mkdir(path.dirname(dest), { recursive: true });
  await mkdir(dest); // Never overwrite a capture.
  for (const p of result.products) {
    if (p.held || !p.html) continue;
    const folder = path.join(dest, p.id);
    await mkdir(folder);
    await writeFile(path.join(folder, `klook-${p.id}.html`), p.html, {
      flag: "wx",
    });
    if (p.packages)
      await writeFile(
        path.join(folder, `klook-${p.id}-packages.json`),
        JSON.stringify(p.packages),
        { flag: "wx" },
      );
  }
  const report = {
    ...result.report,
    sourceSha256: harDigest(bytes),
    products: result.products.map(({ id, held, reason, html, packages }) => ({
      id,
      held,
      reason,
      html: Boolean(html),
      packages: Boolean(packages),
    })),
  };
  await writeFile(
    path.join(dest, "har-report.json"),
    JSON.stringify(report, null, 2),
    { flag: "wx" },
  );
  console.log(JSON.stringify(report, null, 2));
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
