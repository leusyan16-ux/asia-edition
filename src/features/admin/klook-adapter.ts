import type { ExternalImportRecord } from "@/features/admin/import-engine";
import type { ProviderMappings } from "./provider-mapping";
import { mergeSavedKlookPackages } from "./klook-saved-json";
export interface ProductFeedAdapter {
  readonly provider: string;
  readonly mappings?: ProviderMappings;
  normalize(officialPayload: unknown): Promise<ExternalImportRecord[]>;
}
// Internal transport boundary, not a claim about the shape of any official Klook API.
export interface OfficialFeedTransport {
  readPage(
    cursor: string | null,
  ): Promise<{ payload: unknown; nextCursor: string | null }>;
}
export async function* normalizedFeedPages(
  adapter: ProductFeedAdapter,
  transport: OfficialFeedTransport,
  cursor: string | null = null,
) {
  const seen = new Set<string>();
  do {
    if (cursor && seen.has(cursor)) throw new Error("Feed cursor loop");
    if (cursor) seen.add(cursor);
    const page = await transport.readPage(cursor);
    yield {
      records: await adapter.normalize(page.payload),
      nextCursor: page.nextCursor,
    };
    cursor = page.nextCursor;
  } while (cursor);
}
// No endpoint, credentials or response shape is assumed before official access.
export class KlookAdapter implements ProductFeedAdapter {
  readonly provider = "klook";
  normalizeSavedPackages(
    payload: unknown,
    htmlRecord: ExternalImportRecord,
    observedAt?: string,
    locale: "ru" | "en" = "en",
  ) {
    return mergeSavedKlookPackages(payload, htmlRecord, observedAt, locale);
  }
  constructor(
    private readonly mapOfficialFeed?: (
      payload: unknown,
    ) => Promise<ExternalImportRecord[]>,
    readonly mappings?: ProviderMappings,
  ) {}
  async normalize(payload: unknown) {
    if (!this.mapOfficialFeed)
      throw new Error(
        "Klook: требуется официальный доступ, документация feed/API и согласованный mapper",
      );
    const records = await this.mapOfficialFeed(payload);
    if (records.some((r) => r.provider !== "klook"))
      throw new Error("Klook mapper returned a different provider");
    return records;
  }
}
