import type { ExternalImportRecord } from "../admin/import-engine";

/** NDJSON boundary: rejects oversized lines before parsing; never buffers a feed.
 * CSV/JSON UI remains unchanged. Official adapters may directly yield records. */
export async function* readNDJSON(
  chunks: AsyncIterable<string | Uint8Array>,
): AsyncGenerator<ExternalImportRecord> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  for await (const chunk of chunks) {
    pending +=
      typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (Buffer.byteLength(line) > 4 * 1024 * 1024)
        throw new Error("NDJSON line exceeds limit");
      if (line.trim()) yield JSON.parse(line) as ExternalImportRecord;
    }
    if (Buffer.byteLength(pending) > 4 * 1024 * 1024)
      throw new Error("NDJSON line exceeds limit");
  }
  pending += decoder.decode();
  if (pending.trim()) yield JSON.parse(pending) as ExternalImportRecord;
}
