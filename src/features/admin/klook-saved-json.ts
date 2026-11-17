import { createHash } from "node:crypto";
import { z } from "zod";
import type { ExternalImportRecord } from "./import-engine";
import { geographyError } from "@/lib/geography";

const id = z
  .union([
    z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    z.string().regex(/^[1-9]\d{0,19}$/),
  ])
  .transform(String);
const textValue = z.string().max(20000);
const icon = z
  .object({
    title: textValue,
    track: z.object({ name: z.string() }).passthrough().optional(),
    description: z
      .union([z.array(textValue).max(200), textValue, z.null()])
      .optional(),
  })
  .passthrough();
const image = z
  .object({
    image_url: z.string().max(4096),
    image_alt: textValue.optional(),
    image_desc: textValue.optional(),
  })
  .passthrough();
const component = z
  .object({
    type: z.string(),
    data: z
      .object({
        title: textValue.optional(),
        props: z
          .object({ field_key: z.string().optional() })
          .passthrough()
          .optional(),
        render_obj: z
          .array(z.object({ content: textValue }).passthrough())
          .max(300)
          .optional(),
        images: z.array(image).max(100).optional(),
      })
      .passthrough(),
  })
  .passthrough();
const responseSchema = z
  .object({
    success: z.literal(true),
    result: z
      .object({
        activity_id: id,
        currency_symbol: z.string().max(20),
        spu_group_info: z
          .array(
            z
              .object({
                group_id: id,
                name: textValue,
                desc: textValue.optional(),
                spu_list: z
                  .array(
                    z
                      .object({
                        spu_id: id,
                        spu_name: textValue,
                        spu_desc: textValue.optional(),
                        spu_icon_items: z.array(icon).max(30).default([]),
                        has_stocks: z.boolean().optional(),
                        best_sku_id: id.optional(),
                        price_status: z.number().optional(),
                        publish_info: z.unknown().optional(),
                        from_price_participant_time: z.string().optional(),
                        price_show: z
                          .object({
                            sale_price: z.string().optional(),
                            sale_price_value: z.string().optional(),
                            from_price: z.string().optional(),
                            from_price_value: z.string().optional(),
                            underline_price: z.string().optional(),
                          })
                          .passthrough()
                          .optional(),
                      })
                      .passthrough(),
                  )
                  .max(100),
              })
              .passthrough(),
          )
          .max(100),
        first_spu_detail: z
          .object({
            spu_basic: z
              .object({
                spu_id: id,
                spu_name: textValue,
                sub_category_id: z.number().optional(),
              })
              .passthrough(),
            icon_items: z.array(icon).max(30).default([]),
            sections: z
              .array(
                z
                  .object({
                    title: textValue,
                    section_type: z.string(),
                    components: z.array(component).max(100),
                  })
                  .passthrough(),
              )
              .max(50),
          })
          .passthrough()
          .nullish(),
      })
      .passthrough(),
  })
  .passthrough();

function plain(value = "") {
  return value
    .replace(
      /<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,
      " ",
    )
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(amp|quot|apos|nbsp|lt|gt);/g,
      (_, x: string) =>
        ({ amp: "&", quot: '"', apos: "'", nbsp: " ", lt: "<", gt: ">" })[x]!,
    )
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, x: string) => {
      const n =
        x[0].toLowerCase() === "x" ? parseInt(x.slice(1), 16) : Number(x);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}
const amount = (value?: string) =>
  value &&
  /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(value) &&
  Number.isFinite(Number(value))
    ? value
    : null;
function asset(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" &&
      u.hostname === "res.klook.com" &&
      !u.username &&
      !u.password &&
      !u.port
      ? u.href
      : null;
  } catch {
    return null;
  }
}

/** Offline mapper for the observed saved response, not an API client or endpoint contract. */
export function mergeSavedKlookPackages(
  payload: unknown,
  base: ExternalImportRecord,
  observedAt = new Date().toISOString(),
  locale: "ru" | "en" = "en",
) {
  const serialized = JSON.stringify(payload);
  if (!serialized || Buffer.byteLength(serialized) > 8 * 1024 * 1024)
    throw Error("Saved package JSON exceeds 8 MiB");
  z.iso.datetime({ offset: true }).parse(observedAt);
  const { result: r } = responseSchema.parse(payload);
  if (base.provider !== "klook" || base.external_product_id !== r.activity_id)
    throw Error("HTML/JSON activity ID mismatch");
  const source = new URL(base.source_url);
  if (
    source.protocol !== "https:" ||
    !["www.klook.com", "klook.com"].includes(source.hostname) ||
    source.username ||
    source.password ||
    source.port
  )
    throw Error("Expected a canonical HTTPS Klook activity source");
  const urlId = source.pathname.match(/\/activity\/(\d+)(?:-|\/|$)/)?.[1];
  if (urlId !== r.activity_id) throw Error("Source URL activity ID mismatch");
  const geo = geographyError({ ...base.product, locations: base.locations });
  if (geo) throw Error(geo);
  const currency = r.currency_symbol === "US$" ? "USD" : null;
  const previous = new Map(
    (base.packages ?? []).map((p) => [p.external_package_id, p]),
  );
  const packages: NonNullable<ExternalImportRecord["packages"]> = [];
  const observations: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const detail = r.first_spu_detail;
  const allIds = r.spu_group_info.flatMap((g) =>
    g.spu_list.map((p) => p.spu_id),
  );
  if (detail && !allIds.includes(detail.spu_basic.spu_id))
    throw Error("Detail package ID is not present in package list");
  for (const group of r.spu_group_info)
    for (const p of group.spu_list) {
      if (seen.has(p.spu_id)) throw Error("Duplicate package ID in saved JSON");
      if (packages.length >= 100)
        throw Error("At most 100 packages per product");
      seen.add(p.spu_id);
      const detailMatches = detail?.spu_basic.spu_id === p.spu_id;
      const sections = detailMatches
        ? detail!.sections.map((s) => ({
            title: plain(s.title),
            type: s.section_type,
            components: s.components.map((c) => ({
              type: c.type,
              key: c.data.props?.field_key ?? null,
              title: plain(c.data.title),
              items: (c.data.render_obj ?? [])
                .map((x) => plain(x.content))
                .filter(Boolean),
              images: (c.data.images ?? [])
                .map((i) => ({
                  url: asset(i.image_url),
                  alt: plain(i.image_alt),
                  description: plain(i.image_desc),
                  rightsApproved: false,
                }))
                .filter((i) => i.url),
            })),
          }))
        : [];
      const blocks = sections.flatMap((s) => s.components);
      const includes = blocks
        .filter((b) => b.key === "aid_spu_whats_include")
        .flatMap((b) => b.items);
      const policy = [
        ...p.spu_icon_items,
        ...(detailMatches ? detail!.icon_items : []),
      ].filter((i) => i.track?.name === "Cancellation_Policy");
      const cancellation = [
        ...new Set(
          policy
            .flatMap((i) => [
              plain(i.title),
              ...(Array.isArray(i.description)
                ? i.description.map((v) => plain(v))
                : i.description
                  ? [plain(i.description)]
                  : []),
            ])
            .filter(Boolean),
        ),
      ].join(". ");
      const old = previous.get(p.spu_id);
      const title = plain(p.spu_name),
        description = plain(p.spu_desc);
      // Keep the other language only if its source text is unchanged.
      const titleText = {
        ru: "",
        en: "",
        ...(old?.title?.[locale] === title ? old.title : {}),
        [locale]: title,
      };
      const descriptionText = {
        ru: "",
        en: "",
        ...(old?.description?.[locale] === description ? old.description : {}),
        [locale]: description,
      };
      const candidate = {
        external_package_id: p.spu_id,
        title: titleText,
        description: descriptionText,
        inclusions: { ru: [], en: [], [locale]: includes },
        cancellation: cancellation
          ? { ru: "", en: "", [locale]: cancellation }
          : null,
        prices: [],
      };
      const packageGeo = geographyError({
        ...candidate,
        country: base.product.country,
        description: {
          ...descriptionText,
          [locale]: [description, ...blocks.flatMap((b) => b.items)].join(" "),
        },
      });
      if (packageGeo) throw Error(packageGeo);
      packages.push(candidate);
      observations.push({
        external_package_id: p.spu_id,
        group_id: group.group_id,
        group: plain(group.name),
        group_description: plain(group.desc),
        title,
        description,
        currency,
        currency_symbol: r.currency_symbol,
        price: p.price_show ?? null,
        sale_price_value: amount(p.price_show?.sale_price_value),
        from_price_value: amount(p.price_show?.from_price_value),
        best_sku_id: p.best_sku_id ?? null,
        has_stocks_snapshot: p.has_stocks ?? null,
        price_status: p.price_status ?? null,
        publish_info: p.publish_info ?? null,
        source_participant_time: p.from_price_participant_time ?? null,
        icons: p.spu_icon_items.map((i) => ({
          title: plain(i.title),
          kind: i.track?.name ?? null,
        })),
        detail_available: Boolean(detailMatches),
        sections,
        verified_price: false,
        availability_verified: false,
      });
    }
  if (!packages.length) throw Error("Saved JSON contains no packages");
  const jsonIds = new Set(packages.map((p) => p.external_package_id));
  const htmlIds = new Set(previous.keys());
  const record: ExternalImportRecord = {
    ...structuredClone(base),
    last_synced_at: observedAt,
    import_status: "needs_review",
    packages,
    product: {
      ...structuredClone(base.product),
      prices: [],
      availability: [],
      slots: [],
      images: [],
    },
  };
  return {
    record,
    observation: {
      activity_id: r.activity_id,
      observed_at: observedAt,
      payload_sha256: createHash("sha256").update(serialized).digest("hex"),
      currency,
      group_count: r.spu_group_info.length,
      package_count: packages.length,
      detailed_package_id: detail?.spu_basic.spu_id ?? null,
      comparison: {
        shared_package_ids: [...jsonIds].filter((x) => htmlIds.has(x)),
        json_only_package_ids: [...jsonIds].filter((x) => !htmlIds.has(x)),
        html_only_package_ids: [...htmlIds].filter((x) => !jsonIds.has(x)),
      },
      packages: observations,
      missing: [
        "Product title/geography/category and general description require matching HTML or verified content source",
        "Adult/child or group price basis, service dates, price validity and taxes are not verified",
        "No authoritative availability calendar",
        "Full details are available only for detailed_package_id",
        "Image rights and editorial publication approval require review",
      ],
      warnings: [
        "from_price_participant_time has no timezone and is not a validity/verification timestamp",
        "has_stocks and supplier publish_status are snapshots, not permission to publish or book",
        "Package-specific exclusions, addresses and redemption conditions remain scoped observations, never global tour conditions",
        "No requests, downloads, rights approval or publication performed",
      ],
    },
  };
}
