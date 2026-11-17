import { mediaKey, type MediaStore } from "./media";
/** Private bucket, server credentials only. SQL authorization precedes every read. */
export class SupabasePrivateMediaStore implements MediaStore {
  readonly backend = "supabase" as const;
  constructor(
    private readonly origin: string,
    private readonly bucket: string,
    private readonly key: string,
    private readonly transport: typeof fetch = fetch,
  ) {
    const url = new URL(origin);
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucket) ||
      !key
    )
      throw new Error("Invalid private Storage configuration");
  }
  private async object(key: string, body?: Uint8Array) {
    if (!mediaKey.test(key)) throw new Error("Invalid media key");
    const response = await this.transport(
      `${this.origin.replace(/\/$/, "")}/storage/v1/object/${this.bucket}/${key}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${this.key}`,
          apikey: this.key,
          ...(body
            ? { "Content-Type": "image/webp", "x-upsert": "false" }
            : {}),
        },
        body: body ? new Uint8Array(body) : undefined,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error("Private Storage request failed");
    return response;
  }
  async put(key: string, bytes: Uint8Array) {
    await this.object(key, bytes);
  }
  async read(key: string) {
    const response = await this.object(key);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty Storage response");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Storage response exceeds limit");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    return bytes;
  }
}
